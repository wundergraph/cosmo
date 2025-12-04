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
// For list-typed fields:
//   - Null list values (e.g., tags: null where tags: [String]) are tracked with IsNull=true
//   - Empty lists (e.g., tags: []) are tracked with IsNull=false (field is used, just no elements)
//   - Null elements within lists (e.g., tags: ["a", null, "b"]) are NOT individually tracked
//     (the field-level usage already indicates the list type is being used)
//
// # Design Components
//
// The package uses a unified AST walk with pluggable collectors:
//
// - walkContext: Shared state for AST traversal (path, stacks, documents)
// - collector: Interface for components that collect data during the walk
// - unifiedVisitor: Single AST walker that delegates to multiple collectors
//
// Individual collectors handle specific concerns:
// - variableSubgraphCollector: Maps variables to subgraph IDs
// - argumentUsageCollector: Collects argument usage metrics
// - implicitInputCollector: Tracks implicit null input type arguments
//
// This design enables:
// - Single O(n) AST walk instead of multiple passes
// - Independent testing of each collector
// - Easy addition of new collectors without changing walk infrastructure
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
//
// The variables parameter can be nil, which is treated as "no variables provided". When nil,
// null detection for variable-based arguments will default to false (cannot determine nullness).
func GetArgumentUsageInfo(operation, definition *ast.Document, variables *astjson.Value, operationPlan plan.Plan, remapVariables map[string]string) ([]*graphqlmetrics.ArgumentUsageInfo, error) {
	fieldSubgraphMap := buildFieldSubgraphIDMap(operationPlan)
	nullDetector := newNullValueDetector(operation, variables, remapVariables)

	// Create argument collector (no variable mapping needed for argument usage)
	argCollector := newArgumentUsageCollector(operation, definition, nullDetector)

	// Run unified walk
	ctx := newWalkContext(operation, definition)
	err := runUnifiedWalk(ctx, argCollector)
	if err != nil {
		return nil, err
	}

	// Finalize argument usage with subgraph IDs
	argCollector.finalizeSubgraphIDs(fieldSubgraphMap)

	return argCollector.usage, nil
}

// GetInputUsageInfo extracts input usage by traversing variable values. Tracks both explicit
// nulls ({"field": null}) and implicit nulls (missing fields) for breaking change detection.
// Also tracks input usage for implicitly null input type arguments (arguments not provided).
//
// The variables parameter can be nil, which is treated as "no variables provided". When nil,
// input object types are still tracked with IsNull=true for breaking change detection.
func GetInputUsageInfo(operation, definition *ast.Document, variables *astjson.Value, operationPlan plan.Plan, remapVariables map[string]string) ([]*graphqlmetrics.InputUsageInfo, error) {
	fieldSubgraphMap := buildFieldSubgraphIDMap(operationPlan)
	nullDetector := newNullValueDetector(operation, variables, remapVariables)

	// Create collectors
	varCollector := newVariableSubgraphCollector(operation, fieldSubgraphMap)
	inputCollector := newImplicitInputCollector(definition)

	// Run unified walk
	ctx := newWalkContext(operation, definition)
	err := runUnifiedWalk(ctx, varCollector, inputCollector)
	if err != nil {
		return nil, err
	}

	// Build subgraph mapper from collected variable mappings
	subgraphMapper := &subgraphMapper{
		fieldToSubgraphs:    fieldSubgraphMap,
		variableToSubgraphs: varCollector.variableMap,
	}

	// Create input traverser and process variable definitions
	traverser := newInputTraverser(definition, subgraphMapper)

	// Track input usage from variable definitions
	for i := range operation.VariableDefinitions {
		processVariableDefinition(traverser, operation, definition, variables, nullDetector, subgraphMapper, i)
	}

	// Finalize implicit input usage with subgraph IDs
	inputCollector.finalizeUsage(traverser, fieldSubgraphMap)

	return traverser.usage, nil
}

// ============================================
// Type Field Usage
// ============================================

// An array of TypeFieldUsageInfo, with a method to convert it into a []*graphqlmetrics.TypeFieldUsageInfo
type TypeFieldMetrics []*TypeFieldUsageInfo

// IntoGraphQLMetrics converts the TypeFieldMetrics into a []*graphqlmetrics.TypeFieldUsageInfo
func (t TypeFieldMetrics) IntoGraphQLMetrics() []*graphqlmetrics.TypeFieldUsageInfo {
	if len(t) == 0 {
		return nil
	}

	// Pre-allocate backing array for all structs in one allocation to reduce heap allocations
	backing := make([]graphqlmetrics.TypeFieldUsageInfo, len(t))
	metrics := make([]*graphqlmetrics.TypeFieldUsageInfo, len(t))

	for i, info := range t {
		backing[i] = graphqlmetrics.TypeFieldUsageInfo{
			Path:                   info.Path,
			TypeNames:              info.ParentTypeNames,
			SubgraphIDs:            info.SubgraphIDs,
			NamedType:              info.NamedType,
			IndirectInterfaceField: info.IndirectInterfaceField,
			Count:                  0,
		}
		metrics[i] = &backing[i]
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
// Use TypeFieldMetrics.IntoGraphQLMetrics where possible if processing in bulk, it's faster.
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

// typeFieldUsageInfoVisitor walks the execution plan to extract type and field usage.
type typeFieldUsageInfoVisitor struct {
	typeFieldUsageInfo []*TypeFieldUsageInfo
}

// visitNode recursively traverses the resolve tree to extract field usage info.
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
// Unified AST Walk Infrastructure
// ============================================

// walkContext provides shared state for AST traversal.
// It manages common resources like path building and enclosing type tracking
// that multiple collectors need during the walk.
type walkContext struct {
	walker         *astvisitor.Walker
	operation      *ast.Document
	definition     *ast.Document
	pathBuilder    *pathBuilder
	enclosingStack []ast.Node            // Stack of enclosing type definitions
	argumentsStack []map[string]struct{} // Stack tracking provided arguments per field
}

func newWalkContext(operation, definition *ast.Document) *walkContext {
	return &walkContext{
		operation:      operation,
		definition:     definition,
		pathBuilder:    newPathBuilder(8),
		enclosingStack: make([]ast.Node, 0, 8),
		argumentsStack: make([]map[string]struct{}, 0, 8),
	}
}

// PathKey returns the current field path as a dot-separated string
func (c *walkContext) PathKey() string {
	return c.pathBuilder.key()
}

// CurrentEnclosingNode returns the enclosing type definition for the current field
func (c *walkContext) CurrentEnclosingNode() (ast.Node, bool) {
	if len(c.enclosingStack) == 0 {
		return ast.Node{}, false
	}
	return c.enclosingStack[len(c.enclosingStack)-1], true
}

// CurrentProvidedArguments returns the set of provided arguments for the current field
func (c *walkContext) CurrentProvidedArguments() map[string]struct{} {
	if len(c.argumentsStack) == 0 {
		return nil
	}
	return c.argumentsStack[len(c.argumentsStack)-1]
}

// TrackProvidedArgument records that an argument was provided for the current field
func (c *walkContext) TrackProvidedArgument(argName string) {
	if len(c.argumentsStack) == 0 {
		return
	}
	stackIdx := len(c.argumentsStack) - 1
	if c.argumentsStack[stackIdx] == nil {
		c.argumentsStack[stackIdx] = make(map[string]struct{}, 4)
	}
	c.argumentsStack[stackIdx][argName] = struct{}{}
}

// collector is the interface for components that collect data during AST traversal.
// Each collector handles a specific concern (variable mapping, argument usage, etc.)
// and can be tested independently.
type collector interface {
	// EnterField is called when entering a field during AST traversal
	EnterField(ctx *walkContext, ref int)
	// LeaveField is called when leaving a field during AST traversal
	LeaveField(ctx *walkContext, ref int)
	// EnterArgument is called when entering an argument during AST traversal
	EnterArgument(ctx *walkContext, ref int)
}

// unifiedVisitor walks the AST once and delegates to multiple collectors.
// It manages the shared walk context and invokes collectors at each AST node.
type unifiedVisitor struct {
	ctx        *walkContext
	collectors []collector
}

func (v *unifiedVisitor) EnterField(ref int) {
	// Update shared context
	v.ctx.enclosingStack = append(v.ctx.enclosingStack, v.ctx.walker.EnclosingTypeDefinition)
	v.ctx.argumentsStack = append(v.ctx.argumentsStack, nil)
	fieldName := v.ctx.operation.FieldNameString(ref)
	v.ctx.pathBuilder.push(fieldName)

	// Delegate to collectors
	for _, c := range v.collectors {
		c.EnterField(v.ctx, ref)
	}
}

func (v *unifiedVisitor) LeaveField(ref int) {
	// Delegate to collectors first (they may need context state)
	for _, c := range v.collectors {
		c.LeaveField(v.ctx, ref)
	}

	// Update shared context
	v.ctx.pathBuilder.pop()
	if len(v.ctx.enclosingStack) > 0 {
		v.ctx.enclosingStack = v.ctx.enclosingStack[:len(v.ctx.enclosingStack)-1]
	}
	if len(v.ctx.argumentsStack) > 0 {
		v.ctx.argumentsStack = v.ctx.argumentsStack[:len(v.ctx.argumentsStack)-1]
	}
}

func (v *unifiedVisitor) EnterArgument(ref int) {
	// Track provided argument in shared context
	argName := v.ctx.operation.ArgumentNameBytes(ref)
	anc := v.ctx.walker.Ancestors[len(v.ctx.walker.Ancestors)-1]
	if anc.Kind == ast.NodeKindField {
		v.ctx.TrackProvidedArgument(string(argName))
	}

	// Delegate to collectors
	for _, c := range v.collectors {
		c.EnterArgument(v.ctx, ref)
	}
}

// runUnifiedWalk executes a single AST walk with the given collectors.
func runUnifiedWalk(ctx *walkContext, collectors ...collector) error {
	walker := astvisitor.NewWalker(48)
	ctx.walker = &walker

	visitor := &unifiedVisitor{
		ctx:        ctx,
		collectors: collectors,
	}

	walker.RegisterEnterFieldVisitor(visitor)
	walker.RegisterLeaveFieldVisitor(visitor)
	walker.RegisterEnterArgumentVisitor(visitor)

	rep := &operationreport.Report{}
	walker.Walk(ctx.operation, ctx.definition, rep)
	if rep.HasErrors() {
		return rep
	}
	return nil
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

// subgraphIDCollector walks the execution plan to extract field path → subgraph ID mappings.
type subgraphIDCollector struct {
	fieldMap  map[string][]string
	pathStack []string
}

// collectFromNode recursively extracts field → subgraph ID mappings from the resolve tree.
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
// Variable Subgraph Collector
// ============================================

// variableSubgraphCollector maps variable names to subgraph IDs by tracking
// which fields use each variable. Implements the collector interface.
type variableSubgraphCollector struct {
	operation        *ast.Document
	fieldSubgraphMap map[string][]string
	variableMap      map[string][]string
}

func newVariableSubgraphCollector(operation *ast.Document, fieldSubgraphMap map[string][]string) *variableSubgraphCollector {
	return &variableSubgraphCollector{
		operation:        operation,
		fieldSubgraphMap: fieldSubgraphMap,
		variableMap:      make(map[string][]string),
	}
}

func (v *variableSubgraphCollector) EnterField(_ *walkContext, _ int) {
	// No action needed - context handles path building
}

func (v *variableSubgraphCollector) LeaveField(_ *walkContext, _ int) {
	// No action needed - context handles path building
}

func (v *variableSubgraphCollector) EnterArgument(ctx *walkContext, ref int) {
	arg := v.operation.Arguments[ref]

	if arg.Value.Kind != ast.ValueKindVariable {
		return
	}

	varName := v.operation.VariableValueNameString(arg.Value.Ref)
	if varName == "" {
		return
	}

	pathKey := ctx.PathKey()
	if subgraphIDs, exists := v.fieldSubgraphMap[pathKey]; exists {
		v.variableMap[varName] = mergeSubgraphIDs(v.variableMap[varName], subgraphIDs)
	}
}

// ============================================
// Argument Usage Collector
// ============================================

// argumentUsageCollector collects argument usage metrics during AST traversal.
// It tracks both provided arguments and implicit null arguments.
// Implements the collector interface.
type argumentUsageCollector struct {
	operation    *ast.Document
	definition   *ast.Document
	nullDetector *nullValueDetector
	usage        []*graphqlmetrics.ArgumentUsageInfo
	// Temporary storage for path keys, resolved after walk when subgraph map is complete
	pathKeyPerUsage []string
}

func newArgumentUsageCollector(operation, definition *ast.Document, nullDetector *nullValueDetector) *argumentUsageCollector {
	return &argumentUsageCollector{
		operation:       operation,
		definition:      definition,
		nullDetector:    nullDetector,
		usage:           make([]*graphqlmetrics.ArgumentUsageInfo, 0, 16),
		pathKeyPerUsage: make([]string, 0, 16),
	}
}

func (a *argumentUsageCollector) EnterField(_ *walkContext, _ int) {
	// No action needed - context handles path and stack management
}

func (a *argumentUsageCollector) LeaveField(ctx *walkContext, ref int) {
	// Track implicit null arguments (defined in schema but not provided)
	a.trackImplicitNullArguments(ctx, ref)
}

func (a *argumentUsageCollector) EnterArgument(ctx *walkContext, ref int) {
	argName := a.operation.ArgumentNameBytes(ref)
	anc := ctx.walker.Ancestors[len(ctx.walker.Ancestors)-1]
	if anc.Kind != ast.NodeKindField {
		return
	}

	enclosingNode, ok := ctx.CurrentEnclosingNode()
	if !ok {
		return
	}

	fieldName := a.operation.FieldNameBytes(anc.Ref)
	enclosingTypeName := a.definition.NodeNameBytes(enclosingNode)
	argDef := a.definition.NodeFieldDefinitionArgumentDefinitionByName(enclosingNode, fieldName, argName)
	if argDef == -1 {
		return
	}
	argType := a.definition.InputValueDefinitionType(argDef)
	typeName := a.definition.ResolveTypeNameBytes(argType)

	// Check if argument is null
	arg := a.operation.Arguments[ref]
	isNull := a.nullDetector.isValueNull(arg.Value)

	// Store usage info (subgraph IDs will be resolved later)
	a.usage = append(a.usage, &graphqlmetrics.ArgumentUsageInfo{
		Path:      []string{string(fieldName), string(argName)},
		TypeName:  string(enclosingTypeName),
		NamedType: string(typeName),
		IsNull:    isNull,
	})
	a.pathKeyPerUsage = append(a.pathKeyPerUsage, ctx.PathKey())
}

// trackImplicitNullArguments tracks arguments defined in schema but not provided in operation.
func (a *argumentUsageCollector) trackImplicitNullArguments(ctx *walkContext, fieldRef int) {
	enclosingNode, ok := ctx.CurrentEnclosingNode()
	if !ok || enclosingNode.Kind == ast.NodeKindUnknown {
		return
	}

	fieldName := a.operation.FieldNameBytes(fieldRef)
	// Skip introspection fields
	if len(fieldName) > 1 && fieldName[0] == '_' && fieldName[1] == '_' {
		return
	}

	enclosingTypeName := a.definition.NodeNameBytes(enclosingNode)

	// Find all arguments defined for this field
	argumentRefs := getFieldArgumentRefs(a.definition, enclosingNode, fieldName)

	// Get provided arguments from context
	providedArguments := ctx.CurrentProvidedArguments()

	pathKey := ctx.PathKey()

	// Track arguments that are defined but not provided
	for _, argRef := range argumentRefs {
		argName := string(a.definition.InputValueDefinitionNameString(argRef))

		if providedArguments != nil {
			if _, provided := providedArguments[argName]; provided {
				continue
			}
		}

		argType := a.definition.InputValueDefinitionType(argRef)
		typeName := a.definition.ResolveTypeNameString(argType)

		a.usage = append(a.usage, &graphqlmetrics.ArgumentUsageInfo{
			Path:      []string{string(fieldName), argName},
			TypeName:  string(enclosingTypeName),
			NamedType: typeName,
			IsNull:    true,
		})
		a.pathKeyPerUsage = append(a.pathKeyPerUsage, pathKey)
	}
}

// finalizeSubgraphIDs resolves subgraph IDs for all collected usage after the walk completes.
func (a *argumentUsageCollector) finalizeSubgraphIDs(fieldSubgraphMap map[string][]string) {
	for i, pathKey := range a.pathKeyPerUsage {
		a.usage[i].SubgraphIDs = fieldSubgraphMap[pathKey]
	}
}

// ============================================
// Implicit Input Collector
// ============================================

// implicitInputUsage stores data needed to finalize implicit input usage after the walk.
type implicitInputUsage struct {
	typeName string
	pathKey  string
}

// implicitInputCollector tracks implicit null input type arguments during AST traversal.
// Implements the collector interface.
type implicitInputCollector struct {
	definition     *ast.Document
	implicitInputs []implicitInputUsage
}

func newImplicitInputCollector(definition *ast.Document) *implicitInputCollector {
	return &implicitInputCollector{
		definition:     definition,
		implicitInputs: make([]implicitInputUsage, 0, 8),
	}
}

func (c *implicitInputCollector) EnterField(_ *walkContext, _ int) {
	// No action needed
}

func (c *implicitInputCollector) LeaveField(ctx *walkContext, ref int) {
	c.trackImplicitInputTypeArguments(ctx, ref)
}

func (c *implicitInputCollector) EnterArgument(_ *walkContext, _ int) {
	// Argument tracking is handled by walkContext
}

func (c *implicitInputCollector) trackImplicitInputTypeArguments(ctx *walkContext, fieldRef int) {
	enclosingNode, ok := ctx.CurrentEnclosingNode()
	if !ok || enclosingNode.Kind == ast.NodeKindUnknown {
		return
	}

	fieldName := ctx.operation.FieldNameBytes(fieldRef)
	// Skip introspection fields
	if len(fieldName) > 1 && fieldName[0] == '_' && fieldName[1] == '_' {
		return
	}

	// Find all arguments defined for this field
	argumentRefs := getFieldArgumentRefs(c.definition, enclosingNode, fieldName)

	providedArgs := ctx.CurrentProvidedArguments()
	pathKey := ctx.PathKey()

	// Track input types for implicitly null arguments
	for _, argRef := range argumentRefs {
		argName := string(c.definition.InputValueDefinitionNameString(argRef))

		if providedArgs != nil {
			if _, provided := providedArgs[argName]; provided {
				continue
			}
		}

		argType := c.definition.InputValueDefinitionType(argRef)
		typeName := c.definition.ResolveTypeNameString(argType)

		// Check if this is an input object type
		defNode, ok := c.definition.NodeByNameStr(typeName)
		if !ok || defNode.Kind != ast.NodeKindInputObjectTypeDefinition {
			continue
		}

		c.implicitInputs = append(c.implicitInputs, implicitInputUsage{
			typeName: typeName,
			pathKey:  pathKey,
		})
	}
}

// getFieldArgumentRefs returns argument definition refs for a field in the schema.
// Shared helper used by both argumentUsageCollector and implicitInputCollector.
func getFieldArgumentRefs(definition *ast.Document, enclosingNode ast.Node, fieldName []byte) []int {
	var argumentRefs []int
	switch enclosingNode.Kind {
	case ast.NodeKindObjectTypeDefinition:
		fieldDefs := definition.ObjectTypeDefinitions[enclosingNode.Ref].FieldsDefinition.Refs
		for _, fieldDefRef := range fieldDefs {
			fieldDef := definition.FieldDefinitions[fieldDefRef]
			if bytes.Equal(definition.FieldDefinitionNameBytes(fieldDefRef), fieldName) {
				if fieldDef.HasArgumentsDefinitions {
					argumentRefs = fieldDef.ArgumentsDefinition.Refs
				}
				break
			}
		}
	case ast.NodeKindInterfaceTypeDefinition:
		fieldDefs := definition.InterfaceTypeDefinitions[enclosingNode.Ref].FieldsDefinition.Refs
		for _, fieldDefRef := range fieldDefs {
			fieldDef := definition.FieldDefinitions[fieldDefRef]
			if bytes.Equal(definition.FieldDefinitionNameBytes(fieldDefRef), fieldName) {
				if fieldDef.HasArgumentsDefinitions {
					argumentRefs = fieldDef.ArgumentsDefinition.Refs
				}
				break
			}
		}
	}
	return argumentRefs
}

// finalizeUsage adds implicit input usage to the traverser with resolved subgraph IDs.
func (c *implicitInputCollector) finalizeUsage(traverser *inputTraverser, fieldSubgraphMap map[string][]string) {
	for _, input := range c.implicitInputs {
		subgraphIDs := fieldSubgraphMap[input.pathKey]
		traverser.appendUniqueUsage(&graphqlmetrics.InputUsageInfo{
			NamedType:   input.typeName,
			Path:        []string{input.typeName},
			SubgraphIDs: subgraphIDs,
			IsNull:      true,
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

// inputFieldInfo represents an input object field's name and type.
type inputFieldInfo struct {
	name     string
	typeName string
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
		t.traverseInputObject(jsonValue, fieldName, typeName, parentTypeName, usageInfo)
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
func (t *inputTraverser) traverseInputObject(jsonValue *astjson.Value, fieldName, typeName, parentTypeName string, usageInfo *graphqlmetrics.InputUsageInfo) {
	switch jsonValue.Type() {
	case astjson.TypeArray:
		// Note: arrays at this level mean list of input objects (e.g., [InputType])
		// If we reach here, the array itself is not null, so iterate normally
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
		// If the list field itself is null, record a single null usage and stop.
		// This is critical for breaking change detection (e.g., [String] -> [String]!).
		if fieldIsNull {
			t.traverse(value, fieldName, fieldTypeName, parentTypeName, true)
			return
		}

		// List is not null - iterate through elements
		arr := value.GetArray()
		if len(arr) == 0 {
			// Empty list - still track the field usage for breaking change detection.
			// The schema dependency exists even if no elements are provided.
			t.traverse(value, fieldName, fieldTypeName, parentTypeName, false)
			return
		}
		for _, arrayValue := range arr {
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

// appendUniqueUsage adds usage info if not already present.
// Note: Uses O(n) linear scan for deduplication. For very large operations with thousands
// of input fields, consider using a map-based approach for O(1) lookups.
func (t *inputTraverser) appendUniqueUsage(info *graphqlmetrics.InputUsageInfo) {
	for _, u := range t.usage {
		if t.infoEquals(u, info) {
			return
		}
	}
	t.usage = append(t.usage, info)
}

// infoEquals checks deep equality between two InputUsageInfo instances.
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
// Handles nil variables gracefully by treating them as "no variables provided".
func processVariableDefinition(traverser *inputTraverser, operation, definition *ast.Document, variables *astjson.Value, nullDetector *nullValueDetector, subgraphMapper *subgraphMapper, ref int) {
	varDef := operation.VariableDefinitions[ref]
	varTypeRef := varDef.Type
	varTypeName := operation.ResolveTypeNameString(varTypeRef)

	// Get normalized variable name from AST
	normalizedVarName := operation.VariableValueNameString(varDef.VariableValue.Ref)

	// Map back to original name for JSON lookup
	originalVarName := nullDetector.getOriginalVariableName(normalizedVarName)

	// Look up the variable value (treat nil variables as "no variables provided")
	var jsonField *astjson.Value
	if variables != nil {
		jsonField = variables.Get(originalVarName)
	}

	if jsonField == nil {
		// Variable is not provided in variables JSON (or variables is nil) - still track input type usage if it's an input object type
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
