package core

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/astjson"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

func TestMapFieldArguments(t *testing.T) {
	testCases := []struct {
		name       string
		schema     string
		operation  string
		variables  string
		assertions func(t *testing.T, result Arguments)
	}{
		{
			name: "root field arguments with variables are accessible",
			schema: `
				type Query {
					user(id: ID!): User
				}
				type User {
					id: ID!
					name: String!
				}
			`,
			operation: `
				query GetUser($userId: ID!) {
					user(id: $userId) {
						id
						name
					}
				}
			`,
			variables: `{"userId": "123"}`,
			assertions: func(t *testing.T, result Arguments) {
				idArg := result.Get("user", "id")
				require.NotNil(t, idArg, "expected 'id' argument on 'user' field")
				assert.Equal(t, "123", string(idArg.GetStringBytes()))
			},
		},
		{
			name: "root field arguments without variables are accessible",
			schema: `
				type Query {
					user(id: ID!): User
				}
				type User {
					id: ID!
					name: String!
				}
			`,
			operation: `
				query GetUser {
					user(id: "123") {
						id
						name
					}
				}
			`,
			variables: `{}`,
			assertions: func(t *testing.T, result Arguments) {
				idArg := result.Get("user", "id")
				require.NotNil(t, idArg, "expected 'id' argument on 'user' field")
				assert.Equal(t, "123", string(idArg.GetStringBytes()))
			},
		},
		{
			name: "nested field arguments are accessible",
			schema: `
				type Query {
					user(id: ID!): User
				}
				type User {
					id: ID!
					posts(limit: Int!, offset: Int): [Post!]!
				}
				type Post {
					id: ID!
					title: String!
				}
			`,
			operation: `
				query GetUserPosts($userId: ID!, $limit: Int!, $offset: Int) {
					user(id: $userId) {
						id
						posts(limit: $limit, offset: $offset) {
							id
							title
						}
					}
				}
			`,
			variables: `{"userId": "user-1", "limit": 10, "offset": 5}`,
			assertions: func(t *testing.T, result Arguments) {
				// Assert root field argument
				userIdArg := result.Get("user", "id")
				require.NotNil(t, userIdArg)
				assert.Equal(t, "user-1", string(userIdArg.GetStringBytes()))

				// Assert nested field arguments (dot notation path)
				limitArg := result.Get("user.posts", "limit")
				require.NotNil(t, limitArg, "expected 'limit' argument on 'user.posts' field")
				assert.Equal(t, 10, limitArg.GetInt())

				offsetArg := result.Get("user.posts", "offset")
				require.NotNil(t, offsetArg, "expected 'offset' argument on 'user.posts' field")
				assert.Equal(t, 5, offsetArg.GetInt())
			},
		},
		{
			name: "non-existent field returns nil",
			schema: `
				type Query {
					hello: String
				}
			`,
			operation: `
				query {
					hello
				}
			`,
			variables: `{}`,
			assertions: func(t *testing.T, result Arguments) {
				arg := result.Get("hello", "someArg")
				require.Nil(t, arg, "expected nil for non-existent argument")

				arg = result.Get("nonExistent", "arg")
				require.Nil(t, arg, "expected nil for non-existent field")
			},
		},
		{
			name: "multiple root fields with arguments",
			schema: `
				type Query {
					user(id: ID!): User
					post(slug: String!): Post
				}
				type User {
					id: ID!
				}
				type Post {
					slug: String!
				}
			`,
			operation: `
				query GetUserAndPost($userId: ID!, $postSlug: String!) {
					user(id: $userId) {
						id
					}
					post(slug: $postSlug) {
						slug
					}
				}
			`,
			variables: `{"userId": "user-123", "postSlug": "my-post"}`,
			assertions: func(t *testing.T, result Arguments) {
				userIdArg := result.Get("user", "id")
				require.NotNil(t, userIdArg)
				assert.Equal(t, "user-123", string(userIdArg.GetStringBytes()))

				postSlugArg := result.Get("post", "slug")
				require.NotNil(t, postSlugArg)
				assert.Equal(t, "my-post", string(postSlugArg.GetStringBytes()))
			},
		},
		{
			name: "array argument is accessible",
			schema: `
				type Query {
					users(ids: [ID!]!): [User!]!
				}
				type User {
					id: ID!
					name: String!
				}
			`,
			operation: `
				query GetUsers($userIds: [ID!]!) {
					users(ids: $userIds) {
						id
						name
					}
				}
			`,
			variables: `{"userIds": ["user-1", "user-2", "user-3"]}`,
			assertions: func(t *testing.T, result Arguments) {
				idsArg := result.Get("users", "ids")
				require.NotNil(t, idsArg, "expected 'ids' argument on 'users' field")

				// Verify it's an array
				arr := idsArg.GetArray()
				require.Len(t, arr, 3)
				assert.Equal(t, "user-1", string(arr[0].GetStringBytes()))
				assert.Equal(t, "user-2", string(arr[1].GetStringBytes()))
				assert.Equal(t, "user-3", string(arr[2].GetStringBytes()))
			},
		},
		{
			name: "object argument is accessible",
			schema: `
				type Query {
					users(filter: UserFilter!): [User!]!
				}
				input UserFilter {
					name: String
					age: Int
					active: Boolean!
				}
				type User {
					id: ID!
					name: String!
				}
			`,
			operation: `
				query GetUsers($filter: UserFilter!) {
					users(filter: $filter) {
						id
						name
					}
				}
			`,
			variables: `{"filter": {"name": "John", "age": 30, "active": true}}`,
			assertions: func(t *testing.T, result Arguments) {
				filterArg := result.Get("users", "filter")
				require.NotNil(t, filterArg, "expected 'filter' argument on 'users' field")

				// Verify it's an object and access its fields
				obj := filterArg.GetObject()
				require.NotNil(t, obj)

				nameVal := filterArg.Get("name")
				require.NotNil(t, nameVal)
				assert.Equal(t, "John", string(nameVal.GetStringBytes()))

				ageVal := filterArg.Get("age")
				require.NotNil(t, ageVal)
				assert.Equal(t, 30, ageVal.GetInt())

				activeVal := filterArg.Get("active")
				require.NotNil(t, activeVal)
				assert.True(t, activeVal.GetBool())
			},
		},
		{
			name: "aliased fields have unique paths",
			schema: `
				type Query {
					user(id: ID!): User
				}
				type User {
					id: ID!
					name: String!
				}
			`,
			operation: `
				query GetUsers($id1: ID!, $id2: ID!) {
					a: user(id: $id1) {
						id
						name
					}
					b: user(id: $id2) {
						id
						name
					}
				}
			`,
			variables: `{"id1": "user-1", "id2": "user-2"}`,
			assertions: func(t *testing.T, result Arguments) {
				// Access arguments using the alias, not the field name
				aIdArg := result.Get("a", "id")
				require.NotNil(t, aIdArg, "expected 'id' argument on aliased field 'a'")
				assert.Equal(t, "user-1", string(aIdArg.GetStringBytes()))

				bIdArg := result.Get("b", "id")
				require.NotNil(t, bIdArg, "expected 'id' argument on aliased field 'b'")
				assert.Equal(t, "user-2", string(bIdArg.GetStringBytes()))

				// Using the field name should not find the arguments
				userIdArg := result.Get("user", "id")
				assert.Nil(t, userIdArg, "expected nil when using field name instead of alias")
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Parse schema
			schema, report := astparser.ParseGraphqlDocumentString(tc.schema)
			require.False(t, report.HasErrors(), "failed to parse schema")
			err := asttransform.MergeDefinitionWithBaseSchema(&schema)
			require.NoError(t, err)

			// Parse operation
			operation, report := astparser.ParseGraphqlDocumentString(tc.operation)
			require.False(t, report.HasErrors(), "failed to parse operation")

			// Set variables before normalization (like the router does)
			operation.Input.Variables = []byte(tc.variables)

			// Normalize operation (merges provided variables with extracted inline literals)
			rep := &operationreport.Report{}
			norm := astnormalization.NewNormalizer(true, true)
			norm.NormalizeOperation(&operation, &schema, rep)
			require.False(t, rep.HasErrors(), "failed to normalize operation")

			// Use normalized variables (includes both provided and extracted variables)
			vars, err := astjson.ParseBytes(operation.Input.Variables)
			require.NoError(t, err)

			// Call mapFieldArguments
			result := mapFieldArguments(mapFieldArgumentsOpts{
				operation:  &operation,
				definition: &schema,
				vars:       vars,
			})

			// Run assertions
			tc.assertions(t, result)
		})
	}
}

func TestMapFieldArguments_InvalidValueLogsWarning(t *testing.T) {
	// This test verifies that when resolveArgValue fails (e.g., due to an invalid AST value),
	// a warning is logged and the argument is skipped (not added to the result).

	schema := `
		type Query {
			user(id: ID!): User
		}
		type User {
			id: ID!
		}
	`

	operation := `
		query {
			user(id: "123") {
				id
			}
		}
	`

	// Parse schema
	schemaDef, report := astparser.ParseGraphqlDocumentString(schema)
	require.False(t, report.HasErrors(), "failed to parse schema")
	err := asttransform.MergeDefinitionWithBaseSchema(&schemaDef)
	require.NoError(t, err)

	// Parse operation WITHOUT normalization to keep the inline literal
	op, report := astparser.ParseGraphqlDocumentString(operation)
	require.False(t, report.HasErrors(), "failed to parse operation")

	// Corrupt the AST: set an invalid value kind that will cause ValueToJSON to fail
	// Find the argument and set its value to an invalid kind
	for i := range op.Arguments {
		// Set to an invalid/unhandled value kind
		op.Arguments[i].Value.Kind = ast.ValueKind(255) // Invalid kind
	}

	// Set up observed logger to capture warnings
	observedCore, observedLogs := observer.New(zapcore.WarnLevel)
	logger := zap.New(observedCore)

	// Parse empty variables
	vars, err := astjson.ParseBytes([]byte(`{}`))
	require.NoError(t, err)

	// Call mapFieldArguments - should log a warning due to invalid value
	result := mapFieldArguments(mapFieldArgumentsOpts{
		operation:  &op,
		definition: &schemaDef,
		vars:       vars,
		logger:     logger,
	})

	// Verify warning was logged
	logs := observedLogs.All()
	require.Len(t, logs, 1, "expected exactly one warning log")
	assert.Equal(t, "failed to resolve argument value", logs[0].Message)
	assert.Equal(t, zapcore.WarnLevel, logs[0].Level)

	// Verify the argument was skipped (not added to result)
	idArg := result.Get("user", "id")
	assert.Nil(t, idArg, "expected argument to be skipped due to error")
}

func TestMapFieldArguments_InlineLiteralWithoutNormalization(t *testing.T) {
	// This test verifies that inline literal arguments are correctly extracted
	// via getArgValueFromDoc when normalization is skipped.
	// Normally, normalization converts inline literals to variables, but this test
	// exercises the code path for non-variable argument values.

	schema := `
		type Query {
			user(id: ID!, active: Boolean!): User
		}
		type User {
			id: ID!
		}
	`

	operation := `
		query {
			user(id: "inline-123", active: true) {
				id
			}
		}
	`

	// Parse schema
	schemaDef, report := astparser.ParseGraphqlDocumentString(schema)
	require.False(t, report.HasErrors(), "failed to parse schema")
	err := asttransform.MergeDefinitionWithBaseSchema(&schemaDef)
	require.NoError(t, err)

	// Parse operation WITHOUT normalization to keep inline literals as non-variable values
	op, report := astparser.ParseGraphqlDocumentString(operation)
	require.False(t, report.HasErrors(), "failed to parse operation")

	// Parse empty variables (inline values are in the AST, not in variables)
	vars, err := astjson.ParseBytes([]byte(`{}`))
	require.NoError(t, err)

	// Call mapFieldArguments - should extract values via getArgValueFromDoc
	result := mapFieldArguments(mapFieldArgumentsOpts{
		operation:  &op,
		definition: &schemaDef,
		vars:       vars,
	})

	// Verify the string argument was correctly extracted
	idArg := result.Get("user", "id")
	require.NotNil(t, idArg, "expected 'id' argument to be accessible")
	assert.Equal(t, "inline-123", string(idArg.GetStringBytes()))

	// Verify the boolean argument was correctly extracted
	activeArg := result.Get("user", "active")
	require.NotNil(t, activeArg, "expected 'active' argument to be accessible")
	assert.True(t, activeArg.GetBool())
}
