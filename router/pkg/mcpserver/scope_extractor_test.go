package mcpserver

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
)

// testFieldConfigs returns field configurations matching the demo subgraphs'
// @requiresScopes directives after composition (from config.json).
func testFieldConfigs() []*nodev1.FieldConfiguration {
	return []*nodev1.FieldConfiguration{
		{
			TypeName:  "Query",
			FieldName: "topSecretFederationFacts",
			AuthorizationConfiguration: &nodev1.AuthorizationConfiguration{
				RequiredOrScopes: []*nodev1.Scopes{
					{RequiredAndScopes: []string{"read:fact"}},
					{RequiredAndScopes: []string{"read:all"}},
				},
			},
		},
		{
			TypeName:  "Mutation",
			FieldName: "addFact",
			AuthorizationConfiguration: &nodev1.AuthorizationConfiguration{
				RequiredOrScopes: []*nodev1.Scopes{
					{RequiredAndScopes: []string{"write:fact"}},
					{RequiredAndScopes: []string{"write:all"}},
				},
			},
		},
		{
			TypeName:  "Employee",
			FieldName: "startDate",
			AuthorizationConfiguration: &nodev1.AuthorizationConfiguration{
				RequiredOrScopes: []*nodev1.Scopes{
					{RequiredAndScopes: []string{"read:employee", "read:private"}},
					{RequiredAndScopes: []string{"read:all"}},
				},
			},
		},
		{
			TypeName:  "TopSecretFact",
			FieldName: "description",
			AuthorizationConfiguration: &nodev1.AuthorizationConfiguration{
				RequiredOrScopes: []*nodev1.Scopes{
					{RequiredAndScopes: []string{"read:scalar"}},
					{RequiredAndScopes: []string{"read:all"}},
				},
			},
		},
		{
			TypeName:  "DirectiveFact",
			FieldName: "description",
			AuthorizationConfiguration: &nodev1.AuthorizationConfiguration{
				RequiredOrScopes: []*nodev1.Scopes{
					{RequiredAndScopes: []string{"read:scalar"}},
					{RequiredAndScopes: []string{"read:all"}},
				},
			},
		},
		{
			TypeName:  "EntityFact",
			FieldName: "description",
			AuthorizationConfiguration: &nodev1.AuthorizationConfiguration{
				RequiredOrScopes: []*nodev1.Scopes{
					{RequiredAndScopes: []string{"read:scalar"}},
					{RequiredAndScopes: []string{"read:all"}},
				},
			},
		},
		{
			TypeName:  "MiscellaneousFact",
			FieldName: "description",
			AuthorizationConfiguration: &nodev1.AuthorizationConfiguration{
				RequiredOrScopes: []*nodev1.Scopes{
					{RequiredAndScopes: []string{"read:scalar", "read:miscellaneous"}},
					{RequiredAndScopes: []string{"read:all", "read:miscellaneous"}},
				},
			},
		},
		// Fields with no scope requirements (included to verify they're ignored)
		{
			TypeName:  "Query",
			FieldName: "employees",
		},
		{
			TypeName:  "Query",
			FieldName: "employee",
		},
		{
			TypeName:  "Employee",
			FieldName: "id",
		},
		{
			TypeName:  "Employee",
			FieldName: "tag",
		},
	}
}

// testSchemaSDL is a minimal schema covering the demo subgraph types
// needed for selection set walking in scope extraction tests.
const testSchemaSDL = `
type Query {
  employees: [Employee!]!
  employee(id: Int!): Employee
  topSecretFederationFacts: [TopSecretFact!]!
}

type Mutation {
  addFact(fact: TopSecretFactInput!): TopSecretFact!
}

input TopSecretFactInput {
  title: String!
  description: String
}

type Employee {
  id: Int!
  details: Details!
  tag: String!
  updatedAt: String!
  startDate: String!
}

type Details {
  forename: String!
  surname: String!
}

interface TopSecretFact {
  title: String!
  description: String
}

type DirectiveFact implements TopSecretFact {
  title: String!
  description: String
}

type EntityFact implements TopSecretFact {
  title: String!
  description: String
}

type MiscellaneousFact implements TopSecretFact {
  title: String!
  description: String
}
`

// parseTestSchema parses the test schema SDL and merges it with the base schema
// (required by the AST walker to resolve operation types like Query/Mutation).
func parseTestSchema(t *testing.T) ast.Document {
	t.Helper()
	doc, report := astparser.ParseGraphqlDocumentString(testSchemaSDL)
	require.False(t, report.HasErrors(), "schema parse error: %s", report.Error())
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&doc))
	return doc
}

func TestExtractScopesForOperation(t *testing.T) {
	t.Parallel()

	fieldConfigs := testFieldConfigs()

	tests := []struct {
		name         string
		operation    string
		wantFields   int  // expected number of scoped FieldScopeRequirements
		wantNoScopes bool // expect nil/empty RequiredScopes
	}{
		{
			name: "returns no scoped fields for query with only public fields",
			operation: `
				query ListEmployees {
				  employees {
				    id
				    details {
				      forename
				      surname
				    }
				    tag
				  }
				}`,
			wantFields:   0,
			wantNoScopes: true,
		},
		{
			name: "returns one scoped field for scoped root query field",
			operation: `
				query GetTopSecretFacts {
				  topSecretFederationFacts {
				    ... on DirectiveFact { title }
				    ... on EntityFact { title }
				    ... on MiscellaneousFact { title }
				  }
				}`,
			wantFields: 1, // Query.topSecretFederationFacts
		},
		{
			name: "returns one scoped field for scoped mutation",
			operation: `
				mutation AddFact($fact: TopSecretFactInput!) {
				  addFact(fact: $fact) {
				    ... on DirectiveFact { title }
				    ... on EntityFact { title }
				    ... on MiscellaneousFact { title }
				  }
				}`,
			wantFields: 1, // Mutation.addFact
		},
		{
			name: "returns one scoped field for entity field with AND group",
			operation: `
				query GetEmployeeStartDate($id: Int!) {
				  employee(id: $id) {
				    id
				    details { forename surname }
				    startDate
				  }
				}`,
			wantFields: 1, // Employee.startDate
		},
		{
			name: "returns multiple scoped fields for inline fragments on different types",
			operation: `
				query GetTopSecretFactsWithDescriptions {
				  topSecretFederationFacts {
				    ... on DirectiveFact {
				      title
				      description
				    }
				    ... on MiscellaneousFact {
				      title
				      description
				    }
				  }
				}`,
			wantFields: 3, // Query.topSecretFederationFacts, DirectiveFact.description, MiscellaneousFact.description
		},
		{
			name: "returns scoped fields aggregated from multiple subgraphs",
			operation: `
				query GetFactsAndEmployeeStartDate($id: Int!) {
				  topSecretFederationFacts {
				    ... on DirectiveFact { title }
				  }
				  employee(id: $id) {
				    id
				    startDate
				  }
				}`,
			wantFields: 2, // Query.topSecretFederationFacts, Employee.startDate
		},
		{
			name: "returns no scoped fields when only unscoped fields are selected on a scoped type",
			operation: `
				query GetEmployeeBasicInfo($id: Int!) {
				  employee(id: $id) {
				    id
				    tag
				    updatedAt
				  }
				}`,
			wantFields:   0,
			wantNoScopes: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			schemaDoc := parseTestSchema(t)

			opDoc, opReport := astparser.ParseGraphqlDocumentString(tt.operation)
			require.False(t, opReport.HasErrors(), "operation parse error: %s", opReport.Error())

			extractor := NewScopeExtractor(fieldConfigs, &schemaDoc, 2048)
			fieldReqs, err := extractor.ExtractScopesForOperation(&opDoc)
			require.NoError(t, err)

			if tt.wantNoScopes {
				assert.Empty(t, fieldReqs, "expected no scoped fields")
			} else {
				assert.Len(t, fieldReqs, tt.wantFields, "unexpected number of scoped fields")
			}
		})
	}

	t.Run("returns correct OR-of-AND scopes for root query field", func(t *testing.T) {
		t.Parallel()
		schemaDoc := parseTestSchema(t)
		extractor := NewScopeExtractor(fieldConfigs, &schemaDoc, 2048)

		opDoc, report := astparser.ParseGraphqlDocumentString(`
			query GetTopSecretFacts {
			  topSecretFederationFacts {
			    ... on DirectiveFact { title }
			  }
			}`)
		require.False(t, report.HasErrors())

		fieldReqs, err := extractor.ExtractScopesForOperation(&opDoc)
		require.NoError(t, err)
		require.Len(t, fieldReqs, 1)
		assert.Equal(t, "Query", fieldReqs[0].TypeName)
		assert.Equal(t, "topSecretFederationFacts", fieldReqs[0].FieldName)
		assert.Equal(t, [][]string{{"read:fact"}, {"read:all"}}, fieldReqs[0].OrScopes)
	})

	t.Run("returns AND scopes with OR alternative for entity field", func(t *testing.T) {
		t.Parallel()
		schemaDoc := parseTestSchema(t)
		extractor := NewScopeExtractor(fieldConfigs, &schemaDoc, 2048)

		opDoc, report := astparser.ParseGraphqlDocumentString(`
			query GetEmployeeStartDate($id: Int!) {
			  employee(id: $id) {
			    startDate
			  }
			}`)
		require.False(t, report.HasErrors())

		fieldReqs, err := extractor.ExtractScopesForOperation(&opDoc)
		require.NoError(t, err)
		require.Len(t, fieldReqs, 1)
		assert.Equal(t, "Employee", fieldReqs[0].TypeName)
		assert.Equal(t, "startDate", fieldReqs[0].FieldName)
		assert.Equal(t, [][]string{{"read:employee", "read:private"}, {"read:all"}}, fieldReqs[0].OrScopes)
	})

	t.Run("returns correct scopes for mutation field", func(t *testing.T) {
		t.Parallel()
		schemaDoc := parseTestSchema(t)
		extractor := NewScopeExtractor(fieldConfigs, &schemaDoc, 2048)

		opDoc, report := astparser.ParseGraphqlDocumentString(`
			mutation AddFact($fact: TopSecretFactInput!) {
			  addFact(fact: $fact) {
			    ... on DirectiveFact { title }
			  }
			}`)
		require.False(t, report.HasErrors())

		fieldReqs, err := extractor.ExtractScopesForOperation(&opDoc)
		require.NoError(t, err)
		require.Len(t, fieldReqs, 1)
		assert.Equal(t, "Mutation", fieldReqs[0].TypeName)
		assert.Equal(t, "addFact", fieldReqs[0].FieldName)
		assert.Equal(t, [][]string{{"write:fact"}, {"write:all"}}, fieldReqs[0].OrScopes)
	})
}

func TestComputeCombinedScopes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		fieldReqs []FieldScopeRequirement
		want      [][]string
	}{
		{
			name:      "returns nil when there are no field requirements",
			fieldReqs: nil,
			want:      nil,
		},
		{
			name: "passes through a single field's scopes directly",
			fieldReqs: []FieldScopeRequirement{
				{
					TypeName:  "Query",
					FieldName: "topSecretFederationFacts",
					OrScopes:  [][]string{{"read:fact"}, {"read:all"}},
				},
			},
			want: [][]string{{"read:fact"}, {"read:all"}},
		},
		{
			name: "computes cross-product with dedup for two fields",
			fieldReqs: []FieldScopeRequirement{
				{
					TypeName:  "Query",
					FieldName: "topSecretFederationFacts",
					OrScopes:  [][]string{{"read:fact"}, {"read:all"}},
				},
				{
					TypeName:  "Employee",
					FieldName: "startDate",
					OrScopes:  [][]string{{"read:employee", "read:private"}, {"read:all"}},
				},
			},
			want: [][]string{
				{"read:fact", "read:employee", "read:private"},
				{"read:fact", "read:all"},
				{"read:all", "read:employee", "read:private"},
				{"read:all"}, // dedup: "read:all" + "read:all" → "read:all"
			},
		},
		{
			name: "computes full cross-product with dedup for three fields",
			fieldReqs: []FieldScopeRequirement{
				{
					TypeName:  "Query",
					FieldName: "topSecretFederationFacts",
					OrScopes:  [][]string{{"read:fact"}, {"read:all"}},
				},
				{
					TypeName:  "DirectiveFact",
					FieldName: "description",
					OrScopes:  [][]string{{"read:scalar"}, {"read:all"}},
				},
				{
					TypeName:  "MiscellaneousFact",
					FieldName: "description",
					OrScopes:  [][]string{{"read:scalar", "read:miscellaneous"}, {"read:all", "read:miscellaneous"}},
				},
			},
			want: [][]string{
				// read:fact × read:scalar × (read:scalar, read:miscellaneous) → dedup read:scalar
				{"read:fact", "read:scalar", "read:miscellaneous"},
				// read:fact × read:scalar × (read:all, read:miscellaneous)
				{"read:fact", "read:scalar", "read:all", "read:miscellaneous"},
				// read:fact × read:all × (read:scalar, read:miscellaneous)
				{"read:fact", "read:all", "read:scalar", "read:miscellaneous"},
				// read:fact × read:all × (read:all, read:miscellaneous) → dedup read:all
				{"read:fact", "read:all", "read:miscellaneous"},
				// read:all × read:scalar × (read:scalar, read:miscellaneous) → dedup read:scalar
				{"read:all", "read:scalar", "read:miscellaneous"},
				// read:all × read:scalar × (read:all, read:miscellaneous) → dedup read:all
				{"read:all", "read:scalar", "read:miscellaneous"},
				// read:all × read:all × (read:scalar, read:miscellaneous) → dedup read:all
				{"read:all", "read:scalar", "read:miscellaneous"},
				// read:all × read:all × (read:all, read:miscellaneous) → dedup all
				{"read:all", "read:miscellaneous"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			schemaDoc := parseTestSchema(t)

			extractor := NewScopeExtractor(testFieldConfigs(), &schemaDoc, 2048)
			got, err := extractor.ComputeCombinedScopes(tt.fieldReqs)
			assert.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}

	t.Run("returns error when combinations exceed configured limit", func(t *testing.T) {
		t.Parallel()
		schemaDoc := parseTestSchema(t)
		extractor := NewScopeExtractor(testFieldConfigs(), &schemaDoc, 2048)

		// Build field requirements that will exceed MaxScopeCombinations (2048).
		// 12 fields × 2 OR-groups each = 2^12 = 4096 combinations > 2048.
		fieldReqs := make([]FieldScopeRequirement, 12)
		for i := range fieldReqs {
			fieldReqs[i] = FieldScopeRequirement{
				TypeName:  "Query",
				FieldName: fmt.Sprintf("field_%d", i),
				OrScopes:  [][]string{{"scope_a"}, {"scope_b"}},
			}
		}

		got, err := extractor.ComputeCombinedScopes(fieldReqs)
		assert.Error(t, err)
		assert.Nil(t, got)
		assert.Contains(t, err.Error(), "scope combination limit")
	})
}

func TestCrossProduct(t *testing.T) {
	t.Parallel()

	t.Run("returns empty result when OR list is empty", func(t *testing.T) {
		t.Parallel()
		got, err := crossProduct([][]string{}, [][]string{{"x"}}, 100)
		require.NoError(t, err)
		assert.Empty(t, got)
	})

	t.Run("returns the other side unchanged when AND group is empty", func(t *testing.T) {
		t.Parallel()
		got, err := crossProduct([][]string{{}}, [][]string{{"x"}}, 100)
		require.NoError(t, err)
		assert.Equal(t, [][]string{{"x"}}, got)
	})
}
