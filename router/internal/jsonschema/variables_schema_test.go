package jsonschema

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
)

// scalarDefinitions contains the basic scalar types that need to be defined for tests
const scalarDefinitions = `
scalar String
scalar Int
scalar Float
scalar Boolean
scalar ID
`

func TestBuildJsonSchema(t *testing.T) {
	t.Run("simple query with input object", func(t *testing.T) {
		// Define schema
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}
			
			type Query {
				findEmployees(criteria: SearchInput): EmployeeResult
			}
			
			type EmployeeResult {
				details: EmployeeDetails
			}
			
			type EmployeeDetails {
				forename: String
			}
			
			"""Input criteria used to search for employees"""
			input SearchInput {
				name: String!
				department: String
				employmentStatus: EmploymentStatus
			}
			
			enum EmploymentStatus {
				FULL_TIME
				PART_TIME
				CONTRACTOR
				INTERN
			}
		`

		// Define operation
		operationSDL := `
			query MyEmployees($criteria: SearchInput) {
				findEmployees(criteria: $criteria) {
					details {
						forename
					}
				}
			}
		`

		// Parse schema and operation
		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		operationDoc, report := astparser.ParseGraphqlDocumentString(operationSDL)
		require.False(t, report.HasErrors(), "operation parsing failed")

		// Build JSON schema
		schema, err := BuildJsonSchema(&operationDoc, &definitionDoc)
		require.NoError(t, err)

		// Serialize schema to JSON
		data, err := json.MarshalIndent(schema, "", "  ")
		require.NoError(t, err)

		// Define expected JSON schema
		expectedJSON := `{
  "additionalProperties": false,
  "properties": {
    "criteria": {
      "additionalProperties": false,
      "description": "Input criteria used to search for employees",
      "properties": {
        "department": {
          "type": [
            "string",
            "null"
          ]
        },
        "employmentStatus": {
          "enum": [
            "FULL_TIME",
            "PART_TIME",
            "CONTRACTOR",
            "INTERN",
            null
          ],
          "type": [
            "string",
            "null"
          ]
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "name"
      ],
      "type": "object"
    }
  },
  "type": "object"
}`

		// Compare actual JSON with expected JSON
		assert.JSONEq(t, expectedJSON, string(data), "JSON schema does not match expected structure")
	})

	t.Run("query with nested input objects", func(t *testing.T) {
		// Define schema with nested inputs
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}
			
			type Query {
				findEmployees(criteria: SearchInput): [Employee]
			}
			
			type Employee {
				id: ID!
				name: String
			}
			
			input SearchInput {
				name: String
				nested: NestedInput!
			}
			
			input NestedInput {
				hasChildren: Boolean
				maritalStatus: MaritalStatus
				nationality: Nationality!
			}
			
			enum MaritalStatus {
				MARRIED
				ENGAGED
			}
			
			enum Nationality {
				AMERICAN
				DUTCH
				ENGLISH
				GERMAN
				INDIAN
				SPANISH
				UKRAINIAN
			}
		`

		// Define operation
		operationSDL := `
			query MyEmployees($criteria: SearchInput!) {
				findEmployees(criteria: $criteria) {
					id
				}
			}
		`

		// Parse schema and operation
		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		operationDoc, report := astparser.ParseGraphqlDocumentString(operationSDL)
		require.False(t, report.HasErrors(), "operation parsing failed")

		// Build JSON schema
		schema, err := BuildJsonSchema(&operationDoc, &definitionDoc)
		require.NoError(t, err)

		// Serialize schema to JSON
		data, err := json.MarshalIndent(schema, "", "  ")
		require.NoError(t, err)

		// Define expected JSON schema
		expectedJSON := `{
  "additionalProperties": false,
  "properties": {
    "criteria": {
      "additionalProperties": false,
      "properties": {
        "name": {
          "type": [
            "string",
            "null"
          ]
        },
        "nested": {
          "additionalProperties": false,
          "properties": {
            "hasChildren": {
              "type": [
                "boolean",
                "null"
              ]
            },
            "maritalStatus": {
              "enum": [
                "MARRIED",
                "ENGAGED",
                null
              ],
              "type": [
                "string",
                "null"
              ]
            },
            "nationality": {
              "enum": [
                "AMERICAN",
                "DUTCH",
                "ENGLISH",
                "GERMAN",
                "INDIAN",
                "SPANISH",
                "UKRAINIAN"
              ],
              "type": "string"
            }
          },
          "required": [
            "nationality"
          ],
          "type": "object"
        }
      },
      "required": [
        "nested"
      ],
      "type": "object"
    }
  },
  "required": [
    "criteria"
  ],
  "type": "object"
}`

		// Compare actual JSON with expected JSON
		assert.JSONEq(t, expectedJSON, string(data), "JSON schema does not match expected structure")
	})

	t.Run("query with default values", func(t *testing.T) {
		// Define schema with default values
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}
			
			type Query {
				getItems(filter: FilterInput): [Item]
			}
			
			type Item {
				id: ID
				name: String
			}
			
			input FilterInput {
				limit: Int = 10
				includeDeleted: Boolean = false
				status: Status = ACTIVE
			}
			
			enum Status {
				ACTIVE
				PENDING
				DELETED
			}
		`

		// Define operation
		operationSDL := `
			query GetItems($filter: FilterInput = {limit: 5}) {
				getItems(filter: $filter) {
					id
				}
			}
		`

		// Parse schema and operation
		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		operationDoc, report := astparser.ParseGraphqlDocumentString(operationSDL)
		require.False(t, report.HasErrors(), "operation parsing failed")

		// Build JSON schema
		schema, err := BuildJsonSchema(&operationDoc, &definitionDoc)
		require.NoError(t, err)

		// Serialize schema to JSON
		data, err := json.MarshalIndent(schema, "", "  ")
		require.NoError(t, err)

		// Verify schema structure
		var parsed map[string]any
		err = json.Unmarshal(data, &parsed)
		require.NoError(t, err)

		// Verify filter property with default values
		properties := parsed["properties"].(map[string]any)
		filter := properties["filter"].(map[string]any)

		// Verify top-level default value
		assert.Equal(t, map[string]any{"limit": float64(5)}, filter["default"])

		// Verify filter properties
		filterProps := filter["properties"].(map[string]any)

		// Verify input object default values
		limit := filterProps["limit"].(map[string]any)
		assert.Equal(t, float64(10), limit["default"])

		includeDeleted := filterProps["includeDeleted"].(map[string]any)
		assert.Equal(t, false, includeDeleted["default"])

		status := filterProps["status"].(map[string]any)
		assert.Equal(t, "ACTIVE", status["default"])
	})

	t.Run("query with scalar arguments", func(t *testing.T) {
		// Define schema with scalar arguments
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}
			
			type Query {
				getUser(id: ID!, includeProfile: Boolean): User
			}
			
			type User {
				id: ID!
				name: String
				age: Int
				rating: Float
				active: Boolean
			}
		`

		// Define operation
		operationSDL := `
			query GetUser($id: ID!, $includeProfile: Boolean = true, $age: Int, $rating: Float, $name: String) {
				getUser(id: $id, includeProfile: $includeProfile) {
					id
					name
					age
				}
			}
		`

		// Parse schema and operation
		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		operationDoc, report := astparser.ParseGraphqlDocumentString(operationSDL)
		require.False(t, report.HasErrors(), "operation parsing failed")

		// Build JSON schema
		schema, err := BuildJsonSchema(&operationDoc, &definitionDoc)
		require.NoError(t, err)

		// Serialize schema to JSON
		data, err := json.MarshalIndent(schema, "", "  ")
		require.NoError(t, err)

		// Verify schema structure
		var parsed map[string]any
		err = json.Unmarshal(data, &parsed)
		require.NoError(t, err)

		// Verify top-level structure
		assert.Equal(t, "object", parsed["type"])
		properties := parsed["properties"].(map[string]any)

		// Verify required fields
		required := parsed["required"].([]any)
		assert.Contains(t, required, "id")

		// Verify ID property
		id, ok := properties["id"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "string", id["type"])

		// Nullable scalars serialize "type" as the JSON Schema 2020-12 two-element
		// array [<primary>, "null"].

		// Verify includeProfile property
		includeProfile, ok := properties["includeProfile"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, []any{"boolean", "null"}, includeProfile["type"])
		assert.Equal(t, true, includeProfile["default"])

		// Verify age property
		age, ok := properties["age"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, []any{"integer", "null"}, age["type"])

		// Verify rating property
		rating, ok := properties["rating"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, []any{"number", "null"}, rating["type"])

		// Verify name property
		name, ok := properties["name"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, []any{"string", "null"}, name["type"])
	})

	t.Run("operation with field descriptions", func(t *testing.T) {
		// Define schema with field descriptions
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}
			
			type Query {
				"""Description for getUser field"""
				getUser(id: ID!): User
				
				"""Description for findUsers field"""
				findUsers(filter: UserFilter): [User]
			}
			
			type User {
				id: ID!
				name: String
			}
			
			input UserFilter {
				name: String
				age: Int
			}
		`

		// Define operation
		operationSDL := `
			query GetUserInfo($id: ID!, $filter: UserFilter) {
				getUser(id: $id) {
					id
					name
				}
				findUsers(filter: $filter) {
					id
				}
			}
		`

		// Parse schema and operation
		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		operationDoc, report := astparser.ParseGraphqlDocumentString(operationSDL)
		require.False(t, report.HasErrors(), "operation parsing failed")

		// Build JSON schema
		schema, err := BuildJsonSchema(&operationDoc, &definitionDoc)
		require.NoError(t, err)

		// Verify schema root description contains field descriptions
		assert.Contains(t, schema.Description, "Description for getUser field")
		assert.Contains(t, schema.Description, "Description for findUsers field")
	})

	t.Run("error handling for undefined types", func(t *testing.T) {
		// Schema missing SearchInput definition
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}
			
			type Query {
				search(input: SearchInput): String
			}
		`

		// Operation using SearchInput
		operationSDL := `
			query Search($input: SearchInput) {
				search(input: $input)
			}
		`

		// Parse schema and operation
		definitionDoc, report1 := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report1.HasErrors(), "operation parsing failed")

		operationDoc, report2 := astparser.ParseGraphqlDocumentString(operationSDL)
		require.False(t, report2.HasErrors(), "operation parsing failed")

		// Build should return error because type is not defined
		builder := NewVariablesSchemaBuilder(&operationDoc, &definitionDoc)

		// Try to build schema for operation with undefined type
		_, err := builder.Build()
		assert.Error(t, err)
	})

	t.Run("comprehensive test for required arguments", func(t *testing.T) {
		// Define schema with various required and optional fields
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}
			
			type Query {
				search(requiredArg: String!, optionalArg: Int): SearchResult
			}
			
			type SearchResult {
				id: ID!
			}
			
			input RequiredArgsInput {
				requiredField: String!
				optionalField: Float
				requiredNestedInput: RequiredNestedInput!
				optionalNestedInput: OptionalNestedInput
			}
			
			input RequiredNestedInput {
				requiredInnerField: Boolean!
				optionalInnerField: String
			}
			
			input OptionalNestedInput {
				innerField: Int
			}
		`

		// Define operation
		operationSDL := `
			query Search(
				$requiredArg: String!, 
				$optionalArg: Int, 
				$requiredInput: RequiredArgsInput!, 
				$optionalInput: RequiredArgsInput
			) {
				search(requiredArg: $requiredArg, optionalArg: $optionalArg)
			}
		`

		// Parse schema and operation
		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		operationDoc, report := astparser.ParseGraphqlDocumentString(operationSDL)
		require.False(t, report.HasErrors(), "operation parsing failed")

		// Build JSON schema
		schema, err := BuildJsonSchema(&operationDoc, &definitionDoc)
		require.NoError(t, err)

		// Serialize schema to JSON
		data, err := json.MarshalIndent(schema, "", "  ")
		require.NoError(t, err)

		// Verify schema structure
		var parsed map[string]any
		err = json.Unmarshal(data, &parsed)
		require.NoError(t, err)

		// Verify top-level required fields
		required, ok := parsed["required"].([]any)
		require.True(t, ok)
		assert.Contains(t, required, "requiredArg")
		assert.Contains(t, required, "requiredInput")
		assert.NotContains(t, required, "optionalArg")
		assert.NotContains(t, required, "optionalInput")

		// Verify properties
		properties := parsed["properties"].(map[string]any)

		// Check required input structure
		requiredInput := properties["requiredInput"].(map[string]any)
		assert.Equal(t, "object", requiredInput["type"])

		// Check required fields within input
		inputRequired := requiredInput["required"].([]any)
		assert.Contains(t, inputRequired, "requiredField")
		assert.Contains(t, inputRequired, "requiredNestedInput")
		assert.NotContains(t, inputRequired, "optionalField")
		assert.NotContains(t, inputRequired, "optionalNestedInput")

		// Check nested input structure
		inputProperties := requiredInput["properties"].(map[string]any)
		requiredNestedInput := inputProperties["requiredNestedInput"].(map[string]any)
		assert.Equal(t, "object", requiredNestedInput["type"])

		// Check required fields within nested input
		nestedRequired := requiredNestedInput["required"].([]any)
		assert.Contains(t, nestedRequired, "requiredInnerField")
		assert.NotContains(t, nestedRequired, "optionalInnerField")
	})

	t.Run("deeply nested types with mixed requirements", func(t *testing.T) {
		// Define schema with deeply nested types
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}
			
			type Query {
				complexSearch(input: Level1Input): SearchResult
			}
			
			type SearchResult {
				id: ID!
			}
			
			"""Level 1 input description"""
			input Level1Input {
				field1: String
				nested: Level2Input!
				optionalArray: [String]
				requiredArray: [Int]!
			}
			
			"""Level 2 input description"""
			input Level2Input {
				field2: Boolean
				deeper: Level3Input!
				arrayOfObjects: [Level3Input]
			}
			
			"""Level 3 input description"""
			input Level3Input {
				field3: Float
				enumField: DeepEnum!
				arrayOfArrays: [[String!]!]
			}
			
			enum DeepEnum {
				OPTION_1
				OPTION_2
				OPTION_3
			}
		`

		// Define operation
		operationSDL := `
			query DeepSearch($input: Level1Input!) {
				complexSearch(input: $input)
			}
		`

		// Parse schema and operation
		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		operationDoc, report := astparser.ParseGraphqlDocumentString(operationSDL)
		require.False(t, report.HasErrors(), "operation parsing failed")

		// Build JSON schema
		schema, err := BuildJsonSchema(&operationDoc, &definitionDoc)
		require.NoError(t, err)

		// Serialize schema to JSON
		data, err := json.MarshalIndent(schema, "", "  ")
		require.NoError(t, err)

		// Define expected JSON schema
		expectedJSON := `{
  "additionalProperties": false,
  "properties": {
    "input": {
      "additionalProperties": false,
      "description": "Level 1 input description",
      "properties": {
        "field1": {
          "type": [
            "string",
            "null"
          ]
        },
        "nested": {
          "additionalProperties": false,
          "description": "Level 2 input description",
          "properties": {
            "arrayOfObjects": {
              "items": {
                "additionalProperties": false,
                "description": "Level 3 input description",
                "properties": {
                  "arrayOfArrays": {
                    "items": {
                      "items": {
                        "type": "string"
                      },
                      "type": "array"
                    },
                    "type": [
                      "array",
                      "null"
                    ]
                  },
                  "enumField": {
                    "enum": [
                      "OPTION_1",
                      "OPTION_2",
                      "OPTION_3"
                    ],
                    "type": "string"
                  },
                  "field3": {
                    "type": [
                      "number",
                      "null"
                    ]
                  }
                },
                "required": [
                  "enumField"
                ],
                "type": [
                  "object",
                  "null"
                ]
              },
              "type": [
                "array",
                "null"
              ]
            },
            "deeper": {
              "additionalProperties": false,
              "description": "Level 3 input description",
              "properties": {
                "arrayOfArrays": {
                  "items": {
                    "items": {
                      "type": "string"
                    },
                    "type": "array"
                  },
                  "type": [
                    "array",
                    "null"
                  ]
                },
                "enumField": {
                  "enum": [
                    "OPTION_1",
                    "OPTION_2",
                    "OPTION_3"
                  ],
                  "type": "string"
                },
                "field3": {
                  "type": [
                    "number",
                    "null"
                  ]
                }
              },
              "required": [
                "enumField"
              ],
              "type": "object"
            },
            "field2": {
              "type": [
                "boolean",
                "null"
              ]
            }
          },
          "required": [
            "deeper"
          ],
          "type": "object"
        },
        "optionalArray": {
          "items": {
            "type": [
              "string",
              "null"
            ]
          },
          "type": [
            "array",
            "null"
          ]
        },
        "requiredArray": {
          "items": {
            "type": [
              "integer",
              "null"
            ]
          },
          "type": "array"
        }
      },
      "required": [
        "nested",
        "requiredArray"
      ],
      "type": "object"
    }
  },
  "required": [
    "input"
  ],
  "type": "object"
}`

		// Compare actual JSON with expected JSON
		assert.JSONEq(t, expectedJSON, string(data), "JSON schema does not match expected structure")
	})

	t.Run("recursive types with default recursion depth", func(t *testing.T) {
		// Define schema with recursive input type
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}
			
			type Query {
				processNode(node: RecursiveNode): Boolean
			}
			
			"""A node that can contain child nodes of the same type"""
			input RecursiveNode {
				id: ID!
				name: String
				value: Int
				children: [RecursiveNode]
				parent: RecursiveNode
			}
		`

		// Define operation
		operationSDL := `
			query ProcessTree($node: RecursiveNode!) {
				processNode(node: $node)
			}
		`

		// Parse schema and operation
		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		operationDoc, report := astparser.ParseGraphqlDocumentString(operationSDL)
		require.False(t, report.HasErrors(), "operation parsing failed")

		// Build JSON schema with default recursion depth (1)
		schema, err := BuildJsonSchema(&operationDoc, &definitionDoc)
		require.NoError(t, err)

		// Verify we got a valid schema back
		require.NotNil(t, schema, "Should have a valid schema")

		// Serialize to JSON to check it's valid
		data, err := json.Marshal(schema)
		require.NoError(t, err)
		require.NotEmpty(t, data, "JSON serialization should not be empty")

		// Parse the JSON to verify it's valid
		var result any
		err = json.Unmarshal(data, &result)
		require.NoError(t, err, "Schema should be valid JSON")

		// Basic structure checks
		jsonMap, ok := result.(map[string]any)
		require.True(t, ok, "Schema should be a JSON object")

		// Check top-level fields
		assert.Equal(t, "object", jsonMap["type"], "Schema should be an object type")
		assert.Contains(t, jsonMap, "properties", "Schema should have properties")

		// Log the schema for debugging
		t.Logf("Default recursion depth schema: %v", string(data))
	})

	t.Run("recursive types are emitted via $ref and $defs", func(t *testing.T) {
		// Define schema with recursive input type
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}

			type Query {
				processNode(node: RecursiveNode): Boolean
			}

			"""A node that can contain child nodes of the same type"""
			input RecursiveNode {
				id: ID!
				name: String
				value: Int
				children: [RecursiveNode]
			}
		`

		// Define operation
		operationSDL := `
			query ProcessTree($node: RecursiveNode!) {
				processNode(node: $node)
			}
		`

		// Parse schema and operation
		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		operationDoc, report := astparser.ParseGraphqlDocumentString(operationSDL)
		require.False(t, report.HasErrors(), "operation parsing failed")

		schema, err := BuildJsonSchema(&operationDoc, &definitionDoc)
		require.NoError(t, err)

		data, err := json.Marshal(schema)
		require.NoError(t, err)

		// The recursive type is defined once under "$defs" and referenced via "$ref".
		require.Contains(t, schema.Defs, "RecursiveNode",
			"recursive input type should be defined under $defs")
		assert.Contains(t, string(data), `"$ref":"#/$defs/RecursiveNode"`,
			"recursive input type should be referenced via $ref")
	})

	t.Run("query with two nested arguments", func(t *testing.T) {
		// Define schema with two complex input types
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}
			
			type Query {
				searchUsers(userFilter: UserFilter, orderBy: OrderByInput): [User]
			}
			
			type User {
				id: ID!
				name: String
				email: String
			}
			
			"""Input for filtering users"""
			input UserFilter {
				nameContains: String
				emailDomain: String
				status: UserStatus
				metadata: MetadataInput
			}
			
			"""Input for ordering results"""
			input OrderByInput {
				field: OrderableField!
				direction: SortDirection!
				nullsPosition: NullsPosition
			}
			
			input MetadataInput {
				tags: [String!]
				createdAfter: String
				createdBefore: String
			}
			
			enum UserStatus {
				ACTIVE
				INACTIVE
				PENDING
			}
			
			enum OrderableField {
				NAME
				EMAIL
				CREATED_AT
				UPDATED_AT
			}
			
			enum SortDirection {
				ASC
				DESC
			}
			
			enum NullsPosition {
				FIRST
				LAST
			}
		`

		// Define operation using both input types
		operationSDL := `
			query FindUsers($filter: UserFilter!, $order: OrderByInput!) {
				searchUsers(userFilter: $filter, orderBy: $order) {
					id
					name
					email
				}
			}
		`

		// Parse schema and operation
		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		operationDoc, report := astparser.ParseGraphqlDocumentString(operationSDL)
		require.False(t, report.HasErrors(), "operation parsing failed")

		// Build JSON schema
		schema, err := BuildJsonSchema(&operationDoc, &definitionDoc)
		require.NoError(t, err)

		// Serialize schema to JSON
		data, err := json.MarshalIndent(schema, "", "  ")
		require.NoError(t, err)

		// Verify schema structure
		var parsed map[string]any
		err = json.Unmarshal(data, &parsed)
		require.NoError(t, err)

		// Verify top-level structure
		assert.Equal(t, "object", parsed["type"])

		// Verify both inputs are required
		required, ok := parsed["required"].([]any)
		require.True(t, ok)
		assert.Contains(t, required, "filter")
		assert.Contains(t, required, "order")

		// Verify properties exist
		properties := parsed["properties"].(map[string]any)
		assert.Contains(t, properties, "filter")
		assert.Contains(t, properties, "order")

		// Verify filter structure
		filter := properties["filter"].(map[string]any)
		assert.Equal(t, "object", filter["type"])
		assert.Equal(t, "Input for filtering users", filter["description"])
		assert.Contains(t, filter["properties"], "metadata")

		// Verify order structure
		order := properties["order"].(map[string]any)
		assert.Equal(t, "object", order["type"])
		assert.Equal(t, "Input for ordering results", order["description"])

		// Verify order required fields
		orderRequired := order["required"].([]any)
		assert.Contains(t, orderRequired, "field")
		assert.Contains(t, orderRequired, "direction")

		// Verify enum values
		orderProps := order["properties"].(map[string]any)
		direction := orderProps["direction"].(map[string]any)
		directionEnum := direction["enum"].([]any)
		assert.ElementsMatch(t, []any{"ASC", "DESC"}, directionEnum)
	})

	t.Run("mutually recursive types", func(t *testing.T) {
		// Define schema with mutually recursive input types
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}
			
			type Query {
				processA(a: TypeA): Boolean
			}
			
			input TypeA {
				id: ID!
				name: String
				b: TypeB
			}
			
			input TypeB {
				id: ID!
				description: String
				a: TypeA
			}
		`

		// Define operation
		operationSDL := `
			query ProcessA($a: TypeA!) {
				processA(a: $a)
			}
		`

		// Parse schema and operation
		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		operationDoc, report := astparser.ParseGraphqlDocumentString(operationSDL)
		require.False(t, report.HasErrors(), "operation parsing failed")

		// Build JSON schema
		schema, err := BuildJsonSchema(&operationDoc, &definitionDoc)
		require.NoError(t, err)

		// Serialize schema to JSON
		data, err := json.MarshalIndent(schema, "", "  ")
		require.NoError(t, err)

		// Mutually recursive input types (TypeA <-> TypeB) are emitted once each
		// under "$defs" and referenced via "$ref", so nesting is permitted to any depth.
		expectedJSON := `{
  "$defs": {
    "TypeA": {
      "additionalProperties": false,
      "properties": {
        "b": {
          "anyOf": [
            {
              "$ref": "#/$defs/TypeB"
            },
            {
              "type": "null"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": [
            "string",
            "null"
          ]
        }
      },
      "required": [
        "id"
      ],
      "type": "object"
    },
    "TypeB": {
      "additionalProperties": false,
      "properties": {
        "a": {
          "anyOf": [
            {
              "$ref": "#/$defs/TypeA"
            },
            {
              "type": "null"
            }
          ]
        },
        "description": {
          "type": [
            "string",
            "null"
          ]
        },
        "id": {
          "type": "string"
        }
      },
      "required": [
        "id"
      ],
      "type": "object"
    }
  },
  "additionalProperties": false,
  "properties": {
    "a": {
      "$ref": "#/$defs/TypeA"
    }
  },
  "required": [
    "a"
  ],
  "type": "object"
}`

		// Compare actual JSON with expected JSON
		assert.JSONEq(t, expectedJSON, string(data), "JSON schema does not match expected structure")
	})

	t.Run("correctly handles nullable and non-nullable fields", func(t *testing.T) {
		// Define schema with a mix of nullable and non-nullable fields
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}
			
			type Query {
				findUser(input: UserInput): User
			}
			
			type User {
				id: ID!
				name: String
			}
			
			input UserInput {
				id: ID
				name: String!
				age: Int
				tags: [String]
				requiredTags: [String]!
				nonNullTags: [String!]
				requiredNonNullTags: [String!]!
				nested: NestedInput
				requiredNested: NestedInput!
			}
			
			input NestedInput {
				field: String
				requiredField: String!
			}
		`

		// Define operation
		operationSDL := `
			query FindUser($input: UserInput) {
				findUser(input: $input) {
					id
					name
				}
			}
		`

		// Parse schema and operation
		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		operationDoc, report := astparser.ParseGraphqlDocumentString(operationSDL)
		require.False(t, report.HasErrors(), "operation parsing failed")

		// Build JSON schema
		schema, err := BuildJsonSchema(&operationDoc, &definitionDoc)
		require.NoError(t, err)

		// Serialize schema to JSON
		data, err := json.MarshalIndent(schema, "", "  ")
		require.NoError(t, err)

		// Define expected JSON schema
		expectedJSON := `{
  "additionalProperties": false,
  "properties": {
    "input": {
      "additionalProperties": false,
      "properties": {
        "age": {
          "type": [
            "integer",
            "null"
          ]
        },
        "id": {
          "type": [
            "string",
            "null"
          ]
        },
        "name": {
          "type": "string"
        },
        "nested": {
          "additionalProperties": false,
          "properties": {
            "field": {
              "type": [
                "string",
                "null"
              ]
            },
            "requiredField": {
              "type": "string"
            }
          },
          "required": [
            "requiredField"
          ],
          "type": [
            "object",
            "null"
          ]
        },
        "nonNullTags": {
          "items": {
            "type": "string"
          },
          "type": [
            "array",
            "null"
          ]
        },
        "requiredNested": {
          "additionalProperties": false,
          "properties": {
            "field": {
              "type": [
                "string",
                "null"
              ]
            },
            "requiredField": {
              "type": "string"
            }
          },
          "required": [
            "requiredField"
          ],
          "type": "object"
        },
        "requiredNonNullTags": {
          "items": {
            "type": "string"
          },
          "type": "array"
        },
        "requiredTags": {
          "items": {
            "type": [
              "string",
              "null"
            ]
          },
          "type": "array"
        },
        "tags": {
          "items": {
            "type": [
              "string",
              "null"
            ]
          },
          "type": [
            "array",
            "null"
          ]
        }
      },
      "required": [
        "name",
        "requiredTags",
        "requiredNonNullTags",
        "requiredNested"
      ],
      "type": "object"
    }
  },
  "type": "object"
}`

		// Compare actual JSON with expected JSON
		assert.JSONEq(t, expectedJSON, string(data), "JSON schema does not match expected structure")
	})

	t.Run("root schema is always a non-nullable object", func(t *testing.T) {
		// Define schema with required and optional arguments
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}
			
			type Query {
				findUser(id: ID!, name: String): User
			}
			
			type User {
				id: ID!
				name: String
			}
		`

		// Test case 1: Operation with required argument
		operationWithRequired := `
			query GetUser($id: ID!) {
				findUser(id: $id) {
					id
					name
				}
			}
		`

		// Test case 2: Operation with only optional arguments
		operationOptionalOnly := `
			query GetUserByName($name: String) {
				findUser(id: "fixed-id", name: $name) {
					id
					name
				}
			}
		`

		// Parse schema
		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		// Parse and test operation with required argument
		operationDoc1, report := astparser.ParseGraphqlDocumentString(operationWithRequired)
		require.False(t, report.HasErrors(), "operation parsing failed")

		schema1, err := BuildJsonSchema(&operationDoc1, &definitionDoc)
		require.NoError(t, err)

		// Convert to JSON to check nullable field
		data1, err := json.MarshalIndent(schema1, "", "  ")
		require.NoError(t, err)

		// Define expected JSON schema for required argument case
		expectedJSON1 := `{
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string"
    }
  },
  "required": [
    "id"
  ],
  "type": "object"
}`

		// Compare actual JSON with expected JSON
		assert.JSONEq(t, expectedJSON1, string(data1), "Required argument schema does not match expected structure")

		// Parse and test operation with only optional arguments
		operationDoc2, report := astparser.ParseGraphqlDocumentString(operationOptionalOnly)
		require.False(t, report.HasErrors(), "operation parsing failed")

		schema2, err := BuildJsonSchema(&operationDoc2, &definitionDoc)
		require.NoError(t, err)

		// Convert to JSON to check nullable field
		data2, err := json.MarshalIndent(schema2, "", "  ")
		require.NoError(t, err)

		// Define expected JSON schema for optional argument case.
		// Even when every variable is optional, the root variables object stays a
		// non-nullable "object": the container is omitted or present, never the
		// JSON literal null. Only the individual optional fields are nullable.
		expectedJSON2 := `{
  "additionalProperties": false,
  "properties": {
    "name": {
      "type": [
        "string",
        "null"
      ]
    }
  },
  "type": "object"
}`

		// Compare actual JSON with expected JSON
		assert.JSONEq(t, expectedJSON2, string(data2), "Optional argument schema does not match expected structure")
	})

	t.Run("top-level object fields are not nullable", func(t *testing.T) {
		// Define schema
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}
			
			type Query {
				findEmployees(criteria: SearchInput): [Employee]
			}
			
			type Employee {
				id: ID!
				isAvailable: Boolean
				details: EmployeeDetails
			}
			
			type EmployeeDetails {
				forename: String
				nationality: String
			}
			
			input SearchInput {
				name: String
				department: String
			}
		`

		// Define operation
		operationSDL := `
			query MyEmployees($criteria: SearchInput) {
				findEmployees(criteria: $criteria) {
					id
					isAvailable
					details {
						forename
						nationality
					}
				}
			}
		`

		// Parse schema and operation
		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		operationDoc, report := astparser.ParseGraphqlDocumentString(operationSDL)
		require.False(t, report.HasErrors(), "operation parsing failed")

		// Build JSON schema
		schema, err := BuildJsonSchema(&operationDoc, &definitionDoc)
		require.NoError(t, err)

		// Serialize schema to JSON to check what's exported
		data, err := json.MarshalIndent(schema, "", "  ")
		require.NoError(t, err)

		// Define expected JSON schema
		expectedJSON := `{
  "additionalProperties": false,
  "properties": {
    "criteria": {
      "additionalProperties": false,
      "properties": {
        "department": {
          "type": [
            "string",
            "null"
          ]
        },
        "name": {
          "type": [
            "string",
            "null"
          ]
        }
      },
      "type": "object"
    }
  },
  "type": "object"
}`

		// Compare actual JSON with expected JSON
		assert.JSONEq(t, expectedJSON, string(data), "JSON schema does not match expected structure")
	})

	t.Run("custom scalar variables with descriptions default to string type", func(t *testing.T) {
		// Define schema with custom scalar types
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}
			
			"""ISO-8601 date time format"""
			scalar DateTime
			
			"""JSON object represented as string"""
			scalar JSON
			
			type Query {
				searchEvents(from: DateTime, filter: JSON): [Event]
			}
			
			type Event {
				id: ID!
				timestamp: DateTime
				data: JSON
			}
		`

		// Define operation using custom scalar types
		operationSDL := `
			query SearchEvents($from: DateTime, $filter: JSON) {
				searchEvents(from: $from, filter: $filter) {
					id
					timestamp
					data
				}
			}
		`

		// Parse schema and operation
		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		operationDoc, report := astparser.ParseGraphqlDocumentString(operationSDL)
		require.False(t, report.HasErrors(), "operation parsing failed")

		// Build JSON schema
		schema, err := BuildJsonSchema(&operationDoc, &definitionDoc)
		require.NoError(t, err)

		// Serialize schema to JSON
		data, err := json.MarshalIndent(schema, "", "  ")
		require.NoError(t, err)

		// Define expected JSON schema
		expectedJSON := `{
  "additionalProperties": false,
  "properties": {
    "filter": {
      "description": "JSON object represented as string",
      "type": ["string", "null"]
    },
    "from": {
      "description": "ISO-8601 date time format",
      "type": ["string", "null"]
    }
  },
  "type": "object"
}`

		// Compare actual JSON with expected JSON
		assert.JSONEq(t, expectedJSON, string(data), "JSON schema does not match expected structure")
	})

	t.Run("variable with description propagated to JSON schema", func(t *testing.T) {
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}

			type Query {
				employee(id: ID!): Employee
			}

			type Employee {
				id: ID!
				name: String
			}
		`

		operationSDL := `
			"""
			Get an employee by their ID
			"""
			query FindEmployee(
				"The unique employee identifier"
				$id: ID!
			) {
				employee(id: $id) {
					id
					name
				}
			}
		`

		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		operationDoc, report := astparser.ParseGraphqlDocumentString(operationSDL)
		require.False(t, report.HasErrors(), "operation parsing failed")

		schema, err := BuildJsonSchema(&operationDoc, &definitionDoc)
		require.NoError(t, err)

		data, err := json.MarshalIndent(schema, "", "  ")
		require.NoError(t, err)

		expectedJSON := `{
  "additionalProperties": false,
  "properties": {
    "id": {
      "description": "The unique employee identifier",
      "type": "string"
    }
  },
  "required": [
    "id"
  ],
  "type": "object"
}`

		assert.JSONEq(t, expectedJSON, string(data))
	})

	t.Run("query with custom scalar variables defaults to string type", func(t *testing.T) {
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}
			
			"""An opaque pagination cursor"""
			scalar Cursor
			
			type Query {
				items(after: Cursor, first: Int!): String
			}
		`
		operation := `
			query Items($after: Cursor, $first: Int!) {
				items(after: $after, first: $first)
			}
		`
		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		operationDoc, report := astparser.ParseGraphqlDocumentString(operation)
		require.False(t, report.HasErrors(), "operation parsing failed")

		schema, err := BuildJsonSchema(&operationDoc, &definitionDoc)
		require.NoError(t, err)

		actualJSON, err := json.Marshal(schema)
		require.NoError(t, err)

		expectedJSON := `{
  "additionalProperties": false,
  "properties": {
    "after": {
      "description": "An opaque pagination cursor",
      "type": [
        "string",
        "null"
      ]
    },
    "first": {
      "type": "integer"
    }
  },
  "required": [
    "first"
  ],
  "type": "object"
}`

		assert.JSONEq(t, expectedJSON, string(actualJSON))
	})

	t.Run("input object field with custom scalar defaults to string type", func(t *testing.T) {
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}
			
			scalar Cursor
			
			input Pagination {
				after: Cursor
				first: Int!
			}
			
			type Query {
				items(page: Pagination!): String
			}
		`
		operation := `
			query Items($page: Pagination!) {
				items(page: $page)
			}
		`
		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		operationDoc, report := astparser.ParseGraphqlDocumentString(operation)
		require.False(t, report.HasErrors(), "operation parsing failed")

		schema, err := BuildJsonSchema(&operationDoc, &definitionDoc)
		require.NoError(t, err)

		actualJSON, err := json.Marshal(schema)
		require.NoError(t, err)

		expectedJSON := `{
  "additionalProperties": false,
  "properties": {
    "page": {
      "additionalProperties": false,
      "properties": {
        "after": {
          "type": [
            "string",
            "null"
          ]
        },
        "first": {
          "type": "integer"
        }
      },
      "required": [
        "first"
      ],
      "type": "object"
    }
  },
  "required": [
    "page"
  ],
  "type": "object"
}`

		assert.JSONEq(t, expectedJSON, string(actualJSON))
	})

	t.Run("overridden scalar emits the mapped schema and unmapped scalars keep the string default", func(t *testing.T) {
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}
			
			scalar JSON
			scalar Cursor
			
			type Query {
				search(filter: JSON!, after: Cursor, cursor: Cursor!) : String
			}
		`
		operation := `
			query Search($filter: JSON!, $after: Cursor, $cursor: Cursor!) {
				search(filter: $filter, after: $after, cursor: $cursor)
			}
		`
		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		operationDoc, report := astparser.ParseGraphqlDocumentString(operation)
		require.False(t, report.HasErrors(), "operation parsing failed")

		overrides := map[string]*JsonSchema{
			"JSON": {Type: TypeObject, Description: "Arbitrary JSON object"},
		}

		schema, err := BuildJsonSchema(&operationDoc, &definitionDoc, WithScalarSchemas(overrides))
		require.NoError(t, err)

		actualJSON, err := json.Marshal(schema)
		require.NoError(t, err)

		// - JSON! is mapped to object and non-null context strips the null union
		// - after/cursor prove per-use cloning: same scalar, different nullability
		expectedJSON := `{
  "additionalProperties": false,
  "properties": {
    "after": {
      "type": [
        "string",
        "null"
      ]
    },
    "cursor": {
      "type": "string"
    },
    "filter": {
      "description": "Arbitrary JSON object",
      "type": "object"
    }
  },
  "required": [
    "filter",
    "cursor"
  ],
  "type": "object"
}`
		assert.JSONEq(t, expectedJSON, string(actualJSON))
	})

	// Guards the Clone-per-use invariant: if the override branch stops cloning,
	// both variables below alias one *JsonSchema and the last-processed
	// variable's nullability overwrites the first, failing this test.
	t.Run("same overridden scalar at two nullabilities yields independent schemas", func(t *testing.T) {
		// The override type is deliberately non-object: object-typed top-level
		// variables are unconditionally forced non-nullable elsewhere (see
		// EnterVariableDefinition), which would mask the nullability leak this
		// test exists to catch.
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}
			
			scalar BigInt
			
			type Query {
				search(filter: BigInt!, meta: BigInt) : String
			}
		`
		operation := `
			query Search($filter: BigInt!, $meta: BigInt) {
				search(filter: $filter, meta: $meta)
			}
		`
		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		operationDoc, report := astparser.ParseGraphqlDocumentString(operation)
		require.False(t, report.HasErrors(), "operation parsing failed")

		overrides := map[string]*JsonSchema{
			"BigInt": {Type: TypeInteger},
		}

		schema, err := BuildJsonSchema(&operationDoc, &definitionDoc, WithScalarSchemas(overrides))
		require.NoError(t, err)

		actualJSON, err := json.Marshal(schema)
		require.NoError(t, err)

		// Both variables resolve the same override map entry. Without cloning
		// per use, the second-processed variable's Nullable mutation would leak
		// into the first via the shared *JsonSchema pointer.
		expectedJSON := `{
  "additionalProperties": false,
  "properties": {
    "filter": {
      "type": "integer"
    },
    "meta": {
      "type": [
        "integer",
        "null"
      ]
    }
  },
  "required": [
    "filter"
  ],
  "type": "object"
}`
		assert.JSONEq(t, expectedJSON, string(actualJSON))
	})

	t.Run("DefaultedScalars reports unmapped custom scalars once, sorted", func(t *testing.T) {
		schemaSDL := scalarDefinitions + `
			schema {
				query: Query
			}
			
			scalar JSON
			scalar Cursor
			scalar BigInt
			
			type Query {
				search(filter: JSON!, after: Cursor, before: Cursor, size: BigInt) : String
			}
		`
		operation := `
			query Search($filter: JSON!, $after: Cursor, $before: Cursor, $size: BigInt) {
				search(filter: $filter, after: $after, before: $before, size: $size)
			}
		`
		definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
		require.False(t, report.HasErrors(), "schema parsing failed")

		operationDoc, report := astparser.ParseGraphqlDocumentString(operation)
		require.False(t, report.HasErrors(), "operation parsing failed")

		builder := NewVariablesSchemaBuilder(&operationDoc, &definitionDoc, WithScalarSchemas(map[string]*JsonSchema{
			"JSON": {Type: TypeObject},
		}))
		_, err := builder.Build()
		require.NoError(t, err)

		// JSON is mapped -> not reported; Cursor used twice -> reported once
		assert.Equal(t, []string{"BigInt", "Cursor"}, builder.DefaultedScalars())
	})
}
