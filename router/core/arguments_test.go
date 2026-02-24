package core

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/astjson"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
)

func TestArgumentMapping(t *testing.T) {
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
				expected := map[string]any{
					"query.user.id": "123",
				}
				assertFieldArgMap(t, expected, result)
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
				expected := map[string]any{
					"query.user.id": "123",
				}
				assertFieldArgMap(t, expected, result)
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
				expected := map[string]any{
					"query.user.id":           "user-1",
					"query.user.posts.limit":  10,
					"query.user.posts.offset": 5,
				}
				assertFieldArgMap(t, expected, result)
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
				arg := result.Get("query.hello.someArg")
				require.Nil(t, arg, "expected nil for non-existent argument")

				arg = result.Get("query.nonExistent.arg")
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
				expected := map[string]any{
					"query.user.id":   "user-123",
					"query.post.slug": "my-post",
				}
				assertFieldArgMap(t, expected, result)
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
				idsArg := result.Get("query.users.ids")
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
				filterArg := result.Get("query.users.filter")
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
				expected := map[string]any{
					"query.a.id": "user-1",
					"query.b.id": "user-2",
				}
				assertFieldArgMap(t, expected, result)

				// Using the field name should not find the arguments
				userIdArg := result.Get("query.user.id")
				assert.Nil(t, userIdArg, "expected nil when using field name instead of alias")
			},
		},
		{
			// After normalization, named fragments are inlined, so arguments should be
			// accessible via the normal field path (not fragment definition path)
			name: "arguments from named fragments are accessible via spreaded path",
			schema: `
				type Query {
					user(id: ID!): User
				}
				type User {
					id: ID!
					name: String!
					posts(limit: Int!, offset: Int): [Post!]!
					friends(first: Int!): [User!]!
				}
				type Post {
					id: ID!
					title: String!
				}
			`,
			operation: `
				fragment UserPosts on User {
					posts(limit: $postsLimit, offset: $postsOffset) {
						id
						title
					}
				}

				fragment UserFriends on User {
					friends(first: $friendsCount) {
						id
						name
					}
				}

				query GetUser($userId: ID!, $postsLimit: Int!, $postsOffset: Int, $friendsCount: Int!) {
					user(id: $userId) {
						id
						name
						...UserPosts
						...UserFriends
					}
				}
			`,
			variables: `{"userId": "user-1", "postsLimit": 10, "postsOffset": 5, "friendsCount": 20}`,
			assertions: func(t *testing.T, result Arguments) {
				expected := map[string]any{
					"query.user.id":            "user-1",
					"query.user.posts.limit":   10,
					"query.user.posts.offset":  5,
					"query.user.friends.first": 20,
				}
				assertFieldArgMap(t, expected, result)
			},
		},
		{
			// Inline fragments remain in the AST after normalization and must be accessible
			// with $TypeName notation.
			name: "arguments within inline fragments are accessible with $TypeName prefix",
			schema: `
				type Query {
					search(query: String!): [SearchResult!]!
				}

				union SearchResult = User | Post

				type User {
					id: ID!
					name(format: String): String!
					email(verified: Boolean): String!
				}

				type Post {
					id: ID!
					title(truncate: Int): String!
					content: String!
				}
			`,
			operation: `
				query GetSearchResults($searchQuery: String!, $nameFormat: String, $verifiedOnly: Boolean) {
					search(query: $searchQuery) {
						... on User {
							id
							name(format: $nameFormat)
							email(verified: $verifiedOnly)
						}
						... on Post {
							id
							title(truncate: 100)
							content
						}
					}
				}
			`,
			variables: `{"searchQuery": "test", "nameFormat": "uppercase", "verifiedOnly": true}`,
			assertions: func(t *testing.T, result Arguments) {
				expected := map[string]any{
					"query.search.query":                "test",
					"query.search.$User.name.format":    "uppercase",
					"query.search.$User.email.verified": true,
					"query.search.$Post.title.truncate": 100,
				}
				assertFieldArgMap(t, expected, result)
			},
		},
		{
			name: "arguments in nested inline fragments are accessible",
			schema: `
				interface Titleable {
					title(f1: Int): String
				}

				interface Nameable {
					name(f2: Int): String
				}

				type Trophie implements Titleable {
					title(f1: Int): String
				}

				type Doctor implements Titleable & Nameable {
					title(f1: Int): String
					name(f2: Int): String
					profession(f3: Int): String
				}

				type Person implements Nameable {
					name(f2: Int): String
					hobby(f4: Int): String
				}

				type Query {
					title(f1: Int): Titleable
				}
			`,
			operation: `
				query {
					title(f1: 1) {
						... on Nameable {
							name(f2: 2)
							... on Doctor {
								profession(f3: 3)
							}
							... on Person {
								hobby(f4: 4)
							}
						}
					}
				}
			`,
			variables: ``,
			assertions: func(t *testing.T, result Arguments) {
				expected := map[string]any{
					"query.title.f1":                              1,
					"query.title.$Nameable.name.f2":               2,
					"query.title.$Nameable.$Doctor.profession.f3": 3,
					"query.title.$Nameable.$Person.hobby.f4":      4,
				}
				assertFieldArgMap(t, expected, result)
			},
		},
		{
			// The engine removes inline fragments from operations,
			// if they are inaccessable. This can happen on nested interface selections
			// where a fragment type implements an interface but not the other.
			// We expect a field argument inside such a fragment to still be part
			// of the mapping.
			name: "arguments in unreachable inline fragments are accessible",
			schema: `
				interface Titleable {
					title(f1: Int): String
				}

				interface Nameable {
					name(f2: Int): String
				}

				type Trophie implements Titleable {
					title(f1: Int): String
				}

				type Doctor implements Titleable & Nameable {
					title(f1: Int): String
					name(f2: Int): String
					profession(f3: Int): String
				}

				type Person implements Nameable {
					name(f2: Int): String
					hobby(f4: Int): String
				}

				type Query {
					title(f1: Int): Titleable
				}
			`,
			operation: `
				query($v1: Int, $v2: Int, $v3: Int, $v4: Int) {
  					title { # returns Titleable
    					title(f1: $v1)
    					... on Nameable {
      						name(f2: $v2)
      						... on Doctor {
      						  profession(f3: $v3)
      						}
      						... on Person { # implements Nameable but not Titleable
      						  hobby(f4: $v4)
      						}
    					}
  					}
				}
			`,
			variables: `{"v1": 1, "v2": 2, "v3": 3, "v4": 4}`,
			assertions: func(t *testing.T, result Arguments) {
				expected := map[string]any{
					"query.title.title.f1":                        1,
					"query.title.$Nameable.name.f2":               2,
					"query.title.$Nameable.$Doctor.profession.f3": 3,
					"query.title.$Nameable.$Person.hobby.f4":      4, // should exist
				}
				assertFieldArgMap(t, expected, result)
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Mimic what the router is doing by first parsing the schema and operation,
			// then normalize the query and only then normalize the variables (and create
			// field argument mapping)

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

			// Then normalize variables using VariablesNormalizer which returns the field argument mapping
			varNorm := astnormalization.NewVariablesNormalizer(
				astnormalization.VariablesNormalizerOptions{EnableFieldArgumentMapping: true},
			)
			result := varNorm.NormalizeOperation(&operation, &schema, rep)
			require.False(t, rep.HasErrors(), "failed to normalize variables")

			// Use normalized variables (includes both provided and extracted variables)
			vars, err := astjson.ParseBytes(operation.Input.Variables)
			require.NoError(t, err)

			arguments := NewArguments(result.FieldArgumentMapping, vars)

			tc.assertions(t, arguments)
		})
	}
}

func TestNewArguments_NilMapping(t *testing.T) {
	// Test that nil mapping returns empty Arguments
	result := NewArguments(nil, nil)
	assert.Nil(t, result.Get("query.user.id"))
}

func TestNewArguments_EmptyMapping(t *testing.T) {
	// Test that empty mapping returns empty Arguments
	result := NewArguments(astnormalization.FieldArgumentMapping{}, nil)
	assert.Nil(t, result.Get("query.user.id"))
}

func TestArguments_Get_NonExistentPath(t *testing.T) {
	vars, err := astjson.ParseBytes([]byte(`{"userId": "123"}`))
	require.NoError(t, err)

	mapping := astnormalization.FieldArgumentMapping{
		"query.user.id": "userId",
	}
	args := NewArguments(mapping, vars)

	assert.Nil(t, args.Get("query.user.nonexistent"))
	assert.Nil(t, args.Get("mutation.createUser.id"))
	assert.Nil(t, args.Get(""))
}

func assertFieldArgMap(t *testing.T, expected map[string]any, result Arguments) {
	for path, expectedValue := range expected {
		jsonValue := result.Get(path)
		require.NotNil(t, jsonValue, "no value found at path '%s'", path)

		switch valType := jsonValue.Type(); valType {
		case astjson.TypeNumber:
			// in tests we assume its always int
			assert.Equal(t, expectedValue, jsonValue.GetInt())
		case astjson.TypeString:
			assert.Equal(t, expectedValue, string(jsonValue.GetStringBytes()))
		case astjson.TypeFalse, astjson.TypeTrue:
			assert.Equal(t, expectedValue, jsonValue.GetBool())
		default:
			t.Fatalf("can't assert on unknown astjson type '%s'", valType)
		}
	}
}
