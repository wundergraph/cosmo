package jsonschema

import (
	"fmt"
	"sort"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvisitor"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
)

// VariablesSchemaBuilder creates a unified JSON schema for the variables of a GraphQL operation
type VariablesSchemaBuilder struct {
	operationDocument  *ast.Document
	definitionDocument *ast.Document
	schema             *JsonSchema
	report             *operationreport.Report
	// recursiveTypes holds the names of input types that are self- or mutually
	// recursive. They are emitted once under the root "$defs" and referenced via
	// "$ref" instead of being inlined, which supports arbitrary nesting depth.
	recursiveTypes map[string]bool
	// defs accumulates schemas for recursive input types; attached to the root
	// schema as "$defs".
	defs map[string]*JsonSchema
	// scalarSchemas overrides the schema emitted per custom scalar type name.
	scalarSchemas map[string]*JsonSchema
	// defaultedScalars records custom scalars that fell back to the string
	// default, so callers can surface missing mappings.
	defaultedScalars map[string]bool
}

// VariablesSchemaOption configures a VariablesSchemaBuilder.
type VariablesSchemaOption func(*VariablesSchemaBuilder)

// WithScalarSchemas overrides the JSON schema emitted for custom scalar types,
// keyed by scalar type name. Unmapped custom scalars default to "string".
// Built-in scalars (String, ID, Int, Float, Boolean) cannot be overridden.
func WithScalarSchemas(schemas map[string]*JsonSchema) VariablesSchemaOption {
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
		schema:             NewObjectSchema(),
		report:             &operationreport.Report{},
		recursiveTypes:     make(map[string]bool),
		defs:               make(map[string]*JsonSchema),
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

	v.schema = NewObjectSchema()
	v.defs = make(map[string]*JsonSchema)             // Reset defs for each build
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
		v.schema.Description = ""
		for i, desc := range descriptions {
			if i > 0 {
				v.schema.Description += " "
			}
			v.schema.Description += desc
		}
	}
}

// EnterVariableDefinition implements the astvisitor.EnterVariableDefinitionVisitor interface
func (v *VariablesSchemaBuilder) EnterVariableDefinition(ref int) {
	varName := v.operationDocument.VariableDefinitionNameString(ref)
	typeRef := v.operationDocument.VariableDefinitions[ref].Type

	// Convert type to schema starting from the operation document
	varSchema := v.processOperationTypeRef(typeRef)

	// Skip this variable if its type could not be resolved to a schema
	if varSchema == nil {
		return
	}

	// Add variable to required list if it's non-nullable
	if v.operationDocument.TypeIsNonNull(typeRef) {
		v.schema.Required = append(v.schema.Required, varName)
	}

	if v.operationDocument.VariableDefinitions[ref].Description.IsDefined {
		varSchema.Description = v.operationDocument.VariableDefinitionDescriptionString(ref)
	}

	// Set default value if exists
	if v.operationDocument.VariableDefinitionHasDefaultValue(ref) {
		defaultValue := v.operationDocument.VariableDefinitionDefaultValue(ref)
		varSchema.Default = v.convertOperationValueToNative(defaultValue)
	}

	// Force top-level object fields to be not nullable (Nullable=false) so they can't be null
	// This ensures they appear as empty objects at minimum
	if varSchema.Type == TypeObject {
		// Setting Nullable to false means the field can't be null
		// Since the nullable field is only included when true, this effectively removes it
		// from the output JSON, which is what we want
		varSchema.Nullable = false
	}

	// Add variable to schema
	v.schema.Properties[varName] = varSchema
}

// GetSchema returns the built schema
func (v *VariablesSchemaBuilder) GetSchema() *JsonSchema {
	// The root variables object is always a concrete object and must never be
	// nullable: the variables container is either present or omitted, never the
	// JSON literal null. Emitting a nullable root (type ["object","null"] under
	// JSON Schema 2020-12) breaks strict consumers such as the MCP SDK, which
	// require the input schema's type to be exactly "object".
	v.schema.Nullable = false
	// Attach definitions for any recursive input types referenced via "$ref"
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
func (v *VariablesSchemaBuilder) Build() (*JsonSchema, error) {
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

// processOperationTypeRef processes a type reference from the operation document
func (v *VariablesSchemaBuilder) processOperationTypeRef(typeRef int) *JsonSchema {
	switch v.operationDocument.Types[typeRef].TypeKind {
	case ast.TypeKindNonNull:
		ofType := v.operationDocument.Types[typeRef].OfType
		schema := v.processOperationTypeRef(ofType)
		if schema == nil {
			return nil
		}
		// Non-null types are not nullable
		schema.Nullable = false
		return schema

	case ast.TypeKindList:
		ofType := v.operationDocument.Types[typeRef].OfType
		itemSchema := v.processOperationTypeRef(ofType)
		if itemSchema == nil {
			return nil
		}
		// If we're not in a non-null context, list is nullable
		schema := NewArraySchema(itemSchema)
		schema.Nullable = true
		return schema

	case ast.TypeKindNamed:
		typeName := v.operationDocument.TypeNameString(typeRef)
		schema := v.processTypeByName(typeName)
		if schema != nil {
			// If we're not in a non-null context, named type is nullable
			schema.Nullable = true
		}
		return schema
	}

	return nil
}

// processTypeByName processes a type by its name, looking it up in the definition document
func (v *VariablesSchemaBuilder) processTypeByName(typeName string) *JsonSchema {
	// Handle built-in scalars
	switch typeName {
	case "String", "ID":
		return NewStringSchema()
	case "Int":
		return NewIntegerSchema()
	case "Float":
		return NewNumberSchema()
	case "Boolean":
		return NewBooleanSchema()
	}

	// For custom types, look up in the definition document
	node, exists := v.definitionDocument.Index.FirstNodeByNameStr(typeName)
	if !exists {
		v.report.AddInternalError(fmt.Errorf("type %s is not defined", typeName))
		return NewObjectSchema()
	}

	// Recursive input types are emitted once under "$defs" and referenced via
	// "$ref" so that nesting is permitted to any depth.
	if node.Kind == ast.NodeKindInputObjectTypeDefinition && v.recursiveTypes[typeName] {
		v.ensureDef(typeName, node)
		return NewRefSchema(typeName)
	}

	// Process the type based on its kind
	switch node.Kind {
	case ast.NodeKindEnumTypeDefinition:
		return v.processEnumType(node)

	case ast.NodeKindInputObjectTypeDefinition:
		return v.processInputObjectType(node)

	case ast.NodeKindScalarTypeDefinition:
		if override, ok := v.scalarSchemas[typeName]; ok {
			// Clone per use: the builder mutates Nullable on returned schemas
			// depending on each variable's non-null context.
			schema := override.Clone()
			if schema.Description == "" && v.definitionDocument.ScalarTypeDefinitions[node.Ref].Description.IsDefined {
				schema.Description = v.definitionDocument.ScalarTypeDefinitionDescriptionString(node.Ref)
			}
			return schema
		}
		// Custom scalars are opaque to JSON Schema. Emit a best-effort "string"
		// type: MCP/LLM tool consumers reject or degrade on untyped properties,
		// and opaque scalars are overwhelmingly strings on the wire. Callers can
		// override per scalar via WithScalarSchemas.
		v.defaultedScalars[typeName] = true
		schema := NewStringSchema()
		if v.definitionDocument.ScalarTypeDefinitions[node.Ref].Description.IsDefined {
			schema.Description = v.definitionDocument.ScalarTypeDefinitionDescriptionString(node.Ref)
		}
		return schema

	default:
		// If we can't determine the type, default to any
		return NewAnySchema()
	}
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
// recursing infinitely.
func (v *VariablesSchemaBuilder) ensureDef(typeName string, node ast.Node) {
	if _, ok := v.defs[typeName]; ok {
		return
	}
	v.defs[typeName] = NewObjectSchema() // placeholder to break the recursion
	body := v.processInputObjectType(node)
	// The definition body is the type itself, not nullable; nullability is
	// applied per use-site via the "$ref" (rewritten as anyOf-with-null when
	// the referencing context is nullable).
	body.Nullable = false
	v.defs[typeName] = body
}

// processEnumType processes an enum type definition
func (v *VariablesSchemaBuilder) processEnumType(node ast.Node) *JsonSchema {
	values := make([]string, 0)
	enumDef := v.definitionDocument.EnumTypeDefinitions[node.Ref]

	for _, valueRef := range enumDef.EnumValuesDefinition.Refs {
		valueName := v.definitionDocument.EnumValueDefinitionNameString(valueRef)
		values = append(values, valueName)
	}

	schema := NewEnumSchema(values)

	// Add description if available
	if enumDef.Description.IsDefined {
		schema.Description = v.definitionDocument.EnumTypeDefinitionDescriptionString(node.Ref)
	}

	return schema
}

// processInputObjectType processes an input object type definition
func (v *VariablesSchemaBuilder) processInputObjectType(node ast.Node) *JsonSchema {
	schema := NewObjectSchema()
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

// processInputField processes a single input field
func (v *VariablesSchemaBuilder) processInputField(fieldRef int, schema *JsonSchema) {
	fieldName := v.definitionDocument.InputValueDefinitionNameString(fieldRef)
	fieldTypeRef := v.definitionDocument.InputValueDefinitionType(fieldRef)

	// Process the field type starting from the definition document
	fieldSchema := v.processDefinitionTypeRef(fieldTypeRef)

	// Skip this field if its type could not be resolved to a schema
	if fieldSchema == nil {
		return
	}

	// Add to required list if non-nullable
	if v.definitionDocument.TypeIsNonNull(fieldTypeRef) {
		schema.Required = append(schema.Required, fieldName)
	}

	// Set field description if exists
	if v.definitionDocument.InputValueDefinitions[fieldRef].Description.IsDefined {
		description := v.definitionDocument.InputValueDefinitionDescriptionString(fieldRef)
		fieldSchema.Description = description
	}

	// Set default value if exists
	if v.definitionDocument.InputValueDefinitionHasDefaultValue(fieldRef) {
		defaultValue := v.definitionDocument.InputValueDefinitionDefaultValue(fieldRef)
		fieldSchema.Default = v.convertDefinitionValueToNative(defaultValue)
	}

	// Add field to schema
	schema.Properties[fieldName] = fieldSchema
}

// processDefinitionTypeRef processes a type reference from the definition document
func (v *VariablesSchemaBuilder) processDefinitionTypeRef(typeRef int) *JsonSchema {
	switch v.definitionDocument.Types[typeRef].TypeKind {
	case ast.TypeKindNonNull:
		ofType := v.definitionDocument.Types[typeRef].OfType
		schema := v.processDefinitionTypeRef(ofType)
		if schema == nil {
			return nil
		}
		// Non-null types are not nullable
		schema.Nullable = false
		return schema

	case ast.TypeKindList:
		ofType := v.definitionDocument.Types[typeRef].OfType
		itemSchema := v.processDefinitionTypeRef(ofType)
		if itemSchema == nil {
			return nil
		}
		// If we're not in a non-null context, list is nullable
		schema := NewArraySchema(itemSchema)
		schema.Nullable = true
		return schema

	case ast.TypeKindNamed:
		typeName := v.definitionDocument.TypeNameString(typeRef)
		schema := v.processTypeByName(typeName)
		if schema != nil {
			// If we're not in a non-null context, named type is nullable
			schema.Nullable = true
		}
		return schema
	}

	return nil
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

// BuildJsonSchema builds a JSON schema for the variables of the given operation.
// Recursive input types are represented via "$ref"/"$defs" and support arbitrary
// nesting depth.
func BuildJsonSchema(operationDocument, definitionDocument *ast.Document, opts ...VariablesSchemaOption) (*JsonSchema, error) {
	if len(operationDocument.OperationDefinitions) == 0 {
		return nil, fmt.Errorf("no operations found in document")
	}

	return NewVariablesSchemaBuilder(operationDocument, definitionDocument, opts...).Build()
}
