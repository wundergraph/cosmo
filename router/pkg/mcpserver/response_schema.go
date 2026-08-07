package mcpserver

import (
	"bytes"
	"encoding/json"
	"fmt"
	"maps"
	"slices"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/jsonschema"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/lexer/literal"
)

// buildResponseSchema builds a JSON schema describing the GraphQL response
// envelope ({"data": ...}) produced by the operation's selection set.
// The schema is intentionally permissive: it must never reject a valid
// response for the operation. Response objects are therefore left open and
// fields that are only conditionally present are not marked as required.
func buildResponseSchema(operation, definition *ast.Document) (json.RawMessage, error) {
	builder := &responseSchemaBuilder{
		operation:        operation,
		definition:       definition,
		pendingFragments: make(map[string]bool),
	}

	schema, err := builder.build()
	if err != nil {
		return nil, err
	}

	s, err := schema.MarshalJSON()
	if err != nil {
		return nil, fmt.Errorf("failed to marshal response schema: %w", err)
	}

	return s, nil
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
func (b *responseSchemaBuilder) build() (*jsonschema.JsonSchema, error) {
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

	dataSchema, err := b.buildSelectionSetSchema(operationDefinition.SelectionSet, rootType)
	if err != nil {
		return nil, err
	}

	// "data" is null when the response carries request-level errors, so it
	// stays nullable and optional
	dataSchema.Nullable = true

	// The envelope root is left open so that "errors" or "extensions" members
	// never fail validation. The MCP specification requires the top-level type
	// of a tool output schema to be "object", so it must not be nullable.
	return &jsonschema.JsonSchema{
		Type:       jsonschema.TypeObject,
		Properties: map[string]*jsonschema.JsonSchema{"data": dataSchema},
	}, nil
}

// buildSelectionSetSchema returns the object schema for one selection set
// evaluated against the given enclosing schema type. Response objects are left
// open: the schema describes what the router returns, it does not gate it.
func (b *responseSchemaBuilder) buildSelectionSetSchema(selectionSetRef int, parentType ast.Node) (*jsonschema.JsonSchema, error) {
	properties := make(map[string]*jsonschema.JsonSchema)
	required := make(map[string]bool)

	if err := b.collectSelections(selectionSetRef, parentType, false, properties, required); err != nil {
		return nil, err
	}

	return &jsonschema.JsonSchema{
		Type:       jsonschema.TypeObject,
		Properties: properties,
		// Sort the required keys for deterministic output
		Required: slices.Sorted(maps.Keys(required)),
		Nullable: true, // response objects are nullable unless a non-null wrapper flips it off
	}, nil
}

// collectSelections flattens the fields, inline fragments and fragment spreads
// of one selection set into the properties and required maps. A key is required
// once it is selected unconditionally at least once; conditional marks
// selections that may be absent from the response because of a @skip, @include
// or @defer directive or a type condition that is not guaranteed to match.
func (b *responseSchemaBuilder) collectSelections(selectionSetRef int, parentType ast.Node, conditional bool, properties map[string]*jsonschema.JsonSchema, required map[string]bool) error {
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
func (b *responseSchemaBuilder) buildFieldSchema(fieldRef int, parentType ast.Node) (*jsonschema.JsonSchema, error) {
	fieldName := b.operation.FieldNameBytes(fieldRef)

	// __typename is valid on any composite type and is always a non-null string
	if bytes.Equal(fieldName, literal.TYPENAME) {
		return jsonschema.NewStringSchema().WithNullable(false), nil
	}

	fieldDefinitionRef, exists := b.definition.NodeFieldDefinitionByName(parentType, fieldName)
	if !exists {
		return nil, fmt.Errorf("field %q is not defined on type %q", string(fieldName), parentType.NameString(b.definition))
	}

	schema, err := b.buildTypeRefSchema(b.definition.FieldDefinitionType(fieldDefinitionRef), fieldRef)
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
// document. The selection set of fieldRef provides the shape of composite types.
func (b *responseSchemaBuilder) buildTypeRefSchema(typeRef, fieldRef int) (*jsonschema.JsonSchema, error) {
	switch b.definition.Types[typeRef].TypeKind {
	case ast.TypeKindNonNull:
		schema, err := b.buildTypeRefSchema(b.definition.Types[typeRef].OfType, fieldRef)
		if err != nil {
			return nil, err
		}
		// Non-null types are not nullable
		schema.Nullable = false
		return schema, nil

	case ast.TypeKindList:
		itemSchema, err := b.buildTypeRefSchema(b.definition.Types[typeRef].OfType, fieldRef)
		if err != nil {
			return nil, err
		}
		// If we're not in a non-null context, the list is nullable
		return jsonschema.NewArraySchema(itemSchema), nil

	case ast.TypeKindNamed:
		return b.buildNamedTypeSchema(b.definition.TypeNameString(typeRef), fieldRef)
	}

	return nil, fmt.Errorf("unknown type kind %d", b.definition.Types[typeRef].TypeKind)
}

// buildNamedTypeSchema resolves the schema of a named type. Composite types
// take their shape from the selection set of fieldRef.
func (b *responseSchemaBuilder) buildNamedTypeSchema(typeName string, fieldRef int) (*jsonschema.JsonSchema, error) {
	// Handle built-in scalars
	switch typeName {
	case "String", "ID":
		return jsonschema.NewStringSchema(), nil
	case "Int":
		return jsonschema.NewIntegerSchema(), nil
	case "Float":
		return jsonschema.NewNumberSchema(), nil
	case "Boolean":
		return jsonschema.NewBooleanSchema(), nil
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
		values := make([]string, 0, len(enumDefinition.EnumValuesDefinition.Refs))
		for _, valueRef := range enumDefinition.EnumValuesDefinition.Refs {
			values = append(values, b.definition.EnumValueDefinitionNameString(valueRef))
		}

		schema := jsonschema.NewEnumSchema(values)
		// Add description if available
		if enumDefinition.Description.IsDefined {
			schema.Description = b.definition.EnumTypeDefinitionDescriptionString(node.Ref)
		}
		return schema, nil

	case ast.NodeKindScalarTypeDefinition:
		// Custom scalars accept any JSON value
		schema := jsonschema.NewAnySchema()
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
		return b.buildSelectionSetSchema(selectionSetRef, node)

	default:
		// If we can't determine the type, default to any
		return jsonschema.NewAnySchema(), nil
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
// else degrades to the empty (accept-anything) schema so that a valid
// response is never rejected.
func mergeFieldSchemas(a, b *jsonschema.JsonSchema) *jsonschema.JsonSchema {
	aJSON, aErr := a.MarshalJSON()
	bJSON, bErr := b.MarshalJSON()
	if aErr == nil && bErr == nil && bytes.Equal(aJSON, bJSON) {
		return a
	}

	if a.Type == jsonschema.TypeObject && b.Type == jsonschema.TypeObject {
		merged := &jsonschema.JsonSchema{
			Type:        jsonschema.TypeObject,
			Properties:  make(map[string]*jsonschema.JsonSchema, len(a.Properties)+len(b.Properties)),
			Nullable:    a.Nullable || b.Nullable,
			Description: a.Description,
		}

		maps.Copy(merged.Properties, a.Properties)
		for key, property := range b.Properties {
			if existing, ok := merged.Properties[key]; ok {
				merged.Properties[key] = mergeFieldSchemas(existing, property)
			} else {
				merged.Properties[key] = property
			}
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
	return jsonschema.NewAnySchema()
}
