// Package graphqlschemausage extracts schema usage metrics from GraphQL operations,
// associating each type, field, argument, and input with the SubgraphIDs that provide them.
//
// # Architecture
//
// The challenge: Execution plans optimize for execution, not analysis. Variables are resolved
// away, and only final field selections remain. To track usage, we must correlate three sources:
//
//  1. Execution Plan - contains field → subgraph mappings (via Source.IDs)
//  2. Operation AST - contains argument and variable usage
//  3. Variable Values - contains actual input data (nested objects, scalars, etc.)
//
// We extract subgraph IDs by building intermediate mappings:
//
//	plan → field paths → variables → input fields
//
// This enables accurate federated schema usage tracking, showing which subgraphs serve which
// parts of queries, even through variables and deeply nested input objects.
//
// # Usage Tracking Types
//
// 1. TYPE & FIELD: Direct extraction from execution plan (has Source.IDs)
// 2. ARGUMENT: Correlate AST arguments with plan field paths
// 3. INPUT: Build field→subgraph and variable→subgraph maps, then traverse variable values
//
// # Input Null Tracking
//
// Input fields are ALWAYS tracked, even when null (explicit or implicit). This is critical for
// detecting breaking changes when optional fields become required. Each input usage includes an
// IsNull flag to indicate null propagation. When an input is null, the chain stops there—nested
// fields are not traversed since the parent is null.
//
// # Design Components
//
// The package uses dependency injection and separation of concerns:
//
// - pathBuilder: Reusable path stack operations for field traversal
// - nullValueDetector: Centralized null detection for values and variables with remapping support
// - subgraphMapper: Unified interface for field and variable → subgraph ID resolution
// - inputTypeResolver: Type system queries for input object field definitions
// - inputTraverser: Input traversal with implicit null tracking
//
// These components are composed by visitor types to provide clean, testable, and maintainable
// schema usage extraction.
package graphqlschemausage

import (
	"bytes"
	"strings"

	"github.com/wundergraph/astjson"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvisitor"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"

	graphqlmetrics "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
)

// ============================================
// Public API
// ============================================

// GetTypeFieldUsageInfo extracts type and field usage from the execution plan.
func GetTypeFieldUsageInfo(operationPlan plan.Plan) []*TypeFieldUsageInfo {
	visitor := typeFieldUsageInfoVisitor{}
	switch p := operationPlan.(type) {
	case *plan.SynchronousResponsePlan:
		visitor.visitNode(p.Response.Data, nil)
	case *plan.SubscriptionResponsePlan:
		visitor.visitNode(p.Response.Response.Data, nil)
	}
	return visitor.typeFieldUsageInfo
}

// GetArgumentUsageInfo extracts argument usage by correlating AST arguments with execution plan
// field paths. Includes null tracking for both inline and variable-based argument values.
func GetArgumentUsageInfo(operation, definition *ast.Document, variables *astjson.Value, operationPlan plan.Plan, remapVariables map[string]string) ([]*graphqlmetrics.ArgumentUsageInfo, error) {
	subgraphMapper := newSubgraphMapper(operationPlan, operation, definition)
	nullDetector := newNullValueDetector(operation, variables, remapVariables)

	walker := astvisitor.NewWalker(48)
	visitor := &argumentUsageInfoVisitor{
		definition:              definition,
		operation:               operation,
		walker:                  &walker,
		subgraphMapper:          subgraphMapper,
		nullDetector:            nullDetector,
		pathBuilder:             newPathBuilder(8),
		usage:                   make([]*graphqlmetrics.ArgumentUsageInfo, 0, 16),
		currentFieldRef:         -1,
		providedArgumentsStack:  make([]map[string]struct{}, 0, 8),
		fieldEnclosingNodeStack: make([]ast.Node, 0, 8),
	}
	walker.RegisterEnterArgumentVisitor(visitor)
	walker.RegisterEnterFieldVisitor(visitor)
	walker.RegisterLeaveFieldVisitor(visitor)
	rep := &operationreport.Report{}
	walker.Walk(operation, definition, rep)
	if rep.HasErrors() {
		return nil, rep
	}

	return visitor.usage, nil
}

// GetInputUsageInfo extracts input usage by traversing variable values. Tracks both explicit
// nulls ({"field": null}) and implicit nulls (missing fields) for breaking change detection.
// Also tracks input usage for implicitly null input type arguments (arguments not provided).
func GetInputUsageInfo(operation, definition *ast.Document, variables *astjson.Value, operationPlan plan.Plan, remapVariables map[string]string) ([]*graphqlmetrics.InputUsageInfo, error) {
	subgraphMapper := newSubgraphMapper(operationPlan, operation, definition)
	traverser := newInputTraverser(definition, subgraphMapper)
	nullDetector := newNullValueDetector(operation, variables, remapVariables)

	// Track input usage from variable definitions
	for i := range operation.VariableDefinitions {
		processVariableDefinition(traverser, operation, definition, variables, nullDetector, subgraphMapper, i)
	}

	// Track input usage from implicitly null input type arguments
	collectImplicitArgumentInputUsage(operation, definition, subgraphMapper, traverser)

	return traverser.usage, nil
}

// ============================================
// Type Field Usage
// ============================================

// An array of TypeFieldUsageInfo, with a method to convert it into a []*graphqlmetrics.TypeFieldUsageInfo
type TypeFieldMetrics []*TypeFieldUsageInfo

// IntoGraphQLMetrics converts the TypeFieldMetrics into a []*graphqlmetrics.TypeFieldUsageInfo
func (t TypeFieldMetrics) IntoGraphQLMetrics() []*graphqlmetrics.TypeFieldUsageInfo {
	metrics := make([]*graphqlmetrics.TypeFieldUsageInfo, len(t))
	for i, info := range t {
		metrics[i] = info.IntoGraphQLMetrics()
	}
	return metrics
}

// TypeFieldUsageInfo holds information about the usage of a GraphQL type
type TypeFieldUsageInfo struct {
	NamedType           string
	ExactParentTypeName string

	Path                   []string
	ParentTypeNames        []string
	SubgraphIDs            []string
	IndirectInterfaceField bool
}

// IntoGraphQLMetrics converts the graphqlschemausage.TypeFieldUsageInfo into a *graphqlmetrics.TypeFieldUsageInfo
func (t *TypeFieldUsageInfo) IntoGraphQLMetrics() *graphqlmetrics.TypeFieldUsageInfo {
	return &graphqlmetrics.TypeFieldUsageInfo{
		Path:                   t.Path,
		TypeNames:              t.ParentTypeNames,
		SubgraphIDs:            t.SubgraphIDs,
		NamedType:              t.NamedType,
		IndirectInterfaceField: t.IndirectInterfaceField,
		Count:                  0,
	}
}

type typeFieldUsageInfoVisitor struct {
	typeFieldUsageInfo []*TypeFieldUsageInfo
}

func (p *typeFieldUsageInfoVisitor) visitNode(node resolve.Node, path []string) {
	switch t := node.(type) {
	case *resolve.Object:
		if p.typeFieldUsageInfo == nil {
			p.typeFieldUsageInfo = make([]*TypeFieldUsageInfo, 0, 32)
		}

		for _, field := range t.Fields {
			if field.Info == nil {
				continue
			}

			pathCopy := make([]string, len(path)+1)
			copy(pathCopy, path)
			pathCopy[len(path)] = field.Info.Name

			p.typeFieldUsageInfo = append(p.typeFieldUsageInfo, &TypeFieldUsageInfo{
				Path:                pathCopy,
				ParentTypeNames:     field.Info.ParentTypeNames,
				ExactParentTypeName: field.Info.ExactParentTypeName,
				SubgraphIDs:         field.Info.Source.IDs,
				NamedType:           field.Info.NamedType,
			})
			if len(field.Info.IndirectInterfaceNames) > 0 {
				p.typeFieldUsageInfo = append(p.typeFieldUsageInfo, &TypeFieldUsageInfo{
					Path:                   pathCopy,
					ParentTypeNames:        field.Info.IndirectInterfaceNames,
					SubgraphIDs:            field.Info.Source.IDs,
					NamedType:              field.Info.NamedType,
					IndirectInterfaceField: true,
				})
			}
			p.visitNode(field.Value, pathCopy)
		}
	case *resolve.Array:
		p.visitNode(t.Item, path)
	}
}

// ============================================
// Path Builder (Shared Infrastructure)
// ============================================

// pathBuilder provides reusable path stack operations for tracking field paths during traversal.
type pathBuilder struct {
	stack []string
}

func newPathBuilder(capacity int) *pathBuilder {
	return &pathBuilder{stack: make([]string, 0, capacity)}
}

func (p *pathBuilder) push(segment string) {
	p.stack = append(p.stack, segment)
}

func (p *pathBuilder) pop() {
	if len(p.stack) > 0 {
		p.stack = p.stack[:len(p.stack)-1]
	}
}

func (p *pathBuilder) copy() []string {
	result := make([]string, len(p.stack))
	copy(result, p.stack)
	return result
}

func (p *pathBuilder) key() string {
	return strings.Join(p.stack, ".")
}

// ============================================
// Null Value Detector (Shared Infrastructure)
// ============================================

// nullValueDetector handles null detection for inline values, variables, and name remapping.
type nullValueDetector struct {
	operation      *ast.Document
	variables      *astjson.Value
	remapVariables map[string]string
}

func newNullValueDetector(operation *ast.Document, variables *astjson.Value, remapVariables map[string]string) *nullValueDetector {
	return &nullValueDetector{
		operation:      operation,
		variables:      variables,
		remapVariables: remapVariables,
	}
}

// isValueNull checks if an argument/variable value is null
func (n *nullValueDetector) isValueNull(value ast.Value) bool {
	if value.Kind == ast.ValueKindNull {
		return true
	}

	if value.Kind == ast.ValueKindVariable && n.variables != nil {
		varName := n.operation.VariableValueNameString(value.Ref)
		return n.isVariableNull(varName)
	}

	return false
}

// isVariableNull checks if a variable (by name) has a null value
func (n *nullValueDetector) isVariableNull(varName string) bool {
	originalVarName := n.getOriginalVariableName(varName)
	jsonField := n.variables.Get(originalVarName)
	return jsonField != nil && jsonField.Type() == astjson.TypeNull
}

// getOriginalVariableName maps normalized variable names back to originals
func (n *nullValueDetector) getOriginalVariableName(varName string) string {
	if n.remapVariables != nil {
		if remapped, exists := n.remapVariables[varName]; exists {
			return remapped
		}
	}
	return varName
}

// ============================================
// Subgraph Mapper (Shared Infrastructure)
// ============================================

// subgraphMapper maps field paths and variable names to their subgraph IDs.
type subgraphMapper struct {
	fieldToSubgraphs    map[string][]string
	variableToSubgraphs map[string][]string
}

func newSubgraphMapper(operationPlan plan.Plan, operation, definition *ast.Document) *subgraphMapper {
	mapper := &subgraphMapper{
		fieldToSubgraphs: buildFieldSubgraphIDMap(operationPlan),
	}
	mapper.variableToSubgraphs = buildVariableSubgraphMap(operation, definition, mapper.fieldToSubgraphs)
	return mapper
}

// getFieldSubgraphs returns subgraph IDs for a field path
func (s *subgraphMapper) getFieldSubgraphs(pathKey string) []string {
	return s.fieldToSubgraphs[pathKey]
}

// getVariableSubgraphs returns subgraph IDs for a variable
func (s *subgraphMapper) getVariableSubgraphs(varName string) []string {
	return s.variableToSubgraphs[varName]
}

// buildFieldSubgraphIDMap extracts field → subgraph mappings from the execution plan.
func buildFieldSubgraphIDMap(operationPlan plan.Plan) map[string][]string {
	collector := &subgraphIDCollector{
		fieldMap:  make(map[string][]string),
		pathStack: make([]string, 0, 8),
	}
	switch p := operationPlan.(type) {
	case *plan.SynchronousResponsePlan:
		collector.collectFromNode(p.Response.Data)
	case *plan.SubscriptionResponsePlan:
		collector.collectFromNode(p.Response.Response.Data)
	}
	return collector.fieldMap
}

type subgraphIDCollector struct {
	fieldMap  map[string][]string
	pathStack []string
}

func (c *subgraphIDCollector) collectFromNode(node resolve.Node) {
	switch t := node.(type) {
	case *resolve.Object:
		for _, field := range t.Fields {
			if field.Info == nil {
				continue
			}
			c.pathStack = append(c.pathStack, field.Info.Name)
			pathKey := strings.Join(c.pathStack, ".")
			c.fieldMap[pathKey] = field.Info.Source.IDs
			c.collectFromNode(field.Value)
			c.pathStack = c.pathStack[:len(c.pathStack)-1]
		}
	case *resolve.Array:
		c.collectFromNode(t.Item)
	}
}

// buildVariableSubgraphMap maps variable names to subgraph IDs by analyzing which fields use them.
func buildVariableSubgraphMap(operation, definition *ast.Document, fieldSubgraphMap map[string][]string) map[string][]string {
	variableMap := make(map[string][]string)
	walker := astvisitor.NewWalker(48)
	collector := &variableSubgraphCollector{
		walker:           &walker,
		operation:        operation,
		definition:       definition,
		fieldSubgraphMap: fieldSubgraphMap,
		variableMap:      variableMap,
		pathBuilder:      newPathBuilder(8),
	}
	walker.RegisterEnterFieldVisitor(collector)
	walker.RegisterLeaveFieldVisitor(collector)
	walker.RegisterEnterArgumentVisitor(collector)
	rep := &operationreport.Report{}
	walker.Walk(operation, definition, rep)
	return variableMap
}

type variableSubgraphCollector struct {
	walker           *astvisitor.Walker
	operation        *ast.Document
	definition       *ast.Document
	fieldSubgraphMap map[string][]string
	variableMap      map[string][]string
	pathBuilder      *pathBuilder
}

func (v *variableSubgraphCollector) EnterField(ref int) {
	fieldName := v.operation.FieldNameString(ref)
	v.pathBuilder.push(fieldName)
}

func (v *variableSubgraphCollector) LeaveField(_ int) {
	v.pathBuilder.pop()
}

func (v *variableSubgraphCollector) EnterArgument(ref int) {
	arg := v.operation.Arguments[ref]

	if arg.Value.Kind != ast.ValueKindVariable {
		return
	}

	varName := v.operation.VariableValueNameString(arg.Value.Ref)
	if varName == "" {
		return
	}

	pathKey := v.pathBuilder.key()
	if subgraphIDs, exists := v.fieldSubgraphMap[pathKey]; exists {
		v.variableMap[varName] = mergeSubgraphIDs(v.variableMap[varName], subgraphIDs)
	}
}

// mergeSubgraphIDs combines two slices of subgraph IDs, removing duplicates.
func mergeSubgraphIDs(a, b []string) []string {
	if len(a) == 0 {
		return b
	}
	if len(b) == 0 {
		return a
	}

	seen := make(map[string]bool, len(a)+len(b))
	result := make([]string, 0, len(a)+len(b))

	for _, id := range a {
		if !seen[id] {
			seen[id] = true
			result = append(result, id)
		}
	}

	for _, id := range b {
		if !seen[id] {
			seen[id] = true
			result = append(result, id)
		}
	}

	return result
}

// ============================================
// Argument Usage Visitor
// ============================================

type argumentUsageInfoVisitor struct {
	walker                  *astvisitor.Walker
	definition              *ast.Document
	operation               *ast.Document
	fieldEnclosingNodeStack []ast.Node // Stack to track enclosing nodes for nested fields
	subgraphMapper          *subgraphMapper
	nullDetector            *nullValueDetector
	pathBuilder             *pathBuilder
	usage                   []*graphqlmetrics.ArgumentUsageInfo
	currentFieldRef         int
	providedArgumentsStack  []map[string]struct{} // Stack of maps to track which arguments were provided at each level
}

func (a *argumentUsageInfoVisitor) EnterField(ref int) {
	// Push current enclosing node onto stack
	a.fieldEnclosingNodeStack = append(a.fieldEnclosingNodeStack, a.walker.EnclosingTypeDefinition)
	a.currentFieldRef = ref
	// Push nil - will lazily allocate map only if field has arguments
	a.providedArgumentsStack = append(a.providedArgumentsStack, nil)
	fieldName := a.operation.FieldNameString(ref)
	a.pathBuilder.push(fieldName)
}

func (a *argumentUsageInfoVisitor) LeaveField(ref int) {
	// Track implicit null arguments (arguments defined in schema but not provided in operation)
	a.trackImplicitNullArguments(ref)
	a.pathBuilder.pop()
	a.currentFieldRef = -1
	// Pop the enclosing node from stack
	if len(a.fieldEnclosingNodeStack) > 0 {
		a.fieldEnclosingNodeStack = a.fieldEnclosingNodeStack[:len(a.fieldEnclosingNodeStack)-1]
	}
	// Pop the provided arguments map
	if len(a.providedArgumentsStack) > 0 {
		a.providedArgumentsStack = a.providedArgumentsStack[:len(a.providedArgumentsStack)-1]
	}
}

func (a *argumentUsageInfoVisitor) EnterArgument(ref int) {
	argName := a.operation.ArgumentNameBytes(ref)
	anc := a.walker.Ancestors[len(a.walker.Ancestors)-1]
	if anc.Kind != ast.NodeKindField {
		return
	}

	// Track that this argument was provided in the current field's map
	// Lazily allocate map only when first argument is encountered
	if len(a.providedArgumentsStack) > 0 {
		stackIdx := len(a.providedArgumentsStack) - 1
		if a.providedArgumentsStack[stackIdx] == nil {
			a.providedArgumentsStack[stackIdx] = make(map[string]struct{}, 4) // Capacity hint: most fields have 1-4 args
		}
		a.providedArgumentsStack[stackIdx][string(argName)] = struct{}{}
	}

	// Get enclosing node from top of stack
	if len(a.fieldEnclosingNodeStack) == 0 {
		return
	}
	fieldEnclosingNode := a.fieldEnclosingNodeStack[len(a.fieldEnclosingNodeStack)-1]

	fieldName := a.operation.FieldNameBytes(anc.Ref)
	enclosingTypeName := a.definition.NodeNameBytes(fieldEnclosingNode)
	argDef := a.definition.NodeFieldDefinitionArgumentDefinitionByName(fieldEnclosingNode, fieldName, argName)
	if argDef == -1 {
		return
	}
	argType := a.definition.InputValueDefinitionType(argDef)
	typeName := a.definition.ResolveTypeNameBytes(argType)

	// Get subgraph IDs using the path builder
	subgraphIDs := a.subgraphMapper.getFieldSubgraphs(a.pathBuilder.key())

	// Check if argument is null using null detector
	arg := a.operation.Arguments[ref]
	isNull := a.nullDetector.isValueNull(arg.Value)

	a.usage = append(a.usage, &graphqlmetrics.ArgumentUsageInfo{
		Path:        []string{string(fieldName), string(argName)},
		TypeName:    string(enclosingTypeName),
		NamedType:   string(typeName),
		SubgraphIDs: subgraphIDs,
		IsNull:      isNull,
	})
}

// trackImplicitNullArguments tracks arguments defined in the schema but not provided in the operation.
// This is critical for breaking change detection - we need to know if arguments are being used or not.
func (a *argumentUsageInfoVisitor) trackImplicitNullArguments(fieldRef int) {
	// Get enclosing node from top of stack
	if len(a.fieldEnclosingNodeStack) == 0 {
		return
	}
	fieldEnclosingNode := a.fieldEnclosingNodeStack[len(a.fieldEnclosingNodeStack)-1]

	if fieldEnclosingNode.Kind == ast.NodeKindUnknown {
		return
	}

	// Skip introspection fields
	fieldName := a.operation.FieldNameBytes(fieldRef)
	if len(fieldName) > 1 && fieldName[0] == '_' && fieldName[1] == '_' {
		return
	}

	enclosingTypeName := a.definition.NodeNameBytes(fieldEnclosingNode)

	// Get subgraph IDs for this field
	subgraphIDs := a.subgraphMapper.getFieldSubgraphs(a.pathBuilder.key())

	// Find all arguments defined for this field in the schema
	var argumentRefs []int
	switch fieldEnclosingNode.Kind {
	case ast.NodeKindObjectTypeDefinition:
		fieldDefs := a.definition.ObjectTypeDefinitions[fieldEnclosingNode.Ref].FieldsDefinition.Refs
		for _, fieldDefRef := range fieldDefs {
			fieldDef := a.definition.FieldDefinitions[fieldDefRef]
			if bytes.Equal(a.definition.FieldDefinitionNameBytes(fieldDefRef), fieldName) {
				if fieldDef.HasArgumentsDefinitions {
					argumentRefs = fieldDef.ArgumentsDefinition.Refs
				}
				break
			}
		}
	case ast.NodeKindInterfaceTypeDefinition:
		fieldDefs := a.definition.InterfaceTypeDefinitions[fieldEnclosingNode.Ref].FieldsDefinition.Refs
		for _, fieldDefRef := range fieldDefs {
			fieldDef := a.definition.FieldDefinitions[fieldDefRef]
			if bytes.Equal(a.definition.FieldDefinitionNameBytes(fieldDefRef), fieldName) {
				if fieldDef.HasArgumentsDefinitions {
					argumentRefs = fieldDef.ArgumentsDefinition.Refs
				}
				break
			}
		}
	}

	// Get the provided arguments map for this field level
	var providedArguments map[string]struct{}
	if len(a.providedArgumentsStack) > 0 {
		providedArguments = a.providedArgumentsStack[len(a.providedArgumentsStack)-1]
	}

	// Track arguments that are defined but not provided (implicitly null)
	for _, argRef := range argumentRefs {
		argName := string(a.definition.InputValueDefinitionNameString(argRef))

		// Skip if this argument was already provided
		if providedArguments != nil {
			if _, provided := providedArguments[argName]; provided {
				continue
			}
		}

		argType := a.definition.InputValueDefinitionType(argRef)
		typeName := a.definition.ResolveTypeNameString(argType)

		// Track argument as implicitly null
		a.usage = append(a.usage, &graphqlmetrics.ArgumentUsageInfo{
			Path:        []string{string(fieldName), argName},
			TypeName:    string(enclosingTypeName),
			NamedType:   typeName,
			SubgraphIDs: subgraphIDs,
			IsNull:      true, // Implicitly null (not provided)
		})
	}
}

// ============================================
// Input Type Resolver
// ============================================

// inputTypeResolver resolves input object field definitions from the schema.
type inputTypeResolver struct {
	definition *ast.Document
}

func newInputTypeResolver(definition *ast.Document) *inputTypeResolver {
	return &inputTypeResolver{definition: definition}
}

// resolveInputFields returns all field definitions for an input object type
func (r *inputTypeResolver) resolveInputFields(typeName string) []inputFieldInfo {
	defNode, ok := r.definition.NodeByNameStr(typeName)
	if !ok || defNode.Kind != ast.NodeKindInputObjectTypeDefinition {
		return nil
	}

	inputObjectDef := r.definition.InputObjectTypeDefinitions[defNode.Ref]
	fields := make([]inputFieldInfo, 0, len(inputObjectDef.InputFieldsDefinition.Refs))

	for _, fieldRef := range inputObjectDef.InputFieldsDefinition.Refs {
		fieldDef := r.definition.InputValueDefinitions[fieldRef]
		fields = append(fields, inputFieldInfo{
			name:     string(r.definition.Input.ByteSlice(fieldDef.Name)),
			typeName: r.definition.ResolveTypeNameString(fieldDef.Type),
			isList:   r.definition.TypeIsList(fieldDef.Type),
		})
	}

	return fields
}

// getNodeRef returns the node ref for a type by name
func (r *inputTypeResolver) getNodeRef(typeName string) int {
	if node, ok := r.definition.NodeByNameStr(typeName); ok {
		return node.Ref
	}
	return -1
}

// inputFieldInfo represents an input object field's name, type, and list indicator.
type inputFieldInfo struct {
	name     string
	typeName string
	isList   bool
}

// ============================================
// Input Traverser
// ============================================

// inputTraverser traverses JSON variable values to extract input usage metrics.
// Tracks explicit nulls, implicit nulls (missing fields), and enum values.
type inputTraverser struct {
	definition          *ast.Document
	typeResolver        *inputTypeResolver
	subgraphMapper      *subgraphMapper
	currentVariableName string
	usage               []*graphqlmetrics.InputUsageInfo
}

func newInputTraverser(definition *ast.Document, subgraphMapper *subgraphMapper) *inputTraverser {
	return &inputTraverser{
		definition:     definition,
		typeResolver:   newInputTypeResolver(definition),
		subgraphMapper: subgraphMapper,
		usage:          make([]*graphqlmetrics.InputUsageInfo, 0, 16),
	}
}

// traverse handles input value traversal, dispatching to specialized handlers by type kind.
// Implements null propagation: when isNull is true, tracking stops at this level.
func (t *inputTraverser) traverse(jsonValue *astjson.Value, fieldName, typeName, parentTypeName string, isNull bool) {
	usageInfo := t.createUsageInfo(fieldName, typeName, parentTypeName, isNull)

	defNode, ok := t.definition.NodeByNameStr(typeName)
	if !ok {
		// Built-in scalar
		t.appendUniqueUsage(usageInfo)
		return
	}

	// If null, track and stop propagation
	if isNull {
		t.appendUniqueUsage(usageInfo)
		return
	}

	// Dispatch based on type kind
	switch defNode.Kind {
	case ast.NodeKindInputObjectTypeDefinition:
		t.traverseInputObject(jsonValue, fieldName, typeName, parentTypeName, defNode, usageInfo)
	case ast.NodeKindEnumTypeDefinition:
		t.traverseEnum(jsonValue, usageInfo)
	case ast.NodeKindScalarTypeDefinition:
		// Custom scalar - just track
	}

	t.appendUniqueUsage(usageInfo)
}

// createUsageInfo builds usage info with path, type names, and subgraph IDs.
func (t *inputTraverser) createUsageInfo(fieldName, typeName, parentTypeName string, isNull bool) *graphqlmetrics.InputUsageInfo {
	info := &graphqlmetrics.InputUsageInfo{
		NamedType: typeName,
		IsNull:    isNull,
	}

	if parentTypeName != "" {
		info.TypeName = parentTypeName
		info.Path = []string{parentTypeName, fieldName}
	} else {
		// For root input types, set Path to identify the type itself
		info.Path = []string{typeName}
	}

	// Get subgraph IDs
	if t.currentVariableName != "" {
		info.SubgraphIDs = t.subgraphMapper.getVariableSubgraphs(t.currentVariableName)
	}

	return info
}

// traverseInputObject handles input object traversal with implicit null tracking
func (t *inputTraverser) traverseInputObject(jsonValue *astjson.Value, fieldName, typeName, parentTypeName string, defNode ast.Node, usageInfo *graphqlmetrics.InputUsageInfo) {
	switch jsonValue.Type() {
	case astjson.TypeArray:
		for _, arrayValue := range jsonValue.GetArray() {
			t.traverse(arrayValue, fieldName, typeName, parentTypeName, false)
		}
	case astjson.TypeObject:
		t.processObjectFields(jsonValue, typeName, usageInfo.SubgraphIDs)
	}
}

// processObjectFields processes present fields and tracks implicit nulls (missing fields).
func (t *inputTraverser) processObjectFields(jsonValue *astjson.Value, parentTypeName string, subgraphIDs []string) {
	o := jsonValue.GetObject()
	presentFields := make(map[string]bool, 8) // Capacity hint: most input objects have <8 fields

	// Process present fields
	o.Visit(func(key []byte, value *astjson.Value) {
		keyStr := string(key)
		presentFields[keyStr] = true
		t.processField(keyStr, value, parentTypeName)
	})

	// Process missing fields (implicit nulls)
	allFields := t.typeResolver.resolveInputFields(parentTypeName)
	for _, fieldInfo := range allFields {
		if !presentFields[fieldInfo.name] {
			t.trackImplicitNull(fieldInfo, parentTypeName, subgraphIDs)
		}
	}
}

// processField handles a single field from the JSON object
func (t *inputTraverser) processField(fieldName string, value *astjson.Value, parentTypeName string) {
	nodeRef := t.typeResolver.getNodeRef(parentTypeName)
	if nodeRef == -1 {
		return
	}

	fieldRef := t.definition.InputObjectTypeDefinitionInputValueDefinitionByName(nodeRef, []byte(fieldName))
	if fieldRef == -1 {
		return
	}

	fieldDef := t.definition.InputValueDefinitions[fieldRef]
	fieldTypeName := t.definition.ResolveTypeNameString(fieldDef.Type)
	fieldIsNull := value.Type() == astjson.TypeNull

	if t.definition.TypeIsList(fieldDef.Type) {
		for _, arrayValue := range value.GetArray() {
			t.traverse(arrayValue, fieldName, fieldTypeName, parentTypeName, false)
		}
	} else {
		t.traverse(value, fieldName, fieldTypeName, parentTypeName, fieldIsNull)
	}
}

// trackImplicitNull creates usage info for fields not present in JSON (implicitly null).
func (t *inputTraverser) trackImplicitNull(fieldInfo inputFieldInfo, parentTypeName string, subgraphIDs []string) {
	implicitUsageInfo := &graphqlmetrics.InputUsageInfo{
		NamedType:   fieldInfo.typeName,
		TypeName:    parentTypeName,
		Path:        []string{parentTypeName, fieldInfo.name},
		IsNull:      true,
		SubgraphIDs: subgraphIDs,
	}
	t.appendUniqueUsage(implicitUsageInfo)
}

// traverseEnum handles enum value extraction
func (t *inputTraverser) traverseEnum(jsonValue *astjson.Value, usageInfo *graphqlmetrics.InputUsageInfo) {
	switch jsonValue.Type() {
	case astjson.TypeString:
		usageInfo.EnumValues = []string{string(jsonValue.GetStringBytes())}
	case astjson.TypeArray:
		arr := jsonValue.GetArray()
		usageInfo.EnumValues = make([]string, len(arr))
		for i, arrayValue := range arr {
			usageInfo.EnumValues[i] = string(arrayValue.GetStringBytes())
		}
	}
}

func (t *inputTraverser) appendUniqueUsage(info *graphqlmetrics.InputUsageInfo) {
	for _, u := range t.usage {
		if t.infoEquals(u, info) {
			return
		}
	}
	t.usage = append(t.usage, info)
}

func (t *inputTraverser) infoEquals(a, b *graphqlmetrics.InputUsageInfo) bool {
	if a.Count != b.Count {
		return false
	}
	if a.NamedType != b.NamedType {
		return false
	}
	if a.TypeName != b.TypeName {
		return false
	}
	if a.IsNull != b.IsNull {
		return false
	}
	if len(a.Path) != len(b.Path) {
		return false
	}
	for i := range a.Path {
		if a.Path[i] != b.Path[i] {
			return false
		}
	}
	if len(a.EnumValues) != len(b.EnumValues) {
		return false
	}
	for i := range a.EnumValues {
		if a.EnumValues[i] != b.EnumValues[i] {
			return false
		}
	}
	if len(a.SubgraphIDs) != len(b.SubgraphIDs) {
		return false
	}
	for i := range a.SubgraphIDs {
		if a.SubgraphIDs[i] != b.SubgraphIDs[i] {
			return false
		}
	}
	return true
}

// ============================================
// Variable Definition Processing
// ============================================

// processVariableDefinition processes a variable definition and initiates input traversal.
// Tracks input usage even when the variable is not provided in the variables JSON (empty variables).
func processVariableDefinition(traverser *inputTraverser, operation, definition *ast.Document, variables *astjson.Value, nullDetector *nullValueDetector, subgraphMapper *subgraphMapper, ref int) {
	varDef := operation.VariableDefinitions[ref]
	varTypeRef := varDef.Type
	varTypeName := operation.ResolveTypeNameString(varTypeRef)

	// Get normalized variable name from AST
	normalizedVarName := operation.VariableValueNameString(varDef.VariableValue.Ref)

	// Map back to original name for JSON lookup
	originalVarName := nullDetector.getOriginalVariableName(normalizedVarName)

	// Look up the variable value
	jsonField := variables.Get(originalVarName)
	if jsonField == nil {
		// Variable is not provided in variables JSON - still track input type usage if it's an input object type
		// This is important for breaking change detection
		defNode, ok := definition.NodeByNameStr(varTypeName)
		if ok && defNode.Kind == ast.NodeKindInputObjectTypeDefinition {
			// Use normalized name for subgraph lookup
			traverser.currentVariableName = normalizedVarName
			subgraphIDs := subgraphMapper.getVariableSubgraphs(normalizedVarName)

			// Track the input type as implicitly null (variable not provided)
			traverser.appendUniqueUsage(&graphqlmetrics.InputUsageInfo{
				NamedType:   varTypeName,
				Path:        []string{varTypeName},
				SubgraphIDs: subgraphIDs,
				IsNull:      true, // Variable not provided
			})
		}
		return
	}

	// Use normalized name for subgraph lookup
	traverser.currentVariableName = normalizedVarName

	// Always track input usage, even when null
	isNull := jsonField.Type() == astjson.TypeNull
	traverser.traverse(jsonField, originalVarName, varTypeName, "", isNull)
}

// collectImplicitArgumentInputUsage walks the operation and tracks input usage for
// implicitly null input type arguments (arguments defined in schema but not provided in operation).
func collectImplicitArgumentInputUsage(operation, definition *ast.Document, subgraphMapper *subgraphMapper, traverser *inputTraverser) {
	walker := astvisitor.NewWalker(48)
	collector := &implicitArgumentInputCollector{
		walker:         &walker,
		definition:     definition,
		operation:      operation,
		subgraphMapper: subgraphMapper,
		traverser:      traverser,
		pathBuilder:    newPathBuilder(8),
		argumentsStack: make([]map[string]struct{}, 0, 8),
		enclosingStack: make([]ast.Node, 0, 8),
	}
	walker.RegisterEnterFieldVisitor(collector)
	walker.RegisterLeaveFieldVisitor(collector)
	walker.RegisterEnterArgumentVisitor(collector)
	rep := &operationreport.Report{}
	walker.Walk(operation, definition, rep)
}

// implicitArgumentInputCollector collects input usage for implicitly null input type arguments
type implicitArgumentInputCollector struct {
	walker         *astvisitor.Walker
	definition     *ast.Document
	operation      *ast.Document
	subgraphMapper *subgraphMapper
	traverser      *inputTraverser
	pathBuilder    *pathBuilder
	argumentsStack []map[string]struct{} // Track provided arguments per field
	enclosingStack []ast.Node
}

func (c *implicitArgumentInputCollector) EnterField(ref int) {
	c.enclosingStack = append(c.enclosingStack, c.walker.EnclosingTypeDefinition)
	c.argumentsStack = append(c.argumentsStack, nil)
	fieldName := c.operation.FieldNameString(ref)
	c.pathBuilder.push(fieldName)
}

func (c *implicitArgumentInputCollector) LeaveField(ref int) {
	// Check for implicit null input type arguments
	c.trackImplicitInputTypeArguments(ref)

	c.pathBuilder.pop()
	if len(c.enclosingStack) > 0 {
		c.enclosingStack = c.enclosingStack[:len(c.enclosingStack)-1]
	}
	if len(c.argumentsStack) > 0 {
		c.argumentsStack = c.argumentsStack[:len(c.argumentsStack)-1]
	}
}

func (c *implicitArgumentInputCollector) EnterArgument(ref int) {
	argName := c.operation.ArgumentNameBytes(ref)
	anc := c.walker.Ancestors[len(c.walker.Ancestors)-1]
	if anc.Kind != ast.NodeKindField {
		return
	}

	// Lazily allocate map and track provided argument
	if len(c.argumentsStack) > 0 {
		stackIdx := len(c.argumentsStack) - 1
		if c.argumentsStack[stackIdx] == nil {
			c.argumentsStack[stackIdx] = make(map[string]struct{}, 4)
		}
		c.argumentsStack[stackIdx][string(argName)] = struct{}{}
	}
}

func (c *implicitArgumentInputCollector) trackImplicitInputTypeArguments(fieldRef int) {
	if len(c.enclosingStack) == 0 {
		return
	}
	enclosingNode := c.enclosingStack[len(c.enclosingStack)-1]
	if enclosingNode.Kind == ast.NodeKindUnknown {
		return
	}

	fieldName := c.operation.FieldNameBytes(fieldRef)
	// Skip introspection fields
	if len(fieldName) > 1 && fieldName[0] == '_' && fieldName[1] == '_' {
		return
	}

	// Get subgraph IDs for this field
	subgraphIDs := c.subgraphMapper.getFieldSubgraphs(c.pathBuilder.key())

	// Find all arguments defined for this field
	var argumentRefs []int
	switch enclosingNode.Kind {
	case ast.NodeKindObjectTypeDefinition:
		fieldDefs := c.definition.ObjectTypeDefinitions[enclosingNode.Ref].FieldsDefinition.Refs
		for _, fieldDefRef := range fieldDefs {
			fieldDef := c.definition.FieldDefinitions[fieldDefRef]
			if bytes.Equal(c.definition.FieldDefinitionNameBytes(fieldDefRef), fieldName) {
				if fieldDef.HasArgumentsDefinitions {
					argumentRefs = fieldDef.ArgumentsDefinition.Refs
				}
				break
			}
		}
	case ast.NodeKindInterfaceTypeDefinition:
		fieldDefs := c.definition.InterfaceTypeDefinitions[enclosingNode.Ref].FieldsDefinition.Refs
		for _, fieldDefRef := range fieldDefs {
			fieldDef := c.definition.FieldDefinitions[fieldDefRef]
			if bytes.Equal(c.definition.FieldDefinitionNameBytes(fieldDefRef), fieldName) {
				if fieldDef.HasArgumentsDefinitions {
					argumentRefs = fieldDef.ArgumentsDefinition.Refs
				}
				break
			}
		}
	}

	// Get provided arguments for this field
	var providedArgs map[string]struct{}
	if len(c.argumentsStack) > 0 {
		providedArgs = c.argumentsStack[len(c.argumentsStack)-1]
	}

	// Track input usage for implicitly null input type arguments
	for _, argRef := range argumentRefs {
		argName := string(c.definition.InputValueDefinitionNameString(argRef))

		// Skip if argument was provided
		if providedArgs != nil {
			if _, provided := providedArgs[argName]; provided {
				continue
			}
		}

		argType := c.definition.InputValueDefinitionType(argRef)
		typeName := c.definition.ResolveTypeNameString(argType)

		// Check if this is an input object type
		defNode, ok := c.definition.NodeByNameStr(typeName)
		if !ok {
			continue
		}

		// Only track input object types (not scalars or enums)
		if defNode.Kind != ast.NodeKindInputObjectTypeDefinition {
			continue
		}

		// Add input usage for the implicitly null input type
		c.traverser.appendUniqueUsage(&graphqlmetrics.InputUsageInfo{
			NamedType:   typeName,
			Path:        []string{typeName},
			SubgraphIDs: subgraphIDs,
			IsNull:      true, // Implicitly null (not provided)
		})
	}
}
