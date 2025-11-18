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
// Special handling: Variable remapping for normalized operations (e.g., $a → $criteria),
// null value skipping (nulls don't represent actual usage).
package graphqlschemausage

import (
	"strings"

	"github.com/wundergraph/astjson"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvisitor"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"

	graphqlmetrics "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
)

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

// An array of TypeFieldUsageInfo, with a method to convert it into a []*graphqlmetrics.TypeFieldUsageInfo
type TypeFieldMetrics []*TypeFieldUsageInfo

// IntoGraphQLMetrics converts the TypeFieldMetrics into a []*graphqlmetrics.TypeFieldUsageInfo
func (t TypeFieldMetrics) IntoGraphQLMetrics() []*graphqlmetrics.TypeFieldUsageInfo {
	// Pre-allocate slice with exact capacity
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
		// Pre-allocate the typeFieldUsageInfo slice with a reasonable capacity
		// to reduce allocations during traversal
		if p.typeFieldUsageInfo == nil {
			// Estimate: average query has ~20-50 fields
			p.typeFieldUsageInfo = make([]*TypeFieldUsageInfo, 0, 32)
		}

		for _, field := range t.Fields {
			if field.Info == nil {
				continue
			}

			// create a new slice with exact capacity and copy elements
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

// buildFieldSubgraphIDMap extracts field → subgraph mappings from the execution plan.
// Returns a map where keys are dot-separated paths (e.g., "user.orders") and values are subgraph IDs.
func buildFieldSubgraphIDMap(operationPlan plan.Plan) map[string][]string {
	collector := &subgraphIDCollector{
		fieldMap:  make(map[string][]string),
		pathStack: make([]string, 0, 8), // Pre-allocate for typical depth
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
	pathStack []string // Reusable path stack to avoid allocations
}

func (c *subgraphIDCollector) collectFromNode(node resolve.Node) {
	switch t := node.(type) {
	case *resolve.Object:
		for _, field := range t.Fields {
			if field.Info == nil {
				continue
			}
			// Push field name onto stack
			c.pathStack = append(c.pathStack, field.Info.Name)

			// Store the subgraph IDs for this field path
			pathKey := pathToKey(c.pathStack)
			c.fieldMap[pathKey] = field.Info.Source.IDs

			c.collectFromNode(field.Value)

			// Pop field name from stack
			c.pathStack = c.pathStack[:len(c.pathStack)-1]
		}
	case *resolve.Array:
		c.collectFromNode(t.Item)
	}
}

// pathToKey converts a path slice to a string key for map lookups.
func pathToKey(path []string) string {
	return strings.Join(path, ".")
}

// buildVariableSubgraphMap maps variable names to subgraph IDs by analyzing which fields use them.
// Walks the operation AST to find variable usage (e.g., user(id: $userId)), then looks up
// the field's subgraph IDs from fieldSubgraphMap. Merges IDs if a variable is used by multiple fields.
func buildVariableSubgraphMap(operation, definition *ast.Document, fieldSubgraphMap map[string][]string) map[string][]string {
	variableMap := make(map[string][]string)
	walker := astvisitor.NewWalker(48)
	collector := &variableSubgraphCollector{
		walker:           &walker,
		operation:        operation,
		definition:       definition,
		fieldSubgraphMap: fieldSubgraphMap,
		variableMap:      variableMap,
		currentPath:      make([]string, 0, 8),
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
	currentPath      []string
}

// EnterField tracks the current field path for argument processing.
func (v *variableSubgraphCollector) EnterField(ref int) {
	fieldName := v.operation.FieldNameString(ref)
	v.currentPath = append(v.currentPath, fieldName)
}

// LeaveField pops the field from the path when leaving.
func (v *variableSubgraphCollector) LeaveField(_ int) {
	if len(v.currentPath) > 0 {
		v.currentPath = v.currentPath[:len(v.currentPath)-1]
	}
}

// EnterArgument detects variable usage and associates variables with subgraph IDs.
// For user(id: $userId), maps "userId" → subgraph IDs of "user" field.
func (v *variableSubgraphCollector) EnterArgument(ref int) {
	arg := v.operation.Arguments[ref]

	// Only process arguments that use variables (not inline values)
	if arg.Value.Kind != ast.ValueKindVariable {
		return
	}

	varName := v.operation.VariableValueNameString(arg.Value.Ref)
	if varName == "" {
		return
	}

	// Get subgraph IDs for the current field path
	if len(v.currentPath) > 0 {
		pathKey := pathToKey(v.currentPath)
		if subgraphIDs, exists := v.fieldSubgraphMap[pathKey]; exists {
			// Merge subgraph IDs for this variable
			// (in case the variable is used by multiple fields from different subgraphs)
			v.variableMap[varName] = mergeSubgraphIDs(v.variableMap[varName], subgraphIDs)
		}
	}
}

// mergeSubgraphIDs combines two slices of subgraph IDs, removing duplicates.
// Used when a variable is used by fields from different subgraphs.
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

func GetArgumentUsageInfo(operation, definition *ast.Document, operationPlan plan.Plan) ([]*graphqlmetrics.ArgumentUsageInfo, error) {
	// Build a mapping of field paths to their subgraph IDs from the plan
	subgraphIDMap := buildFieldSubgraphIDMap(operationPlan)

	walker := astvisitor.NewWalker(48)
	visitor := &argumentUsageInfoVisitor{
		definition:    definition,
		operation:     operation,
		walker:        &walker,
		subgraphIDMap: subgraphIDMap,
		// Pre-allocate with reasonable capacity to reduce allocations
		usage: make([]*graphqlmetrics.ArgumentUsageInfo, 0, 16),
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

type argumentUsageInfoVisitor struct {
	walker                *astvisitor.Walker
	definition, operation *ast.Document
	fieldEnclosingNode    ast.Node
	subgraphIDMap         map[string][]string
	currentPath           []string
	usage                 []*graphqlmetrics.ArgumentUsageInfo
}

func (a *argumentUsageInfoVisitor) EnterField(ref int) {
	a.fieldEnclosingNode = a.walker.EnclosingTypeDefinition
	// Track the current field path for subgraph ID lookup
	fieldName := a.operation.FieldNameString(ref)
	a.currentPath = append(a.currentPath, fieldName)
}

func (a *argumentUsageInfoVisitor) LeaveField(_ int) {
	// Remove the current field from the path when leaving
	if len(a.currentPath) > 0 {
		a.currentPath = a.currentPath[:len(a.currentPath)-1]
	}
}

func (a *argumentUsageInfoVisitor) EnterArgument(ref int) {
	argName := a.operation.ArgumentNameBytes(ref)
	anc := a.walker.Ancestors[len(a.walker.Ancestors)-1]
	if anc.Kind != ast.NodeKindField {
		return
	}
	fieldName := a.operation.FieldNameBytes(anc.Ref)
	enclosingTypeName := a.definition.NodeNameBytes(a.fieldEnclosingNode)
	argDef := a.definition.NodeFieldDefinitionArgumentDefinitionByName(a.fieldEnclosingNode, fieldName, argName)
	if argDef == -1 {
		return
	}
	argType := a.definition.InputValueDefinitionType(argDef)
	typeName := a.definition.ResolveTypeNameBytes(argType)

	// Look up subgraph IDs for the current field path
	var subgraphIDs []string
	if len(a.currentPath) > 0 {
		pathKey := pathToKey(a.currentPath)
		if ids, exists := a.subgraphIDMap[pathKey]; exists {
			subgraphIDs = ids
		}
	}

	a.usage = append(a.usage, &graphqlmetrics.ArgumentUsageInfo{
		Path:        []string{string(fieldName), string(argName)},
		TypeName:    string(enclosingTypeName),
		NamedType:   string(typeName),
		SubgraphIDs: subgraphIDs,
	})
}

// GetInputUsageInfo extracts usage for input types and fields from variable values.
// Builds field/variable → subgraph mappings, then traverses variable values to apply subgraph IDs.
// Handles nested inputs, scalars, and variable name remapping (e.g., normalized $a → original $criteria).
// Skips null values as they don't represent actual usage.
func GetInputUsageInfo(operation, definition *ast.Document, variables *astjson.Value, operationPlan plan.Plan, remapVariables map[string]string) ([]*graphqlmetrics.InputUsageInfo, error) {
	// Build a mapping of field paths to their subgraph IDs from the plan
	subgraphIDMap := buildFieldSubgraphIDMap(operationPlan)

	// Build a mapping of variables to the fields that use them and their subgraph IDs
	variableSubgraphMap := buildVariableSubgraphMap(operation, definition, subgraphIDMap)

	visitor := &inputUsageInfoVisitor{
		operation:           operation,
		definition:          definition,
		variables:           variables,
		variableSubgraphMap: variableSubgraphMap,
		remapVariables:      remapVariables,
		// Pre-allocate with reasonable capacity to reduce allocations
		usage: make([]*graphqlmetrics.InputUsageInfo, 0, 16),
	}

	for i := range operation.VariableDefinitions {
		visitor.EnterVariableDefinition(i)
	}

	return visitor.usage, nil
}

type inputUsageInfoVisitor struct {
	definition, operation *ast.Document
	variables             *astjson.Value
	variableSubgraphMap   map[string][]string
	remapVariables        map[string]string
	currentVariableName   string
	usage                 []*graphqlmetrics.InputUsageInfo
}

func (v *inputUsageInfoVisitor) EnterVariableDefinition(ref int) {
	varTypeRef := v.operation.VariableDefinitions[ref].Type
	varTypeName := v.operation.ResolveTypeNameString(varTypeRef)

	// Get the variable name from the (possibly normalized/minified) operation AST
	// After normalization, variable names may be shortened: $criteria → $a
	normalizedVarName := v.operation.VariableValueNameString(v.operation.VariableDefinitions[ref].VariableValue.Ref)

	// Map the normalized name back to the original if remapping is available
	// The variables JSON always uses original names, but the AST uses normalized names
	// Example: AST has "$a", remapVariables["a"] = "criteria", JSON has {"criteria": {...}}
	originalVarName := normalizedVarName
	if v.remapVariables != nil {
		if remapped, exists := v.remapVariables[normalizedVarName]; exists {
			originalVarName = remapped
		}
	}

	// Look up the variable value using the original name
	jsonField := v.variables.Get(originalVarName)
	if jsonField == nil {
		return
	}

	// Skip null values - they don't represent actual schema usage
	if jsonField.Type() == astjson.TypeNull {
		return
	}

	// Use the normalized name for subgraph ID lookup (it matches the AST structure)
	v.currentVariableName = normalizedVarName
	v.traverseVariable(jsonField, originalVarName, varTypeName, "")
}

// traverseVariable recursively processes variable values, tracking input types and fields.
// Handles scalars, enums, input objects, and arrays. SubgraphIDs inherited from variableSubgraphMap.
func (v *inputUsageInfoVisitor) traverseVariable(jsonValue *astjson.Value, fieldName, typeName, parentTypeName string) {
	defNode, ok := v.definition.NodeByNameStr(typeName)

	usageInfo := &graphqlmetrics.InputUsageInfo{
		NamedType: typeName,
	}
	if parentTypeName != "" {
		usageInfo.TypeName = parentTypeName
		// Pre-allocate Path slice with exact capacity
		usageInfo.Path = []string{parentTypeName, fieldName}
	}

	// Get subgraph IDs for this variable from the mapping built in STEP 2
	// All fields in this variable inherit the same subgraph IDs
	if v.currentVariableName != "" {
		if subgraphIDs, exists := v.variableSubgraphMap[v.currentVariableName]; exists {
			usageInfo.SubgraphIDs = subgraphIDs
		}
	}

	// If the type is not found in the definition (e.g., built-in scalars like Boolean, String, Int),
	// we still want to track its usage.
	// Built-in scalars don't have type definitions in the schema document.
	if !ok {
		// This is likely a built-in scalar type, track it and return
		v.appendUniqueUsage(usageInfo)
		return
	}

	switch defNode.Kind {
	case ast.NodeKindInputObjectTypeDefinition:
		switch jsonValue.Type() {
		case astjson.TypeArray:
			for _, arrayValue := range jsonValue.GetArray() {
				v.traverseVariable(arrayValue, fieldName, typeName, parentTypeName)
			}
		case astjson.TypeObject:
			o := jsonValue.GetObject()
			o.Visit(func(key []byte, value *astjson.Value) {
				// Skip null fields - they don't represent actual schema usage
				if value.Type() == astjson.TypeNull {
					return
				}

				fieldRef := v.definition.InputObjectTypeDefinitionInputValueDefinitionByName(defNode.Ref, key)
				if fieldRef == -1 {
					return
				}
				fieldTypeName := v.definition.ResolveTypeNameString(v.definition.InputValueDefinitions[fieldRef].Type)
				if v.definition.TypeIsList(v.definition.InputValueDefinitions[fieldRef].Type) {
					for _, arrayValue := range value.GetArray() {
						v.traverseVariable(arrayValue, string(key), fieldTypeName, typeName)
					}
				} else {
					v.traverseVariable(value, string(key), fieldTypeName, typeName)
				}
			})
		}

	case ast.NodeKindEnumTypeDefinition:
		switch jsonValue.Type() {
		case astjson.TypeString:
			usageInfo.EnumValues = []string{string(jsonValue.GetStringBytes())}
		case astjson.TypeArray:
			arr := jsonValue.GetArray()
			// Pre-allocate EnumValues slice with exact capacity
			usageInfo.EnumValues = make([]string, len(arr))
			for i, arrayValue := range arr {
				usageInfo.EnumValues[i] = string(arrayValue.GetStringBytes())
			}
		}
	case ast.NodeKindScalarTypeDefinition:
		// Custom scalar types defined in the schema (e.g., DateTime, JSON, Upload)
		// Just track the usage, no special handling needed since we can't inspect
		// the internal structure of custom scalars
	}

	v.appendUniqueUsage(usageInfo)
}

func (v *inputUsageInfoVisitor) appendUniqueUsage(info *graphqlmetrics.InputUsageInfo) {
	for _, u := range v.usage {
		if v.infoEquals(u, info) {
			return
		}
	}
	v.usage = append(v.usage, info)
}

func (v *inputUsageInfoVisitor) infoEquals(a, b *graphqlmetrics.InputUsageInfo) bool {
	if a.Count != b.Count {
		return false
	}
	if a.NamedType != b.NamedType {
		return false
	}
	if a.TypeName != b.TypeName {
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
