package yokoclient

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
)

const mockTestSchema = `
schema {
	query: Query
	mutation: Mutation
}

scalar ID
scalar String
scalar Int
scalar Float
scalar Boolean

type Query {
	user(id: ID!): User
	users: [User!]!
	products: [Product!]!
}

type Mutation {
	createUser(name: String!): User!
}

type User {
	id: ID!
	name: String!
	email: String!
}

type Product {
	id: ID!
	title: String!
	price: Float!
}
`

func TestMockClient_GenerateMatchingPrompt(t *testing.T) {
	doc, report := astparser.ParseGraphqlDocumentString(mockTestSchema)
	require.False(t, report.HasErrors())

	m := NewMockClient(&doc)
	results, err := m.Generate(context.Background(), "find all users", "hash")
	require.NoError(t, err)
	require.NotEmpty(t, results)

	// Should match "users" field
	found := false
	for _, r := range results {
		if r.Query != "" {
			found = true
			assert.Contains(t, r.Description, "users")
		}
	}
	assert.True(t, found, "expected to find a query matching 'users'")
}

func TestMockClient_GenerateSkipsFieldsWithRequiredArgs(t *testing.T) {
	doc, report := astparser.ParseGraphqlDocumentString(mockTestSchema)
	require.False(t, report.HasErrors())

	m := NewMockClient(&doc)
	// "users" matches "users" (no required args), "user" has required arg and is skipped
	results, err := m.Generate(context.Background(), "find users", "hash")
	require.NoError(t, err)
	require.NotEmpty(t, results)
	// Ensure no query for "user(id: ID!)" was generated
	for _, r := range results {
		assert.NotContains(t, r.Query, "user(")
	}
}

func TestMockClient_GenerateFallback(t *testing.T) {
	doc, report := astparser.ParseGraphqlDocumentString(mockTestSchema)
	require.False(t, report.HasErrors())

	m := NewMockClient(&doc)
	// "zzz" doesn't match any field name, should fallback to first field without required args
	results, err := m.Generate(context.Background(), "zzz nonexistent", "hash")
	require.NoError(t, err)
	require.NotEmpty(t, results)
	assert.Contains(t, results[0].Description, "Default query")
}

func TestMockClient_GenerateEmptyPrompt(t *testing.T) {
	doc, report := astparser.ParseGraphqlDocumentString(mockTestSchema)
	require.False(t, report.HasErrors())

	m := NewMockClient(&doc)
	_, err := m.Generate(context.Background(), "", "hash")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "prompt cannot be empty")
}

func TestMockClient_GenerateWhitespacePrompt(t *testing.T) {
	doc, report := astparser.ParseGraphqlDocumentString(mockTestSchema)
	require.False(t, report.HasErrors())

	m := NewMockClient(&doc)
	_, err := m.Generate(context.Background(), "   ", "hash")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "prompt cannot be empty")
}

func TestMockClient_GenerateWithSubfields(t *testing.T) {
	doc, report := astparser.ParseGraphqlDocumentString(mockTestSchema)
	require.False(t, report.HasErrors())

	m := NewMockClient(&doc)
	results, err := m.Generate(context.Background(), "products", "hash")
	require.NoError(t, err)
	require.NotEmpty(t, results)

	// Should include scalar subfields of Product
	assert.Contains(t, results[0].Query, "id")
	assert.Contains(t, results[0].Query, "title")
}

func TestMockClient_NilSchema(t *testing.T) {
	m := NewMockClient(nil)
	_, err := m.Generate(context.Background(), "test", "hash")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "could not generate a valid query")
}

func TestMockClient_ValidatesGeneratedQueries(t *testing.T) {
	doc, report := astparser.ParseGraphqlDocumentString(mockTestSchema)
	require.False(t, report.HasErrors())

	m := NewMockClient(&doc)
	results, err := m.Generate(context.Background(), "products", "hash")
	require.NoError(t, err)

	// All returned queries should be valid
	for _, r := range results {
		assert.True(t, m.validateQuery(r.Query), "query should be valid: %s", r.Query)
	}
}

func TestMockClient_ScalarReturnType(t *testing.T) {
	schema := `
schema { query: Query }
scalar String
type Query {
	hello: String
}
`
	doc, report := astparser.ParseGraphqlDocumentString(schema)
	require.False(t, report.HasErrors())

	m := NewMockClient(&doc)
	results, err := m.Generate(context.Background(), "hello", "hash")
	require.NoError(t, err)
	require.NotEmpty(t, results)
	// String is a scalar, so no subfields
	assert.Contains(t, results[0].Query, "hello")
}

func TestMockClient_CustomScalarField(t *testing.T) {
	schema := `
schema { query: Query }
scalar String
scalar DateTime
type Query {
	now: DateTime
}
`
	doc, report := astparser.ParseGraphqlDocumentString(schema)
	require.False(t, report.HasErrors())

	m := NewMockClient(&doc)
	results, err := m.Generate(context.Background(), "now", "hash")
	require.NoError(t, err)
	require.NotEmpty(t, results)
	assert.Contains(t, results[0].Query, "now")
}

func TestMockClient_ImplementsYokoClientInterface(t *testing.T) {
	doc, report := astparser.ParseGraphqlDocumentString(mockTestSchema)
	require.False(t, report.HasErrors())

	var _ YokoClient = NewMockClient(&doc)
}

func TestClient_ImplementsYokoClientInterface(t *testing.T) {
	var _ YokoClient = NewClient("http://example.com", AuthConfig{}, 5, nil)
}
