package schemaloader

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/jsonschema"
)

func TestSchemaBuilderScalarOverrides(t *testing.T) {
	t.Run("mapped scalar emits the override type and unmapped scalar keeps the string default", func(t *testing.T) {
		schemaStr := `
schema { query: Query }
scalar Cursor
scalar JSON
type Query {
	items(filter: JSON!, after: Cursor): String
}
`
		schemaDoc, report := astparser.ParseGraphqlDocumentString(schemaStr)
		require.False(t, report.HasErrors(), "failed to parse schema")
		require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&schemaDoc))

		opStr := `query Items($filter: JSON!, $after: Cursor) {
	items(filter: $filter, after: $after)
}`
		opDoc, report := astparser.ParseGraphqlDocumentString(opStr)
		require.False(t, report.HasErrors(), "failed to parse operation")

		ops := []Operation{{Name: "Items", Document: opDoc}}

		builder := NewSchemaBuilder(&schemaDoc, WithScalarSchemas(map[string]*jsonschema.JsonSchema{
			"JSON": {Type: jsonschema.TypeObject},
		}))
		require.NoError(t, builder.BuildSchemasForOperations(ops))

		var inputSchema struct {
			Properties map[string]json.RawMessage `json:"properties"`
		}
		require.NoError(t, json.Unmarshal(ops[0].JSONSchema, &inputSchema))

		require.JSONEq(t, `{"type":"object"}`, string(inputSchema.Properties["filter"]),
			"mapped scalar JSON should emit the overridden object type")
		require.JSONEq(t, `{"type":["string","null"]}`, string(inputSchema.Properties["after"]),
			"unmapped scalar Cursor should fall back to the nullable string default")
	})

	t.Run("defaulted scalars aggregate across operations without duplicates", func(t *testing.T) {
		schemaStr := `
schema { query: Query }
scalar Cursor
scalar BigInt
scalar JSON
type Query {
	items(after: Cursor, big: BigInt, filter: JSON): String
	moreItems(after: Cursor): String
}
`
		schemaDoc, report := astparser.ParseGraphqlDocumentString(schemaStr)
		require.False(t, report.HasErrors(), "failed to parse schema")
		require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&schemaDoc))

		op1Str := `query Items($after: Cursor, $big: BigInt) {
	items(after: $after, big: $big)
}`
		op1Doc, report := astparser.ParseGraphqlDocumentString(op1Str)
		require.False(t, report.HasErrors(), "failed to parse operation 1")

		op2Str := `query MoreItems($after: Cursor) {
	moreItems(after: $after)
}`
		op2Doc, report := astparser.ParseGraphqlDocumentString(op2Str)
		require.False(t, report.HasErrors(), "failed to parse operation 2")

		ops := []Operation{
			{Name: "Items", Document: op1Doc},
			{Name: "MoreItems", Document: op2Doc},
		}

		builder := NewSchemaBuilder(&schemaDoc, WithScalarSchemas(map[string]*jsonschema.JsonSchema{
			"JSON": {Type: jsonschema.TypeObject},
		}))
		require.NoError(t, builder.BuildSchemasForOperations(ops))

		require.Equal(t, []string{"BigInt", "Cursor"}, builder.DefaultedScalars(),
			"defaulted scalars should be sorted, unique, and exclude the overridden JSON scalar")
	})
}
