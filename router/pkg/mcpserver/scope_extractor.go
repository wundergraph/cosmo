package mcpserver

import (
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
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
	fieldConfigs []*nodev1.FieldConfiguration
	schemaDoc    *ast.Document
}

// NewScopeExtractor creates a new ScopeExtractor.
func NewScopeExtractor(fieldConfigs []*nodev1.FieldConfiguration, schemaDoc *ast.Document) *ScopeExtractor {
	return &ScopeExtractor{
		fieldConfigs: fieldConfigs,
		schemaDoc:    schemaDoc,
	}
}

// ExtractScopesForOperation walks the operation's selection set and returns
// per-field scope requirements for fields that have @requiresScopes.
func (e *ScopeExtractor) ExtractScopesForOperation(operation *ast.Document) []FieldScopeRequirement {
	// TODO: implement
	return nil
}

// ComputeCombinedScopes computes the Cartesian product of OR-groups across fields,
// deduplicating scopes within each combined AND-group.
func (e *ScopeExtractor) ComputeCombinedScopes(fieldReqs []FieldScopeRequirement) [][]string {
	// TODO: implement
	return nil
}