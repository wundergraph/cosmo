package mcpserver

import (
	"bytes"
	"encoding/json"
	"fmt"
	"maps"
	"slices"

	"github.com/google/jsonschema-go/jsonschema"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/lexer/literal"
)

// buildResponseSchema builds a JSON schema describing the GraphQL response
// envelope ({"data": ...}) produced by the operation's selection set.
// The schema is intentionally permissive: it must never reject a valid
// response for the operation. Response objects are therefore left open and
// fields that are only conditionally present are not marked as required.
//
// Schemas are emitted as github.com/google/jsonschema-go nodes, the schema
// model of the MCP Go SDK. Nullability is decided before a node is built and
// baked in at construction; no node is modified after its subtree is complete.
func buildResponseSchema(operation, definition *ast.Document) (*jsonschema.Schema, error) {
	builder := &responseSchemaBuilder{
		operation:        operation,
		definition:       definition,
		pendingFragments: make(map[string]bool),
	}

	return builder.build()
}

// typedSchema returns a schema for one JSON type, in nullable or non-null
// form. Nullability uses the JSON Schema 2020-12 type-union form.
func typedSchema(jsonType string, nullable bool) *jsonschema.Schema {
	if nullable {
		return &jsonschema.Schema{Types: []string{jsonType, "null"}}
	}
	return &jsonschema.Schema{Type: jsonType}
}

// anySchema returns a schema that accepts any JSON value. It marshals as the
// boolean schema "true", the JSON Schema 2020-12 accept-everything form.
func anySchema() *jsonschema.Schema {
	return &jsonschema.Schema{}
}

func isObjectSchema(s *jsonschema.Schema) bool {
	return s.Type == "object" || slices.Contains(s.Types, "object")
}

func isNullableSchema(s *jsonschema.Schema) bool {
	return slices.Contains(s.Types, "null")
}

// responseSchemaBuilder builds a JSON schema for an operation's response from
// its selection set and the schema document
type responseSchemaBuilder struct {
	operation  *ast.Document
	definition *ast.Document
	// pendingFragments tracks the fragments on the current expansion path so
	// that fragment spread cycles, which are invalid GraphQL and have no finite
	// response shape, are rejected instead of recursing forever. With cycles
	// rejected, the recursion is bounded by the operation document itself.
	pendingFragments map[string]bool
}

// build resolves the root operation type and wraps the selection set schema
// in the GraphQL response envelope
func (b *responseSchemaBuilder) build() (*jsonschema.Schema, error) {
	if len(b.operation.OperationDefinitions) == 0 {
		return nil, fmt.Errorf("operation document contains no operation definition")
	}

	operationDefinition := b.operation.OperationDefinitions[0]

	var rootTypeName []byte
	switch operationDefinition.OperationType {
	case ast.OperationTypeQuery:
		rootTypeName = b.definition.Index.QueryTypeName
	case ast.OperationTypeMutation:
		rootTypeName = b.definition.Index.MutationTypeName
	default:
		return nil, fmt.Errorf("unsupported operation type %d", operationDefinition.OperationType)
	}

	rootType, exists := b.definition.Index.FirstNodeByNameBytes(rootTypeName)
	if !exists {
		return nil, fmt.Errorf("root operation type %q is not defined in the schema", string(rootTypeName))
	}

	if !operationDefinition.HasSelections {
		return nil, fmt.Errorf("operation has no selections")
	}

	// "data" is null when the response carries request-level errors, so it
	// stays nullable and optional
	dataSchema, err := b.buildSelectionSetSchema(operationDefinition.SelectionSet, rootType, true)
	if err != nil {
		return nil, err
	}

	// The envelope root is left open so that "errors" or "extensions" members
	// never fail validation. The MCP specification requires the top-level type
	// of a tool output schema to be "object", so it must not be nullable.
	return &jsonschema.Schema{
		Type:       "object",
		Properties: map[string]*jsonschema.Schema{"data": dataSchema},
	}, nil
}

// buildSelectionSetSchema returns the object schema for one selection set
// evaluated against the given enclosing schema type. Response objects are left
// open: the schema describes what the router returns, it does not gate it.
func (b *responseSchemaBuilder) buildSelectionSetSchema(selectionSetRef int, parentType ast.Node, nullable bool) (*jsonschema.Schema, error) {
	properties := make(map[string]*jsonschema.Schema)
	required := make(map[string]bool)

	if err := b.collectSelections(selectionSetRef, parentType, false, properties, required); err != nil {
		return nil, err
	}

	schema := typedSchema("object", nullable)
	if len(properties) > 0 {
		schema.Properties = properties
	}
	// Sort the required keys for deterministic output
	schema.Required = slices.Sorted(maps.Keys(required))
	return schema, nil
}

// collectSelections flattens the fields, inline fragments and fragment spreads
// of one selection set into the properties and required maps. A key is required
// once it is selected unconditionally at least once; conditional marks
// selections that may be absent from the response because of a @skip, @include
// or @defer directive or a type condition that is not guaranteed to match.
func (b *responseSchemaBuilder) collectSelections(selectionSetRef int, parentType ast.Node, conditional bool, properties map[string]*jsonschema.Schema, required map[string]bool) error {
	for _, selectionRef := range b.operation.SelectionSets[selectionSetRef].SelectionRefs {
		selection := b.operation.Selections[selectionRef]

		switch selection.Kind {
		case ast.SelectionKindField:
			fieldRef := selection.Ref
			fieldConditional := conditional || b.hasConditionalDirective(b.operation.Fields[fieldRef].Directives)

			fieldSchema, err := b.buildFieldSchema(fieldRef, parentType)
			if err != nil {
				return err
			}

			// The response key is the field alias when one is set. The same key
			// selected through multiple fragments is merged into one schema.
			key := b.operation.FieldAliasOrNameString(fieldRef)
			if existing, ok := properties[key]; ok {
				fieldSchema = mergeFieldSchemas(existing, fieldSchema)
			}
			properties[key] = fieldSchema

			if !fieldConditional {
				required[key] = true
			}

		case ast.SelectionKindInlineFragment:
			inlineFragmentRef := selection.Ref
			fragmentConditional := conditional || b.hasConditionalDirective(b.operation.InlineFragments[inlineFragmentRef].Directives)

			fragmentType := parentType
			if b.operation.InlineFragmentHasTypeCondition(inlineFragmentRef) {
				typeConditionName := b.operation.InlineFragmentTypeConditionNameString(inlineFragmentRef)
				node, exists := b.definition.Index.FirstNodeByNameStr(typeConditionName)
				if !exists {
					return fmt.Errorf("type condition %q is not defined in the schema", typeConditionName)
				}
				fragmentType = node
				fragmentConditional = fragmentConditional || !b.fragmentAlwaysMatches(parentType, typeConditionName)
			}

			if fragmentSelectionSetRef, ok := b.operation.InlineFragmentSelectionSet(inlineFragmentRef); ok {
				if err := b.collectSelections(fragmentSelectionSetRef, fragmentType, fragmentConditional, properties, required); err != nil {
					return err
				}
			}

		case ast.SelectionKindFragmentSpread:
			fragmentSpreadRef := selection.Ref
			fragmentNameBytes := b.operation.FragmentSpreadNameBytes(fragmentSpreadRef)
			fragmentName := string(fragmentNameBytes)

			// A fragment that spreads itself, directly or transitively, is
			// invalid GraphQL and has no finite response shape
			if b.pendingFragments[fragmentName] {
				return fmt.Errorf("fragment %q forms a cycle", fragmentName)
			}

			fragmentDefinitionRef, exists := b.operation.FragmentDefinitionRef(fragmentNameBytes)
			if !exists {
				return fmt.Errorf("fragment %q is not defined in the operation document", fragmentName)
			}

			fragmentConditional := conditional || b.hasConditionalDirective(b.operation.FragmentSpreads[fragmentSpreadRef].Directives)

			typeConditionName := b.operation.FragmentDefinitionTypeNameString(fragmentDefinitionRef)
			fragmentType, exists := b.definition.Index.FirstNodeByNameStr(typeConditionName)
			if !exists {
				return fmt.Errorf("type condition %q is not defined in the schema", typeConditionName)
			}
			fragmentConditional = fragmentConditional || !b.fragmentAlwaysMatches(parentType, typeConditionName)

			if b.operation.FragmentDefinitions[fragmentDefinitionRef].HasSelections {
				b.pendingFragments[fragmentName] = true
				if err := b.collectSelections(b.operation.FragmentDefinitions[fragmentDefinitionRef].SelectionSet, fragmentType, fragmentConditional, properties, required); err != nil {
					return err
				}
				delete(b.pendingFragments, fragmentName)
			}
		}
	}

	return nil
}

// buildFieldSchema returns the schema for a single field selection
func (b *responseSchemaBuilder) buildFieldSchema(fieldRef int, parentType ast.Node) (*jsonschema.Schema, error) {
	fieldName := b.operation.FieldNameBytes(fieldRef)

	// __typename is valid on any composite type and is always a non-null string
	if bytes.Equal(fieldName, literal.TYPENAME) {
		return typedSchema("string", false), nil
	}

	fieldDefinitionRef, exists := b.definition.NodeFieldDefinitionByName(parentType, fieldName)
	if !exists {
		return nil, fmt.Errorf("field %q is not defined on type %q", string(fieldName), parentType.NameString(b.definition))
	}

	schema, err := b.buildTypeRefSchema(b.definition.FieldDefinitionType(fieldDefinitionRef), fieldRef, true)
	if err != nil {
		return nil, err
	}

	// Field descriptions take precedence over type descriptions
	if b.definition.FieldDefinitions[fieldDefinitionRef].Description.IsDefined {
		schema.Description = b.definition.FieldDefinitionDescriptionString(fieldDefinitionRef)
	}

	return schema, nil
}

// buildTypeRefSchema resolves the schema of a type reference from the schema
// document. The selection set of fieldRef provides the shape of composite
// types. nullable is the nullability of the current wrapping position: a
// non-null wrapper builds its inner type with nullable false.
func (b *responseSchemaBuilder) buildTypeRefSchema(typeRef, fieldRef int, nullable bool) (*jsonschema.Schema, error) {
	switch b.definition.Types[typeRef].TypeKind {
	case ast.TypeKindNonNull:
		return b.buildTypeRefSchema(b.definition.Types[typeRef].OfType, fieldRef, false)

	case ast.TypeKindList:
		itemSchema, err := b.buildTypeRefSchema(b.definition.Types[typeRef].OfType, fieldRef, true)
		if err != nil {
			return nil, err
		}
		schema := typedSchema("array", nullable)
		schema.Items = itemSchema
		return schema, nil

	case ast.TypeKindNamed:
		return b.buildNamedTypeSchema(b.definition.TypeNameString(typeRef), fieldRef, nullable)
	}

	return nil, fmt.Errorf("unknown type kind %d", b.definition.Types[typeRef].TypeKind)
}

// buildNamedTypeSchema resolves the schema of a named type. Composite types
// take their shape from the selection set of fieldRef.
func (b *responseSchemaBuilder) buildNamedTypeSchema(typeName string, fieldRef int, nullable bool) (*jsonschema.Schema, error) {
	// Handle built-in scalars
	switch typeName {
	case "String", "ID":
		return typedSchema("string", nullable), nil
	case "Int":
		return typedSchema("integer", nullable), nil
	case "Float":
		return typedSchema("number", nullable), nil
	case "Boolean":
		return typedSchema("boolean", nullable), nil
	}

	// For custom types, look up in the definition document
	node, exists := b.definition.Index.FirstNodeByNameStr(typeName)
	if !exists {
		return nil, fmt.Errorf("type %q is not defined", typeName)
	}

	// Process the type based on its kind
	switch node.Kind {
	case ast.NodeKindEnumTypeDefinition:
		enumDefinition := b.definition.EnumTypeDefinitions[node.Ref]
		values := make([]any, 0, len(enumDefinition.EnumValuesDefinition.Refs)+1)
		for _, valueRef := range enumDefinition.EnumValuesDefinition.Refs {
			values = append(values, b.definition.EnumValueDefinitionNameString(valueRef))
		}
		// A nullable enum admits null as a value
		if nullable {
			values = append(values, nil)
		}

		schema := typedSchema("string", nullable)
		schema.Enum = values
		// Add description if available
		if enumDefinition.Description.IsDefined {
			schema.Description = b.definition.EnumTypeDefinitionDescriptionString(node.Ref)
		}
		return schema, nil

	case ast.NodeKindScalarTypeDefinition:
		// Custom scalars accept any JSON value
		schema := anySchema()
		// Add description if available
		if b.definition.ScalarTypeDefinitions[node.Ref].Description.IsDefined {
			schema.Description = b.definition.ScalarTypeDefinitionDescriptionString(node.Ref)
		}
		return schema, nil

	case ast.NodeKindObjectTypeDefinition, ast.NodeKindInterfaceTypeDefinition, ast.NodeKindUnionTypeDefinition:
		selectionSetRef, ok := b.operation.FieldSelectionSet(fieldRef)
		if !ok {
			return nil, fmt.Errorf("composite field %q has no selection set", b.operation.FieldNameString(fieldRef))
		}
		return b.buildSelectionSetSchema(selectionSetRef, node, nullable)

	default:
		// If we can't determine the type, default to any
		return anySchema(), nil
	}
}

// hasConditionalDirective reports whether the selection carries a directive
// that can make it absent from the response. The directive arguments are not
// inspected: a field behind @include(if: true) is still treated as optional,
// which can never reject a valid response.
func (b *responseSchemaBuilder) hasConditionalDirective(directives ast.DirectiveList) bool {
	if _, exists := directives.HasDirectiveByNameBytes(b.operation, literal.SKIP); exists {
		return true
	}
	if _, exists := directives.HasDirectiveByNameBytes(b.operation, literal.INCLUDE); exists {
		return true
	}
	if _, exists := directives.HasDirectiveByNameBytes(b.operation, literal.DEFER); exists {
		return true
	}
	return false
}

// fragmentAlwaysMatches reports whether a fragment with the given type
// condition matches every possible runtime type of parentType, i.e. whether
// its fields are unconditionally present in the response
func (b *responseSchemaBuilder) fragmentAlwaysMatches(parentType ast.Node, typeConditionName string) bool {
	if parentType.NameString(b.definition) == typeConditionName {
		return true
	}

	// The runtime type of an abstract parent may not match a narrower or
	// sibling type condition
	if parentType.Kind != ast.NodeKindObjectTypeDefinition {
		return false
	}

	conditionNode, exists := b.definition.Index.FirstNodeByNameStr(typeConditionName)
	if !exists {
		return false
	}

	switch conditionNode.Kind {
	case ast.NodeKindInterfaceTypeDefinition:
		return b.definition.NodeImplementsInterface(parentType, []byte(typeConditionName))
	case ast.NodeKindUnionTypeDefinition:
		memberTypeNames, ok := b.definition.UnionTypeDefinitionMemberTypeNames(conditionNode.Ref)
		return ok && slices.Contains(memberTypeNames, parentType.NameString(b.definition))
	}

	return false
}

// mergeFieldSchemas merges two schemas produced for the same response key,
// e.g. the same field reached through multiple fragments. Structurally equal
// schemas are kept, two object schemas are merged recursively, and anything
// else degrades to the accept-anything schema so that a valid response is
// never rejected.
func mergeFieldSchemas(a, b *jsonschema.Schema) *jsonschema.Schema {
	aJSON, aErr := json.Marshal(a)
	bJSON, bErr := json.Marshal(b)
	if aErr == nil && bErr == nil && bytes.Equal(aJSON, bJSON) {
		return a
	}

	if isObjectSchema(a) && isObjectSchema(b) {
		merged := typedSchema("object", isNullableSchema(a) || isNullableSchema(b))
		merged.Description = a.Description

		properties := make(map[string]*jsonschema.Schema, len(a.Properties)+len(b.Properties))
		maps.Copy(properties, a.Properties)
		for key, property := range b.Properties {
			if existing, ok := properties[key]; ok {
				properties[key] = mergeFieldSchemas(existing, property)
			} else {
				properties[key] = property
			}
		}
		if len(properties) > 0 {
			merged.Properties = properties
		}

		// A key is only guaranteed to be present if every variant requires it
		for _, key := range a.Required {
			if slices.Contains(b.Required, key) {
				merged.Required = append(merged.Required, key)
			}
		}

		return merged
	}

	// The same response key can resolve to incompatible shapes, e.g. one alias
	// bound to fields of different types on different union members
	return anySchema()
}
