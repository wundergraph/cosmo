package mcpserver

import (
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
			name: "no scoped fields: list employees with public info",
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
			name: "single scoped root query field: facts titles only",
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
			name: "single scoped mutation field",
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
			name: "single scoped entity field with AND group",
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
			name: "multiple scoped fields via inline fragments on different types",
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
			name: "cross-subgraph scoped fields from products and employees",
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
			name: "no scoped fields despite touching scoped type (startDate excluded)",
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

			extractor := NewScopeExtractor(fieldConfigs, &schemaDoc)
			fieldReqs := extractor.ExtractScopesForOperation(&opDoc)

			if tt.wantNoScopes {
				assert.Empty(t, fieldReqs, "expected no scoped fields")
			} else {
				assert.Len(t, fieldReqs, tt.wantFields, "unexpected number of scoped fields")
			}
		})
	}
}

func TestExtractScopesForOperation_FieldDetails(t *testing.T) {
	t.Parallel()

	fieldConfigs := testFieldConfigs()

	schemaDoc := parseTestSchema(t)

	extractor := NewScopeExtractor(fieldConfigs, &schemaDoc)

	t.Run("root query field returns correct OR-of-AND scopes", func(t *testing.T) {
		t.Parallel()
		opDoc, report := astparser.ParseGraphqlDocumentString(`
			query GetTopSecretFacts {
			  topSecretFederationFacts {
			    ... on DirectiveFact { title }
			  }
			}`)
		require.False(t, report.HasErrors())

		fieldReqs := extractor.ExtractScopesForOperation(&opDoc)
		require.Len(t, fieldReqs, 1)
		assert.Equal(t, "Query", fieldReqs[0].TypeName)
		assert.Equal(t, "topSecretFederationFacts", fieldReqs[0].FieldName)
		assert.Equal(t, [][]string{{"read:fact"}, {"read:all"}}, fieldReqs[0].OrScopes)
	})

	t.Run("entity field returns AND scopes with OR alternative", func(t *testing.T) {
		t.Parallel()
		opDoc, report := astparser.ParseGraphqlDocumentString(`
			query GetEmployeeStartDate($id: Int!) {
			  employee(id: $id) {
			    startDate
			  }
			}`)
		require.False(t, report.HasErrors())

		fieldReqs := extractor.ExtractScopesForOperation(&opDoc)
		require.Len(t, fieldReqs, 1)
		assert.Equal(t, "Employee", fieldReqs[0].TypeName)
		assert.Equal(t, "startDate", fieldReqs[0].FieldName)
		assert.Equal(t, [][]string{{"read:employee", "read:private"}, {"read:all"}}, fieldReqs[0].OrScopes)
	})

	t.Run("mutation field returns correct scopes", func(t *testing.T) {
		t.Parallel()
		opDoc, report := astparser.ParseGraphqlDocumentString(`
			mutation AddFact($fact: TopSecretFactInput!) {
			  addFact(fact: $fact) {
			    ... on DirectiveFact { title }
			  }
			}`)
		require.False(t, report.HasErrors())

		fieldReqs := extractor.ExtractScopesForOperation(&opDoc)
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
			name:      "no field requirements returns nil",
			fieldReqs: nil,
			want:      nil,
		},
		{
			name: "single field passes through directly",
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
			name: "two fields: cross-product with dedup",
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
			name: "three fields: full cross-product with dedup",
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

			extractor := NewScopeExtractor(testFieldConfigs(), &schemaDoc)
			got := extractor.ComputeCombinedScopes(tt.fieldReqs)
			assert.Equal(t, tt.want, got)
		})
	}
}
