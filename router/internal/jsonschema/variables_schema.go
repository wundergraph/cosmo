// Package jsonschema generates a JSON Schema (2020-12) for the variables of a
// GraphQL operation, emitting nodes of github.com/google/jsonschema-go.
//
// Invariant: no schema node is modified after its construction completes.
// Nullability is decided before a node is built and baked in at construction;
// use-site adornments (description, default) are applied by building a fresh
// copy. Because nothing mutates finished nodes, sharing them (scalar override
// map values, "$defs" bodies) is safe without copying.
package jsonschema

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvisitor"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
)

// VariablesSchemaBuilder creates a unified JSON schema for the variables of a GraphQL operation
type VariablesSchemaBuilder struct {
	operationDocument  *ast.Document
	definitionDocument *ast.Document
	schema             *jsonschema.Schema
	report             *operationreport.Report
	// recursiveTypes holds the names of input types that are self- or mutually
	// recursive. They are emitted once under the root "$defs" and referenced via
	// "$ref" instead of being inlined, which supports arbitrary nesting depth.
	recursiveTypes map[string]bool
	// defs accumulates schemas for recursive input types; attached to the root
	// schema as "$defs".
	defs map[string]*jsonschema.Schema
	// scalarSchemas overrides the schema emitted per custom scalar type name.
	scalarSchemas map[string]*jsonschema.Schema
	// defaultedScalars records custom scalars that fell back to the string
	// default, so callers can surface missing mappings.
	defaultedScalars map[string]bool
}

// VariablesSchemaOption configures a VariablesSchemaBuilder.
type VariablesSchemaOption func(*VariablesSchemaBuilder)

// WithScalarSchemas overrides the JSON schema emitted for custom scalar types,
// keyed by scalar type name. Unmapped custom scalars default to "string".
// Built-in scalars (String, ID, Int, Float, Boolean) cannot be overridden.
// Each override must set Type (a single JSON type name), never Types: the
// builder derives the nullable form from Type per use site.
func WithScalarSchemas(schemas map[string]*jsonschema.Schema) VariablesSchemaOption {
	return func(v *VariablesSchemaBuilder) {
		v.scalarSchemas = schemas
	}
}

// Ensure VariablesSchemaBuilder implements the necessary astvisitor interfaces
var (
	_ astvisitor.EnterDocumentVisitor           = (*VariablesSchemaBuilder)(nil)
	_ astvisitor.EnterVariableDefinitionVisitor = (*VariablesSchemaBuilder)(nil)
)

// NewVariablesSchemaBuilder creates a new VariablesSchemaBuilder.
func NewVariablesSchemaBuilder(operationDocument, definitionDocument *ast.Document, opts ...VariablesSchemaOption) *VariablesSchemaBuilder {
	v := &VariablesSchemaBuilder{
		operationDocument:  operationDocument,
		definitionDocument: definitionDocument,
		schema:             newRootSchema(),
		report:             &operationreport.Report{},
		recursiveTypes:     make(map[string]bool),
		defs:               make(map[string]*jsonschema.Schema),
		defaultedScalars:   make(map[string]bool),
	}

	for _, opt := range opts {
		opt(v)
	}

	return v
}

// EnterDocument implements the astvisitor.EnterDocumentVisitor interface
func (v *VariablesSchemaBuilder) EnterDocument(operation, definition *ast.Document) {
	if len(operation.OperationDefinitions) == 0 {
		return
	}

	v.schema = newRootSchema()
	v.defs = make(map[string]*jsonschema.Schema)      // Reset defs for each build
	v.defaultedScalars = make(map[string]bool)        // Reset defaulted scalars for each build
	v.recursiveTypes = v.computeRecursiveInputTypes() // Identify recursive input types

	// Extract descriptions from root fields
	var descriptions []string

	operationDefinition := operation.OperationDefinitions[0]

	// Process SelectionSet to extract field descriptions
	if operationDefinition.HasSelections {
		selectionSetRef := operationDefinition.SelectionSet
		for _, selectionRef := range operation.SelectionSets[selectionSetRef].SelectionRefs {
			selection := operation.Selections[selectionRef]
			if selection.Kind == ast.SelectionKindField {
				fieldName := operation.FieldNameString(selection.Ref)

				// Look up field in schema definition to get description
				operationType := operationDefinition.OperationType
				var rootTypeName string

				// Determine root type based on operation type
				switch operationType {
				case ast.OperationTypeQuery:
					rootTypeName = "Query"
				case ast.OperationTypeMutation:
					rootTypeName = "Mutation"
				case ast.OperationTypeSubscription:
					rootTypeName = "Subscription"
				default:
					v.report.AddInternalError(fmt.Errorf("unsupported operation type %q", operationType))
					return
				}

				rootType, exists := definition.Index.FirstNodeByNameStr(rootTypeName)
				if exists && rootType.Kind == ast.NodeKindObjectTypeDefinition {
					// Find the field in the root type
					for _, fieldDefRef := range definition.ObjectTypeDefinitions[rootType.Ref].FieldsDefinition.Refs {
						fieldDefName := definition.FieldDefinitionNameString(fieldDefRef)

						// Match field name
						if fieldDefName == fieldName && definition.FieldDefinitions[fieldDefRef].Description.IsDefined {
							description := definition.FieldDefinitionDescriptionString(fieldDefRef)
							if description != "" {
								descriptions = append(descriptions, description)
							}
							break
						}
					}
				}
			}
		}
	}

	// Set concatenated descriptions on root schema if any were found
	if len(descriptions) > 0 {
		v.schema.Description = strings.Join(descriptions, " ")
	}
}

// EnterVariableDefinition implements the astvisitor.EnterVariableDefinitionVisitor interface
func (v *VariablesSchemaBuilder) EnterVariableDefinition(ref int) {
	varName := v.operationDocument.VariableDefinitionNameString(ref)
	typeRef := v.operationDocument.VariableDefinitions[ref].Type

	// Convert type to schema starting from the operation document
	varSchema := v.typeRefSchema(v.operationDocument, typeRef)

	// Skip this variable if its type could not be resolved to a schema
	if varSchema == nil {
		return
	}

	// Add variable to required list if it's non-nullable
	if v.operationDocument.TypeIsNonNull(typeRef) {
		v.schema.Required = append(v.schema.Required, varName)
	}

	var description string
	if v.operationDocument.VariableDefinitions[ref].Description.IsDefined {
		description = v.operationDocument.VariableDefinitionDescriptionString(ref)
	}

	var defaultValue any
	if v.operationDocument.VariableDefinitionHasDefaultValue(ref) {
		defaultValue = v.convertOperationValueToNative(v.operationDocument.VariableDefinitionDefaultValue(ref))
	}

	varSchema = v.adorned(varSchema, description, defaultValue)

	// Top-level object-typed variable schemas are always non-nullable: strict
	// consumers reject tool inputs whose top-level objects admit null, and an
	// omitted variable is expressed by leaving it out, not by passing null.
	if len(varSchema.Types) > 0 && varSchema.Types[0] == "object" {
		nonNull := *varSchema
		nonNull.Type = "object"
		nonNull.Types = nil
		varSchema = &nonNull
	}

	// Add variable to schema
	if v.schema.Properties == nil {
		v.schema.Properties = make(map[string]*jsonschema.Schema)
	}
	v.schema.Properties[varName] = varSchema
}

// GetSchema attaches the accumulated "$defs" to the root schema and returns it.
func (v *VariablesSchemaBuilder) GetSchema() *jsonschema.Schema {
	if len(v.defs) > 0 {
		v.schema.Defs = v.defs
	}
	return v.schema
}

// GetReport returns the report containing any errors
func (v *VariablesSchemaBuilder) GetReport() *operationreport.Report {
	return v.report
}

// DefaultedScalars returns the sorted names of custom scalars that fell back
// to the default "string" schema during the last build.
func (v *VariablesSchemaBuilder) DefaultedScalars() []string {
	names := make([]string, 0, len(v.defaultedScalars))
	for name := range v.defaultedScalars {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// Build traverses the operation and builds a unified JSON schema for its variables
func (v *VariablesSchemaBuilder) Build() (*jsonschema.Schema, error) {
	// Create a new walker for AST traversal
	walker := astvisitor.NewDefaultWalker()

	// Register this builder as a visitor
	walker.RegisterEnterDocumentVisitor(v)
	walker.RegisterEnterVariableDefinitionVisitor(v)

	// Walk the AST
	walker.Walk(v.operationDocument, v.definitionDocument, v.report)

	if v.report.HasErrors() {
		return nil, fmt.Errorf("%s", v.report.Error())
	}

	return v.GetSchema(), nil
}

// typeRefSchema builds the schema node for a type reference in doc. The
// nullability of the node is computed from the NonNull wrapper before the node
// is built, so it is baked in at construction.
func (v *VariablesSchemaBuilder) typeRefSchema(doc *ast.Document, typeRef int) *jsonschema.Schema {
	nullable := true
	for doc.Types[typeRef].TypeKind == ast.TypeKindNonNull {
		nullable = false
		typeRef = doc.Types[typeRef].OfType
	}

	switch doc.Types[typeRef].TypeKind {
	case ast.TypeKindList:
		itemSchema := v.typeRefSchema(doc, doc.Types[typeRef].OfType)
		if itemSchema == nil {
			return nil
		}
		return newArraySchema(itemSchema, nullable)

	case ast.TypeKindNamed:
		return v.namedTypeSchema(doc.TypeNameString(typeRef), nullable)

	default:
		return nil
	}
}

// namedTypeSchema builds the schema node for a named type, looking it up in
// the definition document.
func (v *VariablesSchemaBuilder) namedTypeSchema(typeName string, nullable bool) *jsonschema.Schema {
	// Handle built-in scalars
	switch typeName {
	case "String", "ID":
		return newTypedSchema("string", nullable)
	case "Int":
		return newTypedSchema("integer", nullable)
	case "Float":
		return newTypedSchema("number", nullable)
	case "Boolean":
		return newTypedSchema("boolean", nullable)
	}

	// For custom types, look up in the definition document
	node, exists := v.definitionDocument.Index.FirstNodeByNameStr(typeName)
	if !exists {
		v.report.AddInternalError(fmt.Errorf("type %s is not defined", typeName))
		return newObjectSchema(nullable)
	}

	// Recursive input types are emitted once under "$defs" and referenced via
	// "$ref" so that nesting is permitted to any depth.
	if node.Kind == ast.NodeKindInputObjectTypeDefinition && v.recursiveTypes[typeName] {
		v.ensureDef(typeName, node)
		return newRefSchema(typeName, nullable)
	}

	// Process the type based on its kind
	switch node.Kind {
	case ast.NodeKindEnumTypeDefinition:
		return v.enumTypeSchema(node, nullable)

	case ast.NodeKindInputObjectTypeDefinition:
		return v.inputObjectTypeSchema(node, nullable)

	case ast.NodeKindScalarTypeDefinition:
		return v.scalarTypeSchema(typeName, node, nullable)

	default:
		// If we can't determine the type, emit the empty schema, which accepts
		// any value. The zero-value Schema marshals as the boolean schema true, not {}.
		return &jsonschema.Schema{}
	}
}

// scalarTypeSchema builds the schema node for a custom scalar, honoring the
// configured override if one exists.
func (v *VariablesSchemaBuilder) scalarTypeSchema(typeName string, node ast.Node, nullable bool) *jsonschema.Schema {
	var sdlDescription string
	if v.definitionDocument.ScalarTypeDefinitions[node.Ref].Description.IsDefined {
		sdlDescription = v.definitionDocument.ScalarTypeDefinitionDescriptionString(node.Ref)
	}

	override, ok := v.scalarSchemas[typeName]
	if !ok {
		// Custom scalars are opaque to JSON Schema. Emit a best-effort "string"
		// type: MCP/LLM tool consumers reject or degrade on untyped properties,
		// and opaque scalars are overwhelmingly strings on the wire. Callers can
		// override per scalar via WithScalarSchemas.
		v.defaultedScalars[typeName] = true
		schema := newTypedSchema("string", nullable)
		schema.Description = sdlDescription
		return schema
	}

	if override.Description != "" {
		sdlDescription = "" // the override's own description wins
	}

	if !nullable && sdlDescription == "" {
		// Nothing to change for this use site: share the override node itself.
		// Safe because no node is ever modified after construction.
		return override
	}

	schema := *override
	if nullable {
		schema.Type = ""
		schema.Types = []string{override.Type, "null"}
	}
	if sdlDescription != "" {
		schema.Description = sdlDescription
	}
	return &schema
}

// enumTypeSchema builds the schema node for an enum type definition.
func (v *VariablesSchemaBuilder) enumTypeSchema(node ast.Node, nullable bool) *jsonschema.Schema {
	enumDef := v.definitionDocument.EnumTypeDefinitions[node.Ref]

	values := make([]string, 0, len(enumDef.EnumValuesDefinition.Refs))
	for _, valueRef := range enumDef.EnumValuesDefinition.Refs {
		values = append(values, v.definitionDocument.EnumValueDefinitionNameString(valueRef))
	}

	schema := newEnumSchema(values, nullable)

	// Add description if available
	if enumDef.Description.IsDefined {
		schema.Description = v.definitionDocument.EnumTypeDefinitionDescriptionString(node.Ref)
	}

	return schema
}

// inputObjectTypeSchema builds the schema node for an input object type
// definition, including its fields.
func (v *VariablesSchemaBuilder) inputObjectTypeSchema(node ast.Node, nullable bool) *jsonschema.Schema {
	schema := newObjectSchema(nullable)
	inputDef := v.definitionDocument.InputObjectTypeDefinitions[node.Ref]

	// Set description if available
	if inputDef.Description.IsDefined {
		schema.Description = v.definitionDocument.InputObjectTypeDefinitionDescriptionString(node.Ref)
	}

	if !inputDef.HasInputFieldsDefinition {
		return schema
	}

	// Process each input field
	for _, fieldRef := range inputDef.InputFieldsDefinition.Refs {
		v.processInputField(fieldRef, schema)
	}

	return schema
}

// processInputField adds a single input field to the parent object schema,
// which is still under construction.
func (v *VariablesSchemaBuilder) processInputField(fieldRef int, parent *jsonschema.Schema) {
	fieldName := v.definitionDocument.InputValueDefinitionNameString(fieldRef)
	fieldTypeRef := v.definitionDocument.InputValueDefinitionType(fieldRef)

	// Process the field type starting from the definition document
	fieldSchema := v.typeRefSchema(v.definitionDocument, fieldTypeRef)

	// Skip this field if its type could not be resolved to a schema
	if fieldSchema == nil {
		return
	}

	// Add to required list if non-nullable
	if v.definitionDocument.TypeIsNonNull(fieldTypeRef) {
		parent.Required = append(parent.Required, fieldName)
	}

	var description string
	if v.definitionDocument.InputValueDefinitions[fieldRef].Description.IsDefined {
		description = v.definitionDocument.InputValueDefinitionDescriptionString(fieldRef)
	}

	var defaultValue any
	if v.definitionDocument.InputValueDefinitionHasDefaultValue(fieldRef) {
		defaultValue = v.convertDefinitionValueToNative(v.definitionDocument.InputValueDefinitionDefaultValue(fieldRef))
	}

	// Add field to schema
	if parent.Properties == nil {
		parent.Properties = make(map[string]*jsonschema.Schema)
	}
	parent.Properties[fieldName] = v.adorned(fieldSchema, description, defaultValue)
}

// adorned returns schema with the given use-site description and default
// applied. Adornments go onto a fresh shallow copy: the input node may be
// shared (a scalar override) and is never modified.
func (v *VariablesSchemaBuilder) adorned(schema *jsonschema.Schema, description string, defaultValue any) *jsonschema.Schema {
	if description == "" && defaultValue == nil {
		return schema
	}
	adorned := *schema
	if description != "" {
		adorned.Description = description
	}
	if defaultValue != nil {
		adorned.Default = v.rawDefault(defaultValue)
	}
	return &adorned
}

// rawDefault marshals a native Go default value for embedding in a node at
// construction time.
func (v *VariablesSchemaBuilder) rawDefault(value any) json.RawMessage {
	data, err := json.Marshal(value)
	if err != nil {
		v.report.AddInternalError(fmt.Errorf("failed to marshal default value: %w", err))
		return nil
	}
	return data
}

// computeRecursiveInputTypes returns the set of input object type names that are
// self- or mutually-recursive, i.e. reachable from themselves by following input
// field type references. These are the types that must be referenced via "$ref"
// rather than inlined.
func (v *VariablesSchemaBuilder) computeRecursiveInputTypes() map[string]bool {
	def := v.definitionDocument

	// Build the dependency graph between input object types.
	dependencies := make(map[string][]string, len(def.InputObjectTypeDefinitions))
	for ref := range def.InputObjectTypeDefinitions {
		name := def.InputObjectTypeDefinitionNameString(ref)
		inputDef := def.InputObjectTypeDefinitions[ref]
		if !inputDef.HasInputFieldsDefinition {
			dependencies[name] = nil
			continue
		}
		for _, fieldRef := range inputDef.InputFieldsDefinition.Refs {
			fieldType := def.InputValueDefinitionType(fieldRef)
			dependencies[name] = append(dependencies[name], def.ResolveTypeNameString(fieldType))
		}
	}

	recursive := make(map[string]bool)
	for start := range dependencies {
		if reachableFromSelf(start, dependencies) {
			recursive[start] = true
		}
	}
	return recursive
}

// reachableFromSelf reports whether start can reach itself by following the given
// type dependencies (detecting both self- and mutual recursion).
func reachableFromSelf(start string, dependencies map[string][]string) bool {
	visited := make(map[string]bool)
	stack := append([]string(nil), dependencies[start]...)
	for len(stack) > 0 {
		current := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if current == start {
			return true
		}
		if visited[current] {
			continue
		}
		visited[current] = true
		stack = append(stack, dependencies[current]...)
	}
	return false
}

// ensureDef generates the schema for a recursive input type once and stores it
// under "$defs". A placeholder is registered before the body is generated so that
// self-references encountered during generation resolve to a "$ref" rather than
// recursing infinitely; the map entry is then replaced with the real body.
func (v *VariablesSchemaBuilder) ensureDef(typeName string, node ast.Node) {
	if _, ok := v.defs[typeName]; ok {
		return
	}
	v.defs[typeName] = newObjectSchema(false) // placeholder to break the recursion
	// The definition body is canonical (non-null); nullability is applied per
	// use site on the "$ref" node (an anyOf-with-null wrapper when nullable).
	v.defs[typeName] = v.inputObjectTypeSchema(node, false)
}

// convertOperationValueToNative converts a GraphQL AST value from the operation document to a native Go value
func (v *VariablesSchemaBuilder) convertOperationValueToNative(value ast.Value) any {
	switch value.Kind {
	case ast.ValueKindString:
		return v.operationDocument.StringValueContentString(value.Ref)
	case ast.ValueKindInteger:
		return v.operationDocument.IntValueAsInt(value.Ref)
	case ast.ValueKindFloat:
		return v.operationDocument.FloatValueAsFloat32(value.Ref)
	case ast.ValueKindBoolean:
		return v.operationDocument.BooleanValue(value.Ref)
	case ast.ValueKindNull:
		return nil
	case ast.ValueKindEnum:
		return v.operationDocument.EnumValueNameString(value.Ref)
	case ast.ValueKindList:
		list := make([]any, 0)
		for _, itemRef := range v.operationDocument.ListValues[value.Ref].Refs {
			item := v.operationDocument.Value(itemRef)
			list = append(list, v.convertOperationValueToNative(item))
		}
		return list
	case ast.ValueKindObject:
		obj := make(map[string]any)
		for _, fieldRef := range v.operationDocument.ObjectValues[value.Ref].Refs {
			fieldName := v.operationDocument.ObjectFieldNameString(fieldRef)
			fieldValue := v.operationDocument.ObjectFieldValue(fieldRef)
			obj[fieldName] = v.convertOperationValueToNative(fieldValue)
		}
		return obj
	}

	return nil
}

// convertDefinitionValueToNative converts a GraphQL AST value from the definition document to a native Go value
func (v *VariablesSchemaBuilder) convertDefinitionValueToNative(value ast.Value) any {
	switch value.Kind {
	case ast.ValueKindString:
		return v.definitionDocument.StringValueContentString(value.Ref)
	case ast.ValueKindInteger:
		return v.definitionDocument.IntValueAsInt(value.Ref)
	case ast.ValueKindFloat:
		return v.definitionDocument.FloatValueAsFloat32(value.Ref)
	case ast.ValueKindBoolean:
		return v.definitionDocument.BooleanValue(value.Ref)
	case ast.ValueKindNull:
		return nil
	case ast.ValueKindEnum:
		return v.definitionDocument.EnumValueNameString(value.Ref)
	case ast.ValueKindList:
		list := make([]any, 0)
		for _, itemRef := range v.definitionDocument.ListValues[value.Ref].Refs {
			item := v.definitionDocument.Value(itemRef)
			list = append(list, v.convertDefinitionValueToNative(item))
		}
		return list
	case ast.ValueKindObject:
		obj := make(map[string]any)
		for _, fieldRef := range v.definitionDocument.ObjectValues[value.Ref].Refs {
			fieldName := v.definitionDocument.ObjectFieldNameString(fieldRef)
			fieldValue := v.definitionDocument.ObjectFieldValue(fieldRef)
			obj[fieldName] = v.convertDefinitionValueToNative(fieldValue)
		}
		return obj
	}

	return nil
}

// newRootSchema returns the root variables object. The root is always a
// non-nullable "object": the variables container is either present or omitted,
// never the JSON literal null, and strict consumers such as the MCP SDK
// require the input schema's root type to be exactly "object".
func newRootSchema() *jsonschema.Schema {
	return newObjectSchema(false)
}

// newTypedSchema returns a node for a single JSON type. Nullable use sites get
// the JSON Schema 2020-12 type union [<type>, "null"] instead of the OpenAPI
// 3.0 "nullable" keyword, which standard validators ignore.
func newTypedSchema(typeName string, nullable bool) *jsonschema.Schema {
	if nullable {
		return &jsonschema.Schema{Types: []string{typeName, "null"}}
	}
	return &jsonschema.Schema{Type: typeName}
}

// newObjectSchema returns an object node that disallows unknown properties.
// Properties stays nil until the first property is added, so that objects
// without properties marshal without a "properties" key.
func newObjectSchema(nullable bool) *jsonschema.Schema {
	schema := newTypedSchema("object", nullable)
	schema.AdditionalProperties = falseSchema()
	return schema
}

// falseSchema returns the schema that rejects every value;
// github.com/google/jsonschema-go marshals it as the literal false.
func falseSchema() *jsonschema.Schema {
	return &jsonschema.Schema{Not: &jsonschema.Schema{}}
}

// newArraySchema returns an array node with the given item schema.
func newArraySchema(items *jsonschema.Schema, nullable bool) *jsonschema.Schema {
	schema := newTypedSchema("array", nullable)
	schema.Items = items
	return schema
}

// newEnumSchema returns a string-typed enum node. A nullable enum additionally
// appends null to the value list, since the type union alone does not extend
// the allowed enum values.
func newEnumSchema(values []string, nullable bool) *jsonschema.Schema {
	schema := newTypedSchema("string", nullable)
	if len(values) == 0 {
		return schema
	}
	enum := make([]any, 0, len(values)+1)
	for _, value := range values {
		enum = append(enum, value)
	}
	if nullable {
		enum = append(enum, nil)
	}
	schema.Enum = enum
	return schema
}

// newRefSchema returns a node referencing a definition under the root "$defs".
// A nullable use site wraps the reference in anyOf with the null type, the
// 2020-12 form for a nullable "$ref"; the definition body itself stays
// canonical (non-null).
func newRefSchema(typeName string, nullable bool) *jsonschema.Schema {
	ref := &jsonschema.Schema{Ref: defsRef(typeName)}
	if nullable {
		return &jsonschema.Schema{
			AnyOf: []*jsonschema.Schema{ref, {Type: "null"}},
		}
	}
	return ref
}

// defsRef returns the JSON Pointer to a definition under the root "$defs".
func defsRef(typeName string) string {
	return "#/$defs/" + typeName
}

// BuildJsonSchema builds a JSON schema for the variables of the given operation.
// Recursive input types are represented via "$ref"/"$defs" and support arbitrary
// nesting depth.
func BuildJsonSchema(operationDocument, definitionDocument *ast.Document, opts ...VariablesSchemaOption) (*jsonschema.Schema, error) {
	if len(operationDocument.OperationDefinitions) == 0 {
		return nil, fmt.Errorf("no operations found in document")
	}

	return NewVariablesSchemaBuilder(operationDocument, definitionDocument, opts...).Build()
}
