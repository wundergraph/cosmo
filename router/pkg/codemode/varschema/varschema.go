// Package varschema derives a JSON Schema describing the `$variables` object
// of a GraphQL operation, statically against a parsed schema document.
//
// The generator is shared between the router (which consumes the JSON Schema
// returned by yoko) and the yoko mock (which produces it). It walks the same
// AST shape that the TypeScript bundle renderer uses, but emits JSON Schema
// instead of TS types so the schema is portable across non-TS clients.
package varschema

import (
	"encoding/json"
	"fmt"
	"slices"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
)

// ForOperation returns a JSON Schema (encoded as a JSON string) that describes
// the `$variables` object accepted by the given GraphQL operation body,
// resolving named types against schema.
func ForOperation(opBody string, schema *ast.Document) (string, error) {
	if schema == nil {
		return "", fmt.Errorf("variables JSON schema: schema is nil")
	}

	opDoc, report := astparser.ParseGraphqlDocumentString(opBody)
	if report.HasErrors() {
		return "", fmt.Errorf("variables JSON schema: parse operation: %s", report.Error())
	}

	opRef, err := singleOperationRef(&opDoc)
	if err != nil {
		return "", fmt.Errorf("variables JSON schema: %w", err)
	}

	r := renderer{schema: schema}
	root, err := r.variablesSchema(&opDoc, opRef)
	if err != nil {
		return "", fmt.Errorf("variables JSON schema: %w", err)
	}

	encoded, err := json.Marshal(root)
	if err != nil {
		return "", fmt.Errorf("variables JSON schema: encode: %w", err)
	}
	return string(encoded), nil
}

func singleOperationRef(doc *ast.Document) (int, error) {
	var refs []int
	for _, node := range doc.RootNodes {
		if node.Kind == ast.NodeKindOperationDefinition {
			refs = append(refs, node.Ref)
		}
	}
	if len(refs) == 0 {
		return 0, fmt.Errorf("operation document contains no operation definition")
	}
	if len(refs) > 1 {
		return 0, fmt.Errorf("operation document contains %d operation definitions", len(refs))
	}
	return refs[0], nil
}

type renderer struct {
	schema *ast.Document
}

// orderedSchema preserves field declaration order in JSON output.
type orderedSchema struct {
	pairs []orderedSchemaEntry
}

type orderedSchemaEntry struct {
	key   string
	value any
}

func (o *orderedSchema) set(key string, value any) {
	o.pairs = append(o.pairs, orderedSchemaEntry{key: key, value: value})
}

func (o orderedSchema) MarshalJSON() ([]byte, error) {
	buf := []byte{'{'}
	for i, p := range o.pairs {
		if i > 0 {
			buf = append(buf, ',')
		}
		k, err := json.Marshal(p.key)
		if err != nil {
			return nil, err
		}
		v, err := json.Marshal(p.value)
		if err != nil {
			return nil, err
		}
		buf = append(buf, k...)
		buf = append(buf, ':')
		buf = append(buf, v...)
	}
	buf = append(buf, '}')
	return buf, nil
}

func (r renderer) variablesSchema(opDoc *ast.Document, opRef int) (orderedSchema, error) {
	op := opDoc.OperationDefinitions[opRef]
	root := orderedSchema{}
	root.set("type", "object")

	if !op.HasVariableDefinitions || len(op.VariableDefinitions.Refs) == 0 {
		root.set("properties", orderedSchema{})
		return root, nil
	}

	props := orderedSchema{}
	required := make([]string, 0, len(op.VariableDefinitions.Refs))
	for _, varRef := range op.VariableDefinitions.Refs {
		name := opDoc.VariableDefinitionNameString(varRef)
		typeRef := opDoc.VariableDefinitionType(varRef)
		isRequired := opDoc.Types[typeRef].TypeKind == ast.TypeKindNonNull

		s, err := r.opType(opDoc, typeRef)
		if err != nil {
			return orderedSchema{}, err
		}
		props.set(name, s)
		if isRequired {
			required = append(required, name)
		}
	}
	root.set("properties", props)
	if len(required) > 0 {
		root.set("required", required)
	}
	return root, nil
}

// opType walks types living in the operation document. The result is a
// nullable JSON Schema fragment unless the type is wrapped in NonNull.
func (r renderer) opType(opDoc *ast.Document, typeRef int) (orderedSchema, error) {
	gqlType := opDoc.Types[typeRef]
	switch gqlType.TypeKind {
	case ast.TypeKindNonNull:
		return r.opTypeNonNull(opDoc, gqlType.OfType)
	case ast.TypeKindList:
		inner, err := r.opType(opDoc, gqlType.OfType)
		if err != nil {
			return orderedSchema{}, err
		}
		s := orderedSchema{}
		s.set("type", []string{"array", "null"})
		s.set("items", inner)
		return s, nil
	case ast.TypeKindNamed:
		s, err := r.namedType(opDoc.TypeNameString(typeRef))
		if err != nil {
			return orderedSchema{}, err
		}
		return makeNullable(s), nil
	default:
		return orderedSchema{}, fmt.Errorf("unsupported GraphQL input type kind %s", gqlType.TypeKind.String())
	}
}

func (r renderer) opTypeNonNull(opDoc *ast.Document, typeRef int) (orderedSchema, error) {
	gqlType := opDoc.Types[typeRef]
	switch gqlType.TypeKind {
	case ast.TypeKindNonNull:
		return r.opTypeNonNull(opDoc, gqlType.OfType)
	case ast.TypeKindList:
		inner, err := r.opType(opDoc, gqlType.OfType)
		if err != nil {
			return orderedSchema{}, err
		}
		s := orderedSchema{}
		s.set("type", "array")
		s.set("items", inner)
		return s, nil
	case ast.TypeKindNamed:
		return r.namedType(opDoc.TypeNameString(typeRef))
	default:
		return orderedSchema{}, fmt.Errorf("unsupported GraphQL input type kind %s", gqlType.TypeKind.String())
	}
}

func (r renderer) namedType(typeName string) (orderedSchema, error) {
	s := orderedSchema{}
	switch typeName {
	case "ID", "String":
		s.set("type", "string")
		return s, nil
	case "Int":
		s.set("type", "integer")
		return s, nil
	case "Float":
		s.set("type", "number")
		return s, nil
	case "Boolean":
		s.set("type", "boolean")
		return s, nil
	}

	node, exists := r.schema.Index.FirstNonExtensionNodeByNameBytes([]byte(typeName))
	if !exists {
		return orderedSchema{}, fmt.Errorf("missing schema type %q", typeName)
	}

	switch node.Kind {
	case ast.NodeKindEnumTypeDefinition:
		s.set("type", "string")
		s.set("enum", r.enumValues(node.Ref))
		return s, nil
	case ast.NodeKindScalarTypeDefinition:
		// Custom scalars: leave the type open. JSON Schema's empty schema {}
		// matches anything; we instead emit type:any-of-known to keep clients
		// from misvalidating. The simplest acceptable encoding is no `type`.
		return s, nil
	case ast.NodeKindInputObjectTypeDefinition:
		return r.inputObject(node.Ref)
	default:
		return s, nil
	}
}

func (r renderer) enumValues(enumRef int) []string {
	def := r.schema.EnumTypeDefinitions[enumRef]
	values := make([]string, 0, len(def.EnumValuesDefinition.Refs))
	for _, valueRef := range def.EnumValuesDefinition.Refs {
		values = append(values, r.schema.EnumValueDefinitionNameString(valueRef))
	}
	return values
}

func (r renderer) inputObject(inputObjectRef int) (orderedSchema, error) {
	def := r.schema.InputObjectTypeDefinitions[inputObjectRef]
	s := orderedSchema{}
	s.set("type", "object")

	props := orderedSchema{}
	required := make([]string, 0, len(def.InputFieldsDefinition.Refs))
	for _, fieldRef := range def.InputFieldsDefinition.Refs {
		name := r.schema.InputValueDefinitionNameString(fieldRef)
		typeRef := r.schema.InputValueDefinitionType(fieldRef)
		isRequired := r.schema.Types[typeRef].TypeKind == ast.TypeKindNonNull

		field, err := r.schemaType(typeRef)
		if err != nil {
			return orderedSchema{}, err
		}
		props.set(name, field)
		if isRequired {
			required = append(required, name)
		}
	}
	s.set("properties", props)
	if len(required) > 0 {
		s.set("required", required)
	}
	return s, nil
}

// schemaType walks types in the schema document (input fields nested inside
// input objects). Mirrors opType but reads from r.schema.
func (r renderer) schemaType(typeRef int) (orderedSchema, error) {
	gqlType := r.schema.Types[typeRef]
	switch gqlType.TypeKind {
	case ast.TypeKindNonNull:
		return r.schemaTypeNonNull(gqlType.OfType)
	case ast.TypeKindList:
		inner, err := r.schemaType(gqlType.OfType)
		if err != nil {
			return orderedSchema{}, err
		}
		s := orderedSchema{}
		s.set("type", []string{"array", "null"})
		s.set("items", inner)
		return s, nil
	case ast.TypeKindNamed:
		s, err := r.namedType(r.schema.TypeNameString(typeRef))
		if err != nil {
			return orderedSchema{}, err
		}
		return makeNullable(s), nil
	default:
		return orderedSchema{}, fmt.Errorf("unsupported GraphQL input type kind %s", gqlType.TypeKind.String())
	}
}

func (r renderer) schemaTypeNonNull(typeRef int) (orderedSchema, error) {
	gqlType := r.schema.Types[typeRef]
	switch gqlType.TypeKind {
	case ast.TypeKindNonNull:
		return r.schemaTypeNonNull(gqlType.OfType)
	case ast.TypeKindList:
		inner, err := r.schemaType(gqlType.OfType)
		if err != nil {
			return orderedSchema{}, err
		}
		s := orderedSchema{}
		s.set("type", "array")
		s.set("items", inner)
		return s, nil
	case ast.TypeKindNamed:
		return r.namedType(r.schema.TypeNameString(typeRef))
	default:
		return orderedSchema{}, fmt.Errorf("unsupported GraphQL input type kind %s", gqlType.TypeKind.String())
	}
}

// makeNullable widens a JSON Schema to also accept null. If the schema has no
// `type` (e.g. custom scalar with open type), it is returned unchanged.
func makeNullable(s orderedSchema) orderedSchema {
	for i, p := range s.pairs {
		if p.key != "type" {
			continue
		}
		switch v := p.value.(type) {
		case string:
			s.pairs[i].value = []string{v, "null"}
		case []string:
			if !slices.Contains(v, "null") {
				s.pairs[i].value = append(v, "null")
			}
		}
		return s
	}
	return s
}
