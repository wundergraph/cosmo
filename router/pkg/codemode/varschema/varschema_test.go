package varschema

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
)

const varsTestSchemaSDL = `
schema { query: Query mutation: Mutation }
type Query {
	user(id: ID!): User
	users(filter: UserFilter, limit: Int): [User!]!
}
type Mutation {
	createUser(input: UserInput!): User!
}
type User { id: ID!, name: String! }
input UserInput { name: String!, age: Int, tags: [String!] }
input UserFilter { name: String, status: Status }
enum Status { ACTIVE INACTIVE }
`

func TestForOperationNoVariables(t *testing.T) {
	schema := mustParseSchema(t, varsTestSchemaSDL)

	got, err := ForOperation(`query Q { user(id: "x") { id } }`, schema)

	require.NoError(t, err)
	assert.Equal(t, `{"type":"object","properties":{}}`, got)
}

func TestForOperationScalarVariables(t *testing.T) {
	schema := mustParseSchema(t, varsTestSchemaSDL)

	got, err := ForOperation(`query Q($id: ID!, $limit: Int) { users(limit: $limit) { id } }`, schema)

	require.NoError(t, err)
	assert.Equal(t, `{"type":"object","properties":{"id":{"type":"string"},"limit":{"type":["integer","null"]}},"required":["id"]}`, got)
}

func TestForOperationListVariable(t *testing.T) {
	schema := mustParseSchema(t, varsTestSchemaSDL)

	got, err := ForOperation(`query Q($tags: [String!]!) { users { id } }`, schema)

	require.NoError(t, err)
	assert.Equal(t, `{"type":"object","properties":{"tags":{"type":"array","items":{"type":"string"}}},"required":["tags"]}`, got)
}

func TestForOperationInputObjectVariable(t *testing.T) {
	schema := mustParseSchema(t, varsTestSchemaSDL)

	got, err := ForOperation(`mutation M($input: UserInput!) { createUser(input: $input) { id } }`, schema)

	require.NoError(t, err)
	assert.Equal(t, `{"type":"object","properties":{"input":{"type":"object","properties":{"name":{"type":"string"},"age":{"type":["integer","null"]},"tags":{"type":["array","null"],"items":{"type":"string"}}},"required":["name"]}},"required":["input"]}`, got)
}

func TestForOperationEnumVariable(t *testing.T) {
	schema := mustParseSchema(t, varsTestSchemaSDL)

	got, err := ForOperation(`query Q($status: Status!) { users { id } }`, schema)

	require.NoError(t, err)
	assert.Equal(t, `{"type":"object","properties":{"status":{"type":"string","enum":["ACTIVE","INACTIVE"]}},"required":["status"]}`, got)
}

func mustParseSchema(t *testing.T, sdl string) *ast.Document {
	t.Helper()
	doc, report := astparser.ParseGraphqlDocumentString(sdl)
	require.False(t, report.HasErrors(), report.Error())
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&doc))
	return &doc
}
