package mcpserver

import (
	"fmt"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvisitor"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
)

// FieldScopeRequirement represents the scope requirement for a single field.
// OrScopes is a list of AND-groups — satisfy any one group to access the field.
// e.g., [["a", "b"], ["c"]] means (a AND b) OR (c)
type FieldScopeRequirement struct {
	TypeName  string
	FieldName string
	OrScopes  [][]string
}

// ScopeExtractor walks operations and extracts per-field scope requirements
// from FieldConfigurations.
type ScopeExtractor struct {
	// scopeIndex maps "TypeName.FieldName" to OR-of-AND scope groups for O(1) lookup.
	scopeIndex           map[string][][]string
	schemaDoc            *ast.Document
	maxScopeCombinations int
}

// NewScopeExtractor creates a new ScopeExtractor.
func NewScopeExtractor(fieldConfigs []*nodev1.FieldConfiguration, schemaDoc *ast.Document, maxScopeCombinations int) *ScopeExtractor {
	index := make(map[string][][]string)
	for _, fc := range fieldConfigs {
		authConfig := fc.GetAuthorizationConfiguration()
		if authConfig == nil {
			continue
		}
		orScopes := authConfig.GetRequiredOrScopes()
		if len(orScopes) == 0 {
			continue
		}
		groups := make([][]string, len(orScopes))
		for i, s := range orScopes {
			groups[i] = s.GetRequiredAndScopes()
		}
		index[fc.GetTypeName()+"."+fc.GetFieldName()] = groups
	}
	return &ScopeExtractor{
		scopeIndex:           index,
		schemaDoc:            schemaDoc,
		maxScopeCombinations: maxScopeCombinations,
	}
}

// ExtractScopesForOperation walks the operation's selection set and returns
// per-field scope requirements for fields that have @requiresScopes.
func (e *ScopeExtractor) ExtractScopesForOperation(operation *ast.Document) []FieldScopeRequirement {
	walker := astvisitor.NewWalker(48)

	v := &scopeFieldVisitor{
		walker:     &walker,
		operation:  operation,
		definition: e.schemaDoc,
		scopeIndex: e.scopeIndex,
	}

	walker.RegisterEnterFieldVisitor(v)

	report := &operationreport.Report{}
	walker.Walk(operation, e.schemaDoc, report)

	return v.results
}

// ComputeCombinedScopes computes the Cartesian product of OR-groups across fields,
// deduplicating scopes within each combined AND-group.
// Returns an error if the number of combinations exceeds MaxScopeCombinations,
// which prevents pathological scope configurations from consuming unbounded resources.
func (e *ScopeExtractor) ComputeCombinedScopes(fieldReqs []FieldScopeRequirement) ([][]string, error) {
	if len(fieldReqs) == 0 {
		return nil, nil
	}

	// Start with the first field's OR-groups
	result := fieldReqs[0].OrScopes

	// Iteratively cross-product with each subsequent field's OR-groups
	for i := 1; i < len(fieldReqs); i++ {
		product, err := crossProduct(result, fieldReqs[i].OrScopes, e.maxScopeCombinations)
		if err != nil {
			return nil, fmt.Errorf("scope combination limit (%d) exceeded at field %s.%s: %w",
				e.maxScopeCombinations, fieldReqs[i].TypeName, fieldReqs[i].FieldName, err)
		}
		result = product
	}

	return result, nil
}

// scopeFieldVisitor collects scoped field coordinates during AST walking.
type scopeFieldVisitor struct {
	walker     *astvisitor.Walker
	operation  *ast.Document
	definition *ast.Document
	scopeIndex map[string][][]string
	results    []FieldScopeRequirement
	seen       map[string]struct{} // dedup "TypeName.FieldName"
}

func (v *scopeFieldVisitor) EnterField(ref int) {
	typeName := v.walker.EnclosingTypeDefinition.NameString(v.definition)
	fieldName := v.operation.FieldNameString(ref)

	coordinate := typeName + "." + fieldName

	// Deduplicate — a field can appear multiple times in a selection set
	if v.seen == nil {
		v.seen = make(map[string]struct{})
	}
	if _, ok := v.seen[coordinate]; ok {
		return
	}

	orScopes, ok := v.scopeIndex[coordinate]
	if !ok {
		return
	}

	v.seen[coordinate] = struct{}{}
	v.results = append(v.results, FieldScopeRequirement{
		TypeName:  typeName,
		FieldName: fieldName,
		OrScopes:  orScopes,
	})
}

// crossProduct computes the Cartesian product of two sets of OR-groups,
// merging AND-scopes within each combination and deduplicating.
// Returns an error if the resulting number of combinations would exceed the limit.
func crossProduct(a, b [][]string, maxCombinations int) ([][]string, error) {
	total := len(a) * len(b)
	if total > maxCombinations {
		return nil, fmt.Errorf("cross product would produce %d combinations", total)
	}
	result := make([][]string, 0, total)
	for _, groupA := range a {
		for _, groupB := range b {
			merged := mergeAndDedup(groupA, groupB)
			result = append(result, merged)
		}
	}
	return result, nil
}

// mergeAndDedup merges two AND-groups into one, preserving order and removing duplicates.
func mergeAndDedup(a, b []string) []string {
	seen := make(map[string]struct{}, len(a)+len(b))
	result := make([]string, 0, len(a)+len(b))
	for _, s := range a {
		if _, ok := seen[s]; !ok {
			seen[s] = struct{}{}
			result = append(result, s)
		}
	}
	for _, s := range b {
		if _, ok := seen[s]; !ok {
			seen[s] = struct{}{}
			result = append(result, s)
		}
	}
	return result
}
