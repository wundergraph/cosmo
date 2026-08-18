package mcpserver

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
)

// buildTestResponseSchema parses the schema and operation and builds the
// response schema, returning the builder error for error-path tests
func buildTestResponseSchema(t *testing.T, schemaStr, operationStr string) (json.RawMessage, error) {
	t.Helper()

	schemaDoc, report := astparser.ParseGraphqlDocumentString(schemaStr)
	require.False(t, report.HasErrors(), "failed to parse schema")
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&schemaDoc))

	opDoc, report := astparser.ParseGraphqlDocumentString(operationStr)
	require.False(t, report.HasErrors(), "failed to parse operation")

	schema, err := buildResponseSchema(&opDoc, &schemaDoc)
	if err != nil {
		return nil, err
	}

	raw, err := json.Marshal(schema)
	require.NoError(t, err)
	return raw, nil
}

// mustBuildTestResponseSchema builds the response schema and fails the test on error
func mustBuildTestResponseSchema(t *testing.T, schemaStr, operationStr string) json.RawMessage {
	t.Helper()

	schema, err := buildTestResponseSchema(t, schemaStr, operationStr)
	require.NoError(t, err)

	return schema
}

// schemaAt unmarshals the schema and follows the given property path
func schemaAt(t *testing.T, rawSchema json.RawMessage, path ...string) map[string]any {
	t.Helper()

	var schema map[string]any
	require.NoError(t, json.Unmarshal(rawSchema, &schema))

	for _, key := range path {
		properties, ok := schema["properties"].(map[string]any)
		require.True(t, ok, "expected properties containing %q", key)
		schema, ok = properties[key].(map[string]any)
		require.True(t, ok, "expected property %q", key)
	}

	return schema
}

func TestBuildResponseSchema(t *testing.T) {
	t.Run("envelope shape", func(t *testing.T) {
		schema := mustBuildTestResponseSchema(t, `
schema { query: Query }
type Query { hello: String }
`, `query Hello { hello }`)

		assert.JSONEq(t, `{
			"type": "object",
			"properties": {
				"data": {
					"type": ["object", "null"],
					"properties": {
						"hello": {"type": ["string", "null"]}
					},
					"required": ["hello"]
				}
			}
		}`, string(schema))
	})

	t.Run("scalar mapping", func(t *testing.T) {
		schema := mustBuildTestResponseSchema(t, `
schema { query: Query }
type Query { s: String! i: Int! f: Float b: Boolean! id: ID }
`, `query Scalars { s i f b id }`)

		assert.JSONEq(t, `{
			"type": "object",
			"properties": {
				"data": {
					"type": ["object", "null"],
					"properties": {
						"s": {"type": "string"},
						"i": {"type": "integer"},
						"f": {"type": ["number", "null"]},
						"b": {"type": "boolean"},
						"id": {"type": ["string", "null"]}
					},
					"required": ["b", "f", "i", "id", "s"]
				}
			}
		}`, string(schema))
	})

	t.Run("nested objects and lists", func(t *testing.T) {
		schema := mustBuildTestResponseSchema(t, `
schema { query: Query }
type Query { employees: [Employee!]! }
type Employee { id: ID! tags: [[String!]!] }
`, `query Employees { employees { id tags } }`)

		assert.JSONEq(t, `{
			"type": "object",
			"properties": {
				"data": {
					"type": ["object", "null"],
					"properties": {
						"employees": {
							"type": "array",
							"items": {
								"type": "object",
								"properties": {
									"id": {"type": "string"},
									"tags": {
										"type": ["array", "null"],
										"items": {
											"type": "array",
											"items": {"type": "string"}
										}
									}
								},
								"required": ["id", "tags"]
							}
						}
					},
					"required": ["employees"]
				}
			}
		}`, string(schema))
	})

	t.Run("aliases become response keys", func(t *testing.T) {
		schema := mustBuildTestResponseSchema(t, `
schema { query: Query }
type Query { employee(id: ID!): Employee }
type Employee { id: ID! name: String! }
`, `query Aliases { a: employee(id: "1") { id } b: employee(id: "2") { name } }`)

		data := schemaAt(t, schema, "data")
		properties := data["properties"].(map[string]any)
		assert.Contains(t, properties, "a")
		assert.Contains(t, properties, "b")
		assert.NotContains(t, properties, "employee")
		assert.Equal(t, []any{"a", "b"}, data["required"])

		assert.Contains(t, schemaAt(t, schema, "data", "a")["properties"], "id")
		assert.Contains(t, schemaAt(t, schema, "data", "b")["properties"], "name")
	})

	t.Run("typename is a non-null string", func(t *testing.T) {
		schema := mustBuildTestResponseSchema(t, `
schema { query: Query }
type Query { employee(id: ID!): Employee }
type Employee { id: ID! }
`, `query Typename { employee(id: "1") { __typename t: __typename id } }`)

		assert.Equal(t, map[string]any{"type": "string"}, schemaAt(t, schema, "data", "employee", "__typename"))
		assert.Equal(t, map[string]any{"type": "string"}, schemaAt(t, schema, "data", "employee", "t"))
		assert.Equal(t, []any{"__typename", "id", "t"}, schemaAt(t, schema, "data", "employee")["required"])
	})

	t.Run("enum values and nullability", func(t *testing.T) {
		schema := mustBuildTestResponseSchema(t, `
schema { query: Query }
type Query { status: Status! mood: Mood }
enum Status { ACTIVE INACTIVE }
enum Mood { HAPPY SAD }
`, `query Enums { status mood }`)

		data := schemaAt(t, schema, "data")
		properties := data["properties"].(map[string]any)
		assert.Equal(t, map[string]any{"type": "string", "enum": []any{"ACTIVE", "INACTIVE"}}, properties["status"])
		assert.Equal(t, map[string]any{"type": []any{"string", "null"}, "enum": []any{"HAPPY", "SAD", nil}}, properties["mood"])
	})

	t.Run("custom scalar accepts any value", func(t *testing.T) {
		schema := mustBuildTestResponseSchema(t, `
schema { query: Query }
type Query { meta: JSON! }
"Arbitrary JSON"
scalar JSON
`, `query Meta { meta }`)

		data := schemaAt(t, schema, "data")
		assert.Equal(t, map[string]any{"description": "Arbitrary JSON"}, data["properties"].(map[string]any)["meta"])
		assert.Equal(t, []any{"meta"}, data["required"])
	})

	t.Run("field descriptions from the schema", func(t *testing.T) {
		schema := mustBuildTestResponseSchema(t, `
schema { query: Query }
type Query { employee(id: ID!): Employee }
type Employee {
  "The employee ID"
  id: ID!
}
`, `query Description { employee(id: "1") { id } }`)

		id := schemaAt(t, schema, "data", "employee", "id")
		assert.Equal(t, "The employee ID", id["description"])
	})

	t.Run("fragment spread on the same type is unconditional", func(t *testing.T) {
		schema := mustBuildTestResponseSchema(t, `
schema { query: Query }
type Query { employee(id: ID!): Employee }
type Employee { id: ID! name: String! }
`, `query Fragment { employee(id: "1") { ...Basics } }
fragment Basics on Employee { id name }`)

		employee := schemaAt(t, schema, "data", "employee")
		assert.Contains(t, employee["properties"], "id")
		assert.Contains(t, employee["properties"], "name")
		assert.Equal(t, []any{"id", "name"}, employee["required"])
	})

	t.Run("skip include and defer make fields optional", func(t *testing.T) {
		schema := mustBuildTestResponseSchema(t, `
schema { query: Query }
type Query { employee(id: ID!): Employee }
type Employee { id: ID! name: String! email: String phone: String }
`, `query Conditional($b: Boolean!) {
  employee(id: "1") {
    id @include(if: $b)
    name
    ... @skip(if: $b) { email }
    ...Deferred @defer
  }
}
fragment Deferred on Employee { phone }`)

		employee := schemaAt(t, schema, "data", "employee")
		properties := employee["properties"].(map[string]any)
		assert.Contains(t, properties, "id")
		assert.Contains(t, properties, "email")
		assert.Contains(t, properties, "phone")
		assert.Equal(t, []any{"name"}, employee["required"])
	})

	t.Run("fragment on an implemented interface is unconditional", func(t *testing.T) {
		schema := mustBuildTestResponseSchema(t, `
schema { query: Query }
type Query { employee(id: ID!): Employee }
interface Node { id: ID! }
type Employee implements Node { id: ID! name: String! }
`, `query Interface { employee(id: "1") { ... on Node { id } name } }`)

		employee := schemaAt(t, schema, "data", "employee")
		assert.Equal(t, []any{"id", "name"}, employee["required"])
	})

	t.Run("interface field with concrete fragments", func(t *testing.T) {
		schema := mustBuildTestResponseSchema(t, `
schema { query: Query }
type Query { node: Node }
interface Node { id: ID! }
type User implements Node { id: ID! name: String! }
type Bot implements Node { id: ID! model: String! }
`, `query Node { node { id __typename ... on User { name } ... on Bot { model } } }`)

		node := schemaAt(t, schema, "data", "node")
		properties := node["properties"].(map[string]any)
		assert.Contains(t, properties, "id")
		assert.Contains(t, properties, "__typename")
		assert.Contains(t, properties, "name")
		assert.Contains(t, properties, "model")
		assert.Equal(t, []any{"__typename", "id"}, node["required"])
	})

	t.Run("union selections merge into one object", func(t *testing.T) {
		schema := mustBuildTestResponseSchema(t, `
schema { query: Query }
type Query { search: SearchResult }
union SearchResult = User | Bot
type User { name: String! }
type Bot { model: String! }
`, `query Search { search { __typename ... on User { name } ... on Bot { model } } }`)

		search := schemaAt(t, schema, "data", "search")
		properties := search["properties"].(map[string]any)
		assert.Contains(t, properties, "name")
		assert.Contains(t, properties, "model")
		assert.Equal(t, []any{"__typename"}, search["required"])
	})

	t.Run("same field in multiple branches merges required-ness", func(t *testing.T) {
		schema := mustBuildTestResponseSchema(t, `
schema { query: Query }
type Query { node: Node }
interface Node { id: ID! }
type User implements Node { id: ID! }
type Bot implements Node { id: ID! }
`, `query Node { node { ... on User { id } ... on Bot { id } id } }`)

		node := schemaAt(t, schema, "data", "node")
		assert.Equal(t, map[string]any{"type": "string"}, node["properties"].(map[string]any)["id"])
		assert.Equal(t, []any{"id"}, node["required"])
	})

	t.Run("conflicting alias across union members degrades to any", func(t *testing.T) {
		schema := mustBuildTestResponseSchema(t, `
schema { query: Query }
type Query { search: SearchResult }
union SearchResult = User | Bot
type User { age: Int! }
type Bot { label: String! }
`, `query Search { search { ... on User { x: age } ... on Bot { x: label } } }`)

		search := schemaAt(t, schema, "data", "search")
		// The accept-anything schema marshals as the boolean schema "true"
		assert.Equal(t, true, search["properties"].(map[string]any)["x"])
		assert.NotContains(t, search, "required")
	})

	t.Run("object schemas merge across branches", func(t *testing.T) {
		schema := mustBuildTestResponseSchema(t, `
schema { query: Query }
type Query { search: SearchResult }
union SearchResult = User | Bot
type User { profile: Profile }
type Bot { profile: Profile }
type Profile { name: String! age: Int! }
`, `query Search { search { ... on User { profile { name } } ... on Bot { profile { age } } } }`)

		profile := schemaAt(t, schema, "data", "search", "profile")
		properties := profile["properties"].(map[string]any)
		assert.Contains(t, properties, "name")
		assert.Contains(t, properties, "age")
		assert.NotContains(t, profile, "required")
	})

	t.Run("mutation root", func(t *testing.T) {
		schema := mustBuildTestResponseSchema(t, `
schema { query: Query mutation: Mutation }
type Query { employee(id: ID!): Employee }
type Mutation { updateMood(id: ID!): Employee }
type Employee { id: ID! }
`, `mutation UpdateMood { updateMood(id: "1") { id } }`)

		data := schemaAt(t, schema, "data")
		assert.Contains(t, data["properties"], "updateMood")
	})

	t.Run("custom root type names", func(t *testing.T) {
		schema := mustBuildTestResponseSchema(t, `
schema { query: RootQ }
type RootQ { ping: String }
`, `query Ping { ping }`)

		data := schemaAt(t, schema, "data")
		assert.Contains(t, data["properties"], "ping")
	})
}

// TestBuildResponseSchemaFragmentCycle proves that fragment spread cycles in
// documents that were never validated against the schema are detected instead
// of recursing forever
func TestBuildResponseSchemaFragmentCycle(t *testing.T) {
	t.Run("self cycle", func(t *testing.T) {
		_, err := buildTestResponseSchema(t, `
schema { query: Query }
type Query { employee(id: ID!): Employee }
type Employee { id: ID! }
`, `query Cycle { employee(id: "1") { ...F } }
fragment F on Employee { id ...F }`)

		require.ErrorContains(t, err, `fragment "F" forms a cycle`)
	})

	t.Run("mutual cycle", func(t *testing.T) {
		_, err := buildTestResponseSchema(t, `
schema { query: Query }
type Query { employee(id: ID!): Employee }
type Employee { id: ID! name: String! }
`, `query Cycle { employee(id: "1") { ...A } }
fragment A on Employee { id ...B }
fragment B on Employee { name ...A }`)

		require.ErrorContains(t, err, "forms a cycle")
	})

	t.Run("same fragment in sibling selections is not a cycle", func(t *testing.T) {
		schema := mustBuildTestResponseSchema(t, `
schema { query: Query }
type Query { employee(id: ID!): Employee }
type Employee { id: ID! name: String! }
`, `query Siblings { a: employee(id: "1") { ...Basics } b: employee(id: "2") { ...Basics } }
fragment Basics on Employee { id name }`)

		for _, key := range []string{"a", "b"} {
			selection := schemaAt(t, schema, "data", key)
			assert.Contains(t, selection["properties"], "id")
			assert.Contains(t, selection["properties"], "name")
			assert.Equal(t, []any{"id", "name"}, selection["required"])
		}
	})
}

// TestBuildResponseSchemaUnknownField documents the degradation contract: the
// builder hard-errors so that the caller registers the tool without an output schema
func TestBuildResponseSchemaUnknownField(t *testing.T) {
	_, err := buildTestResponseSchema(t, `
schema { query: Query }
type Query { hello: String }
`, `query Unknown { bogus }`)

	require.ErrorContains(t, err, "not defined on type")
}

// TestBuildResponseSchemaNeverRejectsValidResponse pins the guiding principle
// of the builder against a real JSON schema validator: no valid GraphQL
// response for the operation may fail validation against the generated schema
func TestBuildResponseSchemaNeverRejectsValidResponse(t *testing.T) {
	schema := mustBuildTestResponseSchema(t, `
schema { query: Query }
type Query { search: SearchResult employee(id: ID!): Employee }
union SearchResult = User | Bot
type User { name: String! profile: Profile }
type Bot { model: String! profile: Profile }
type Profile { name: String age: Int }
type Employee { id: ID! name: String! email: String }
`, `query Everything($b: Boolean!) {
  search {
    __typename
    ... on User { name profile { name } }
    ... on Bot { model profile { age } }
  }
  employee(id: "1") {
    id @include(if: $b)
    name
    email @skip(if: $b)
  }
}`)

	unmarshaled, err := jsonschema.UnmarshalJSON(bytes.NewReader(schema))
	require.NoError(t, err)

	compiler := jsonschema.NewCompiler()
	require.NoError(t, compiler.AddResource("response.json", unmarshaled))
	compiled, err := compiler.Compile("response.json")
	require.NoError(t, err)

	responses := map[string]string{
		"user branch":                `{"data":{"search":{"__typename":"User","name":"Ada","profile":{"name":"p"}},"employee":{"id":"1","name":"Jens","email":null}}}`,
		"bot branch, skipped fields": `{"data":{"search":{"__typename":"Bot","model":"m-1","profile":{"age":3}},"employee":{"name":"Jens"}}}`,
		"null data":                  `{"data":null}`,
		"errors and extensions":      `{"data":{"search":null,"employee":null},"errors":[{"message":"boom"}],"extensions":{"traceId":"abc"}}`,
		"null profile":               `{"data":{"search":{"__typename":"User","name":"Ada","profile":null},"employee":{"id":"1","name":"Jens","email":"jens@wundergraph.com"}}}`,
	}

	for name, response := range responses {
		t.Run(name, func(t *testing.T) {
			var v any
			require.NoError(t, json.Unmarshal([]byte(response), &v))
			assert.NoError(t, compiled.Validate(v), "a valid GraphQL response must never fail validation")
		})
	}
}
