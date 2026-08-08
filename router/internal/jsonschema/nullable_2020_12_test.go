package jsonschema

import (
	"encoding/json"
	"testing"

	"github.com/santhosh-tekuri/jsonschema/v5"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
)

// TestNullableFieldsAreJSONSchema2020_12 verifies that the generator expresses
// nullability in the JSON Schema 2020-12 form rather than the OpenAPI 3.0
// keyword `"nullable": true` (which standard validators silently ignore).
//
// Concretely: a payload that contains explicit `null` values for nullable
// scalar, enum, and recursive-ref fields must validate cleanly against the
// generated schema using a strict standard JSON Schema validator.
func TestNullableFieldsAreJSONSchema2020_12(t *testing.T) {
	schemaSDL := scalarDefinitions + `
		schema { query: Query }

		type Query {
			processFormula(tree: FormulaNodeInput): Boolean
			doThing(input: ThingInput): Boolean
		}

		input ThingInput {
			name: String
			count: Int
			rating: Float
			active: Boolean
			status: Status
		}

		enum Status { ACTIVE INACTIVE }

		input FormulaNodeInput {
			nodeType: NodeType!
			left:  FormulaNodeInput
			right: FormulaNodeInput
			value: Float
		}

		enum NodeType { CONSTANT BINARY_OPERATION }
	`

	operationSDL := `
		query Run($tree: FormulaNodeInput, $input: ThingInput) {
			processFormula(tree: $tree)
			doThing(input: $input)
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

	// Nullable scalars and enum: explicit null values must be accepted.
	t.Run("explicit nulls accepted for nullable scalar and enum fields", func(t *testing.T) {
		const payloadJSON = `{
			"input": {
				"name":   null,
				"count":  null,
				"rating": null,
				"active": null,
				"status": null
			}
		}`
		var payload any
		require.NoError(t, json.Unmarshal([]byte(payloadJSON), &payload))
		require.NoError(t, compiled.Validate(payload),
			"nullable scalar/enum fields must accept explicit null per JSON Schema 2020-12")
	})

	// Nullable recursive $ref: a leaf may explicitly set left/right to null
	// (rather than omitting them) and the schema must accept it.
	t.Run("explicit nulls accepted for nullable recursive ref fields", func(t *testing.T) {
		const payloadJSON = `{
			"tree": {
				"nodeType": "BINARY_OPERATION",
				"left":  { "nodeType": "CONSTANT", "value": 1, "left": null, "right": null },
				"right": null
			}
		}`
		var payload any
		require.NoError(t, json.Unmarshal([]byte(payloadJSON), &payload))
		require.NoError(t, compiled.Validate(payload),
			"nullable recursive ref fields must accept explicit null per JSON Schema 2020-12")
	})
}
