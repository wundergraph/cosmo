package jsonschema

import (
	"encoding/json"
	"testing"

	"github.com/santhosh-tekuri/jsonschema/v5"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
)

// TestRecursiveInputAcceptsNestedPayload verifies that a self-recursive GraphQL
// input type produces a JSON Schema that accepts arbitrarily nested payloads.
//
// A self-recursive input type cannot be represented by inlining and truncating
// at a fixed recursion depth: the recursive fields get dropped from the schema,
// and because every object is emitted with `additionalProperties: false`, a
// valid nested payload is then rejected at the validation boundary with
// "additional properties '...' not allowed". The schema must instead reference
// the recursive type so that nesting is permitted to any depth.
func TestRecursiveInputAcceptsNestedPayload(t *testing.T) {
	schemaSDL := scalarDefinitions + `
		schema { query: Query }

		type Query {
			createColumn(input: ColumnInput!): Boolean
		}

		input ColumnInput {
			node: FormulaNodeInput!
		}

		input FormulaNodeInput {
			nodeType: NodeType!
			left: FormulaNodeInput
			right: FormulaNodeInput
			value: Float
		}

		enum NodeType {
			CONSTANT
			BINARY_OPERATION
		}
	`

	operationSDL := `
		query CreateColumn($input: ColumnInput!) {
			createColumn(input: $input)
		}
	`

	definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
	require.False(t, report.HasErrors(), "schema parsing failed: %s", report.Error())

	operationDoc, report := astparser.ParseGraphqlDocumentString(operationSDL)
	require.False(t, report.HasErrors(), "operation parsing failed: %s", report.Error())

	schema, err := BuildJsonSchema(&operationDoc, &definitionDoc)
	require.NoError(t, err)

	schemaJSON, err := json.Marshal(schema)
	require.NoError(t, err)

	compiled, err := jsonschema.CompileString("schema.json", string(schemaJSON))
	require.NoError(t, err, "generated JSON schema should compile")

	// A depth-2 expression tree: the inner BINARY_OPERATION node has its own
	// left/right children, exercising recursion beyond a single level.
	const payloadJSON = `{
		"input": {
			"node": {
				"nodeType": "BINARY_OPERATION",
				"left": {
					"nodeType": "BINARY_OPERATION",
					"left":  { "nodeType": "CONSTANT", "value": 1 },
					"right": { "nodeType": "CONSTANT", "value": 2 }
				},
				"right": { "nodeType": "CONSTANT", "value": 3 }
			}
		}
	}`

	var payload any
	require.NoError(t, json.Unmarshal([]byte(payloadJSON), &payload))

	err = compiled.Validate(payload)
	require.NoError(t, err, "valid nested recursive payload must be accepted by the generated schema")
}
