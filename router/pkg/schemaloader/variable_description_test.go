package schemaloader

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"go.uber.org/zap"
)

// TestVariableDescriptionInJSONSchema proves that a description attached to a
// GraphQL variable definition ends up in the JSON schema that the MCP server
// exposes as a tool's InputSchema.
func TestVariableDescriptionInJSONSchema(t *testing.T) {
	schemaStr := `
schema { query: Query }
type Query { employee(id: ID!): Employee }
type Employee { id: ID! name: String! }
`
	schemaDoc, report := astparser.ParseGraphqlDocumentString(schemaStr)
	require.False(t, report.HasErrors(), "failed to parse schema")
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&schemaDoc))

	// Operation with a description on the $id variable definition.
	opStr := `query FindEmployee(
  "The unique identifier of the employee to fetch"
  $id: ID!
) {
  employee(id: $id) { id name }
}`
	opDoc, report := astparser.ParseGraphqlDocumentString(opStr)
	require.False(t, report.HasErrors(), "failed to parse operation")

	ops := []Operation{{Name: "FindEmployee", Document: opDoc}}

	builder := NewSchemaBuilder(&schemaDoc)
	require.NoError(t, builder.BuildSchemasForOperations(ops))

	t.Logf("Generated InputSchema:\n%s", string(ops[0].JSONSchema))

	// Decode exactly like router/pkg/mcpserver/server.go does for tool.InputSchema.
	var inputSchema struct {
		Properties map[string]struct {
			Description string `json:"description"`
		} `json:"properties"`
	}
	require.NoError(t, json.Unmarshal(ops[0].JSONSchema, &inputSchema))

	idProp, ok := inputSchema.Properties["id"]
	require.True(t, ok, "expected an 'id' property in the tool input schema")
	require.Equal(t,
		"The unique identifier of the employee to fetch",
		idProp.Description,
		"variable description should be visible in the MCP tool input schema")
}

// TestVariableDescriptionStrippedFromForwardedQuery proves that variable-definition
// descriptions are removed from the OperationString forwarded to upstreams (which
// reject them as invalid GraphQL), while still being retained on the loaded
// Document so they can enrich the MCP tool input schema.
func TestVariableDescriptionStrippedFromForwardedQuery(t *testing.T) {
	schemaStr := `
schema { query: Query }
type Query { country(code: ID!): Country }
type Country { name: String! capital: String }
`
	schemaDoc, report := astparser.ParseGraphqlDocumentString(schemaStr)
	require.False(t, report.HasErrors(), "failed to parse schema")
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&schemaDoc))

	tempDir := t.TempDir()
	opFile := `"""
Look up a country.
"""
query GetCountry(
  """
  The ISO 3166-1 alpha-2 code
  """
  $code: ID!
) {
  country(code: $code) { name capital }
}`
	require.NoError(t, os.WriteFile(filepath.Join(tempDir, "GetCountry.graphql"), []byte(opFile), 0644))

	loader := NewOperationLoader(zap.NewNop(), &schemaDoc)
	operations, err := loader.LoadOperationsFromDirectory(tempDir)
	require.NoError(t, err)
	require.Len(t, operations, 1)

	op := operations[0]
	t.Logf("Forwarded OperationString:\n%s", op.OperationString)

	// The query forwarded to the upstream must be plain, spec-standard GraphQL.
	require.NotContains(t, op.OperationString, "ISO 3166-1",
		"variable description must be stripped from the forwarded query")
	require.NotContains(t, op.OperationString, "Look up a country",
		"operation description must be stripped from the forwarded query")

	// ...but the description is still retained for MCP tool metadata.
	require.Equal(t, "Look up a country.", op.Description)

	// ...and still reaches the JSON schema built from the loaded Document.
	builder := NewSchemaBuilder(&schemaDoc)
	require.NoError(t, builder.BuildSchemasForOperations(operations))
	require.Contains(t, string(operations[0].JSONSchema), "The ISO 3166-1 alpha-2 code",
		"variable description must still reach the MCP tool input schema")
}
