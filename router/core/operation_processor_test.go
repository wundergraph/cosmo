package core

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

func TestOperationProcessorPersistentOperations(t *testing.T) {
	executor := &Executor{
		PlanConfig:      plan.Configuration{},
		RouterSchema:    nil,
		Resolver:        nil,
		RenameTypeNames: nil,
	}
	parser := NewOperationProcessor(OperationProcessorOptions{
		Executor:                executor,
		MaxOperationSizeInBytes: 10 << 20,
		ParseKitPoolSize:        4,
	})
	clientInfo := &ClientInfo{
		Name:    "test",
		Version: "1.0.0",
	}
	const cacheHashNotStored = "0000000000000000000000000000000000000000000000000000000000000000"
	testCases := []struct {
		ExpectedType  string
		ExpectedError error
		Input         string
		Variables     string
	}{
		/**
		 * Test cases persist operation
		 */
		{
			Input:         `{"operationName": "test", "variables": {"foo": "bar"}, "extensions": {"persistedQuery": {"version": 1, "sha256Hash": "` + cacheHashNotStored + `"}}}`,
			Variables:     `{"foo": "bar"}`,
			ExpectedError: errors.New("could not resolve persisted query, feature is not configured"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.Input, func(t *testing.T) {
			kit, err := parser.NewKit()
			require.NoError(t, err)
			defer kit.Free()

			err = kit.UnmarshalOperationFromBody([]byte(tc.Input))
			if err != nil {
				require.NoError(t, err)
			}

			require.NoError(t, err)

			var isApq bool
			_, isApq, err = kit.FetchPersistedOperation(context.Background(), clientInfo)

			require.False(t, isApq)
			if err != nil {
				require.EqualError(t, tc.ExpectedError, err.Error())
			} else if kit.parsedOperation != nil {
				require.Equal(t, tc.ExpectedType, kit.parsedOperation.Type)
				require.JSONEq(t, tc.Variables, string(kit.parsedOperation.Request.Variables))
				require.Equal(t, uint64(0), kit.parsedOperation.ID)
				require.Equal(t, "", kit.parsedOperation.NormalizedRepresentation)
			}
		})
	}
}

func TestPersistedOperationCachePopulatesOperationName(t *testing.T) {
	executor := &Executor{
		PlanConfig:      plan.Configuration{},
		RouterSchema:    nil,
		Resolver:        nil,
		RenameTypeNames: nil,
	}
	processor := NewOperationProcessor(OperationProcessorOptions{
		Executor:                executor,
		MaxOperationSizeInBytes: 10 << 20,
		ParseKitPoolSize:        1,
	})

	kit, err := processor.NewKit()
	require.NoError(t, err)
	defer kit.Free()

	entry := NormalizationCacheEntry{
		normalizedRepresentation: "query TestOperation { a }",
		operationType:            "query",
	}

	err = kit.handleFoundPersistedOperationEntry(entry)
	require.NoError(t, err)
	require.Equal(t, "TestOperation", kit.parsedOperation.Request.OperationName)
}

func TestPersistedOperationCacheOperationNameIsStableAcrossKitReuse(t *testing.T) {
	executor := &Executor{
		PlanConfig:      plan.Configuration{},
		RouterSchema:    nil,
		Resolver:        nil,
		RenameTypeNames: nil,
	}
	processor := NewOperationProcessor(OperationProcessorOptions{
		Executor:                executor,
		MaxOperationSizeInBytes: 10 << 20,
		ParseKitPoolSize:        1,
	})

	kit1, err := processor.NewKit()
	require.NoError(t, err)

	err = kit1.handleFoundPersistedOperationEntry(NormalizationCacheEntry{
		normalizedRepresentation: "query FirstName { a }",
		operationType:            "query",
	})
	require.NoError(t, err)

	firstName := kit1.parsedOperation.Request.OperationName
	require.Equal(t, "FirstName", firstName)

	kit1.Free()

	kit2, err := processor.NewKit()
	require.NoError(t, err)
	defer kit2.Free()

	err = kit2.handleFoundPersistedOperationEntry(NormalizationCacheEntry{
		normalizedRepresentation: "query SecondName { a }",
		operationType:            "query",
	})
	require.NoError(t, err)
	require.Equal(t, "SecondName", kit2.parsedOperation.Request.OperationName)
	require.Equal(t, "FirstName", firstName)
}

func TestParseOperationProcessor(t *testing.T) {
	executor := &Executor{
		PlanConfig:      plan.Configuration{},
		RouterSchema:    nil,
		Resolver:        nil,
		RenameTypeNames: nil,
	}
	parser := NewOperationProcessor(OperationProcessorOptions{
		Executor:                executor,
		MaxOperationSizeInBytes: 10 << 20,
		ParseKitPoolSize:        4,
	})
	testCases := []struct {
		ExpectedType  string
		ExpectedError error
		Input         string
		Variables     string
	}{
		/**
		 * Test cases parse simple
		 */
		{
			Input:         `{"query":"query { initialPayload(repeat:3) }", "variables": {"foo": "bar"}}`,
			ExpectedType:  "query",
			Variables:     `{"foo": "bar"}`,
			ExpectedError: nil,
		},
		/**
		 * Test cases parse invalid graphql
		 */
		{
			Input:         `{"query":"invalid", "variables": {"foo": "bar"}}`,
			Variables:     `{"foo": "bar"}`,
			ExpectedError: errors.New("unexpected literal - got: UNDEFINED want one of: [ENUM TYPE UNION QUERY INPUT EXTEND SCHEMA SCALAR FRAGMENT INTERFACE DIRECTIVE]"),
		},
		/**
		 * Test cases parse operation types
		 */
		{
			ExpectedType:  "subscription",
			Input:         `{"query":"subscription { initialPayload(repeat:3) }", "variables": {"foo": "bar"}}`,
			Variables:     `{"foo": "bar"}`,
			ExpectedError: nil,
		},
		{
			ExpectedType:  "query",
			Input:         `{"query":"query { initialPayload(repeat:3) }", "variables": {"foo": "bar"}}`,
			Variables:     `{"foo": "bar"}`,
			ExpectedError: nil,
		},
		{
			ExpectedType:  "mutation",
			Input:         `{"query":"mutation { initialPayload(repeat:3) }", "variables": {"foo": "bar"}}`,
			Variables:     `{"foo": "bar"}`,
			ExpectedError: nil,
		},
		/**
		 * Test cases parse variables
		 */
		{
			ExpectedType:  "query",
			Input:         `{"query":"query { initialPayload(repeat:3) }", "variables": {"foo": ["bar"]}}`,
			Variables:     `{"foo": ["bar"]}`,
			ExpectedError: nil,
		},
		{
			Input:         `{"query":"query { initialPayload(repeat:3) }", "variables": null}`,
			ExpectedType:  "query",
			Variables:     "{}",
			ExpectedError: nil,
		},
		{
			Input:         `{"query":"query { initialPayload(repeat:3) }", "variables": {"foo": {"bar": "baz"}}}`,
			ExpectedType:  "query",
			Variables:     `{"foo": {"bar": "baz"}}`,
			ExpectedError: nil,
		},
		{
			Input:         `{"query":"mutation", "variables": {"foo": "bar"}}`,
			ExpectedError: errors.New("unexpected token - got: EOF want one of: [LBRACE]"),
			ExpectedType:  "",
			Variables:     "",
		},
		/**
		 * Test cases parse operation name
		 */
		{
			Input:         `{"query":"subscription { initialPayload(repeat:3) }", "variables": {"foo": "bar"}, "operationName": "test"}`,
			ExpectedError: errors.New("operation with name 'test' not found"),
			ExpectedType:  "",
			Variables:     "",
		},
		{
			ExpectedType:  "subscription",
			Input:         `{"query":"subscription foo { initialPayload(repeat:3) }", "variables": {"foo": "bar"}, "operationName": "foo"}`,
			Variables:     `{"foo": "bar"}`,
			ExpectedError: nil,
		},
		/**
		 * Test cases parse multiple operations
		 */
		{
			Input:         `{"query":"query { initialPayload(repeat:3) } mutation { initialPayload(repeat:3) }", "variables": {"foo": "bar"}}`,
			ExpectedError: errors.New("operation name is required when multiple operations are defined"),
			ExpectedType:  "",
			Variables:     "",
		},
		{
			ExpectedType:  "query",
			Input:         `{"query":"query test { initialPayload(repeat:3) } mutation { initialPayload(repeat:3) }", "variables": {"foo": "bar"}, "operationName": "test"}`,
			Variables:     `{"foo": "bar"}`,
			ExpectedError: nil,
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.Input, func(t *testing.T) {
			kit, err := parser.NewKit()
			require.NoError(t, err)
			defer kit.Free()

			err = kit.UnmarshalOperationFromBody([]byte(tc.Input))
			require.NoError(t, err)

			err = kit.Parse()
			if err != nil {
				require.EqualError(t, tc.ExpectedError, err.Error())
			} else if kit.parsedOperation != nil {
				require.Equal(t, tc.ExpectedType, kit.parsedOperation.Type)
				require.JSONEq(t, tc.Variables, string(kit.parsedOperation.Request.Variables))
				require.Equal(t, uint64(0), kit.parsedOperation.ID)
				require.Equal(t, "", kit.parsedOperation.NormalizedRepresentation)
			}
		})
	}
}

func TestNormalizeVariablesOperationProcessor(t *testing.T) {
	testCases := []struct {
		Name                             string
		ClientSchema                     string
		Input                            string
		ExpectedNormalizedRepresentation string
		ExpectedVariables                string
	}{
		{
			Name:                             "Should detect operation change and update normalized representation",
			ClientSchema:                     `type Query { team(id: [ID!]!): String }`,
			Input:                            `{"query":"query Q($teamId: ID!) {team(id: [$teamId])}","operationName":"Q","variables":{"teamId": "bar"}}`,
			ExpectedNormalizedRepresentation: `query Q($a: [ID!]!){team(id: $a)}`,
			ExpectedVariables:                `{"a":["bar"]}`,
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.Name, func(t *testing.T) {
			clientSchema, report := astparser.ParseGraphqlDocumentString(tc.ClientSchema)
			require.False(t, report.HasErrors(), "failed to parse client schema")
			require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&clientSchema))

			executor := &Executor{
				PlanConfig:      plan.Configuration{},
				RouterSchema:    nil,
				Resolver:        nil,
				RenameTypeNames: nil,
				ClientSchema:    &clientSchema,
			}
			parser := NewOperationProcessor(OperationProcessorOptions{
				Executor:                executor,
				MaxOperationSizeInBytes: 10 << 20,
				ParseKitPoolSize:        4,
			})

			kit, err := parser.NewKit()
			require.NoError(t, err)
			defer kit.Free()

			err = kit.UnmarshalOperationFromBody([]byte(tc.Input))
			require.NoError(t, err)

			err = kit.Parse()
			require.NoError(t, err)

			_, err = kit.NormalizeOperation("test", false)
			require.NoError(t, err)

			_, _, err = kit.NormalizeVariables()
			require.NoError(t, err)

			assert.Equal(t, tc.ExpectedNormalizedRepresentation, kit.parsedOperation.NormalizedRepresentation)
			assert.Equal(t, tc.ExpectedVariables, string(kit.parsedOperation.Request.Variables))
		})
	}
}

func TestOperationProcessorUnmarshalExtensions(t *testing.T) {
	executor := &Executor{
		PlanConfig:      plan.Configuration{},
		RouterSchema:    nil,
		Resolver:        nil,
		RenameTypeNames: nil,
	}
	parser := NewOperationProcessor(OperationProcessorOptions{
		Executor:                executor,
		MaxOperationSizeInBytes: 10 << 20,
		ParseKitPoolSize:        4,
	})
	testCases := []struct {
		Input     string
		HttpError bool
		Valid     bool
	}{
		{
			Input:     `{"query":"subscription { initialPayload(repeat:3) }","extensions":"this_is_not_valid"}`,
			HttpError: true,
		},
		{
			Input:     `{"query":"subscription { initialPayload(repeat:3) }","extensions":42}`,
			HttpError: true,
		},
		{
			Input:     `{"query":"subscription { initialPayload(repeat:3) }","extensions":true}`,
			HttpError: true,
		},
		{
			Input: `{"query":"subscription { initialPayload(repeat:3) }","extensions":{"foo":bar}}`,
			Valid: false,
		},
		{
			Input: `{"query":"subscription { initialPayload(repeat:3) }","extensions":{}}`,
			Valid: true,
		},
		{
			Input: `{"query":"subscription { initialPayload(repeat:3) }","extensions":null}`,
			Valid: true,
		},
		{
			Input: `{"query":"subscription { initialPayload(repeat:3) }"}`,
			Valid: true,
		},
	}
	var inputError HttpError
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.Input, func(t *testing.T) {

			kit, err := parser.NewKit()
			require.NoError(t, err)
			defer kit.Free()

			err = kit.UnmarshalOperationFromBody([]byte(tc.Input))

			if tc.Valid {
				assert.NoError(t, err)
			} else if tc.HttpError {
				assert.True(t, errors.As(err, &inputError), "expected invalid extensions to return an http error, got %s", err)
			} else {
				assert.Error(t, err)
			}
		})
	}
}

const namedIntrospectionQuery = `{"operationName":"IntrospectionQuery","variables":{},"query":"query IntrospectionQuery {\n  __schema {\n    queryType {\n      name\n    }\n    mutationType {\n      name\n    }\n    subscriptionType {\n      name\n    }\n    types {\n      ...FullType\n    }\n    directives {\n      name\n      description\n      locations\n      args {\n        ...InputValue\n      }\n    }\n  }\n}\n\nfragment FullType on __Type {\n  kind\n  name\n  description\n  fields(includeDeprecated: true) {\n    name\n    description\n    args {\n      ...InputValue\n    }\n    type {\n      ...TypeRef\n    }\n    isDeprecated\n    deprecationReason\n  }\n  inputFields {\n    ...InputValue\n  }\n  interfaces {\n    ...TypeRef\n  }\n  enumValues(includeDeprecated: true) {\n    name\n    description\n    isDeprecated\n    deprecationReason\n  }\n  possibleTypes {\n    ...TypeRef\n  }\n}\n\nfragment InputValue on __InputValue {\n  name\n  description\n  type {\n    ...TypeRef\n  }\n  defaultValue\n}\n\nfragment TypeRef on __Type {\n  kind\n  name\n  ofType {\n    kind\n    name\n    ofType {\n      kind\n      name\n      ofType {\n        kind\n        name\n        ofType {\n          kind\n          name\n          ofType {\n            kind\n            name\n            ofType {\n              kind\n              name\n              ofType {\n                kind\n                name\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n}\n"}`
const singleNamedIntrospectionQueryWithoutOperationName = `{"operationName":"","variables":{},"query":"query IntrospectionQuery {\n  __schema {\n    queryType {\n      name\n    }\n    mutationType {\n      name\n    }\n    subscriptionType {\n      name\n    }\n    types {\n      ...FullType\n    }\n    directives {\n      name\n      description\n      locations\n      args {\n        ...InputValue\n      }\n    }\n  }\n}\n\nfragment FullType on __Type {\n  kind\n  name\n  description\n  fields(includeDeprecated: true) {\n    name\n    description\n    args {\n      ...InputValue\n    }\n    type {\n      ...TypeRef\n    }\n    isDeprecated\n    deprecationReason\n  }\n  inputFields {\n    ...InputValue\n  }\n  interfaces {\n    ...TypeRef\n  }\n  enumValues(includeDeprecated: true) {\n    name\n    description\n    isDeprecated\n    deprecationReason\n  }\n  possibleTypes {\n    ...TypeRef\n  }\n}\n\nfragment InputValue on __InputValue {\n  name\n  description\n  type {\n    ...TypeRef\n  }\n  defaultValue\n}\n\nfragment TypeRef on __Type {\n  kind\n  name\n  ofType {\n    kind\n    name\n    ofType {\n      kind\n      name\n      ofType {\n        kind\n        name\n        ofType {\n          kind\n          name\n          ofType {\n            kind\n            name\n            ofType {\n              kind\n              name\n              ofType {\n                kind\n                name\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n}\n"}`
const silentIntrospectionQuery = `{"operationName":null,"variables":{},"query":"{\n  __schema {\n    queryType {\n      name\n    }\n    mutationType {\n      name\n    }\n    subscriptionType {\n      name\n    }\n    types {\n      ...FullType\n    }\n    directives {\n      name\n      description\n      locations\n      args {\n        ...InputValue\n      }\n    }\n  }\n}\n\nfragment FullType on __Type {\n  kind\n  name\n  description\n  fields(includeDeprecated: true) {\n    name\n    description\n    args {\n      ...InputValue\n    }\n    type {\n      ...TypeRef\n    }\n    isDeprecated\n    deprecationReason\n  }\n  inputFields {\n    ...InputValue\n  }\n  interfaces {\n    ...TypeRef\n  }\n  enumValues(includeDeprecated: true) {\n    name\n    description\n    isDeprecated\n    deprecationReason\n  }\n  possibleTypes {\n    ...TypeRef\n  }\n}\n\nfragment InputValue on __InputValue {\n  name\n  description\n  type {\n    ...TypeRef\n  }\n  defaultValue\n}\n\nfragment TypeRef on __Type {\n  kind\n  name\n  ofType {\n    kind\n    name\n    ofType {\n      kind\n      name\n      ofType {\n        kind\n        name\n        ofType {\n          kind\n          name\n          ofType {\n            kind\n            name\n            ofType {\n              kind\n              name\n              ofType {\n                kind\n                name\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n}\n"}`
const silentIntrospectionQueryWithOperationName = `{"operationName":"IntrospectionQuery","variables":{},"query":"{\n  __schema {\n    queryType {\n      name\n    }\n    mutationType {\n      name\n    }\n    subscriptionType {\n      name\n    }\n    types {\n      ...FullType\n    }\n    directives {\n      name\n      description\n      locations\n      args {\n        ...InputValue\n      }\n    }\n  }\n}\n\nfragment FullType on __Type {\n  kind\n  name\n  description\n  fields(includeDeprecated: true) {\n    name\n    description\n    args {\n      ...InputValue\n    }\n    type {\n      ...TypeRef\n    }\n    isDeprecated\n    deprecationReason\n  }\n  inputFields {\n    ...InputValue\n  }\n  interfaces {\n    ...TypeRef\n  }\n  enumValues(includeDeprecated: true) {\n    name\n    description\n    isDeprecated\n    deprecationReason\n  }\n  possibleTypes {\n    ...TypeRef\n  }\n}\n\nfragment InputValue on __InputValue {\n  name\n  description\n  type {\n    ...TypeRef\n  }\n  defaultValue\n}\n\nfragment TypeRef on __Type {\n  kind\n  name\n  ofType {\n    kind\n    name\n    ofType {\n      kind\n      name\n      ofType {\n        kind\n        name\n        ofType {\n          kind\n          name\n          ofType {\n            kind\n            name\n            ofType {\n              kind\n              name\n              ofType {\n                kind\n                name\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n}\n"}`
const schemaIntrospectionQueryWithMultipleQueries = `{"operationName":"IntrospectionQuery","query":"query Hello { world } query IntrospectionQuery { __schema { types { name } } }"}`
const typeIntrospectionQueryWithMultipleQueries = `{"operationName":"IntrospectionQuery","query":"query Hello { world } query IntrospectionQuery { __type(name: \"Droid\") { name } }"}`
const typeIntrospectionQuery = `{"operationName":null,"variables":{},"query":"{__type(name:\"Foo\"){kind}}"}`
const nonIntrospectionQuery = `{"operationName":"Foo","query":"query Foo {bar}"}`
const nonIntrospectionQueryWithIntrospectionQueryName = `{"operationName":"IntrospectionQuery","query":"query IntrospectionQuery {bar}"}`
const nonSchemaIntrospectionQueryWithAliases = `{"operationName":"IntrospectionQuery","query":"query IntrospectionQuery { __schema: user { name types: account { balance } } }"}`
const nonTypeIntrospectionQueryWithAliases = `{"operationName":"IntrospectionQuery","query":"query IntrospectionQuery { __type: user { name } }"}`
const nonSchemaIntrospectionQueryWithAdditionalFields = `{"operationName":"IntrospectionQuery","query":"query IntrospectionQuery { __schema { types { name } } user { name account { balance } } }"}`
const nonTypeIntrospectionQueryWithAdditionalFields = `{"operationName":"IntrospectionQuery","query":"query IntrospectionQuery { __type(name: \"Droid\") { name } user { name account { balance } } }"}`
const nonSchemaIntrospectionQueryWithMultipleQueries = `{"operationName":"Hello","query":"query Hello { world } query IntrospectionQuery { __schema { types { name } } }"}`
const nonTypeIntrospectionQueryWithMultipleQueries = `{"operationName":"Hello","query":"query Hello { world } query IntrospectionQuery { __type(name: \"Droid\") { name } }"}`
const typeIntrospectionWithAdditionalFields = `{"operationName":null,"variables":{},"query":"query Intro { __typename __type(name: \"Query\"){ name } }"}`
const mutationQuery = `{"operationName":null,"query":"mutation Foo {bar}"}`

func TestUnmarshalOperationFromBody(t *testing.T) {
	executor := &Executor{
		PlanConfig:      plan.Configuration{},
		RouterSchema:    nil,
		Resolver:        nil,
		RenameTypeNames: nil,
	}
	parser := NewOperationProcessor(OperationProcessorOptions{
		Executor:                executor,
		MaxOperationSizeInBytes: 10 << 20,
		ParseKitPoolSize:        4,
	})
	testCases := []struct {
		Name          string
		Input         string
		ExpectedQuery string
		ExpectedVars  string
		ExpectedOp    string
		ExpectedError error
	}{
		{
			Name:          "JSON with extra whitespace and newlines",
			Input:         "{\n  \"query\": \"query { initialPayload(repeat:3) }\",\n  \"variables\": {\n    \"foo\": \"bar\",\n    \"baz\": [1, 2, 3]\n  },\n  \"operationName\": \"TestOperation\"\n}",
			ExpectedQuery: "query { initialPayload(repeat:3) }",
			ExpectedVars:  `{"foo":"bar","baz":[1,2,3]}`,
			ExpectedOp:    "TestOperation",
			ExpectedError: nil,
		},
		{
			Name:          "JSON with tabs and multiple spaces",
			Input:         "{\t\"query\":\t\t\"query { user { name } }\",\t\"variables\":\t{\t\t\"id\":\t123\t},\t\"operationName\":\t\"GetUser\"\t}",
			ExpectedQuery: "query { user { name } }",
			ExpectedVars:  `{"id":123}`,
			ExpectedOp:    "GetUser",
			ExpectedError: nil,
		},
		{
			Name:          "Already compacted JSON",
			Input:         `{"query":"query { test }","variables":{"x":1},"operationName":"Test"}`,
			ExpectedQuery: "query { test }",
			ExpectedVars:  `{"x":1}`,
			ExpectedOp:    "Test",
			ExpectedError: nil,
		},
		{
			Name: "JSON with nested objects and arrays",
			Input: `{
				"query": "query { user(id: $id) { name profile { email } } }",
				"variables": {
					"id": "123",
					"metadata": {
						"tags": ["tag1", "tag2"],
						"count": 42
					}
				},
				"operationName": "GetUser"
			}`,
			ExpectedQuery: "query { user(id: $id) { name profile { email } } }",
			ExpectedVars:  `{"id":"123","metadata":{"tags":["tag1","tag2"],"count":42}}`,
			ExpectedOp:    "GetUser",
			ExpectedError: nil,
		},
		{
			Name: "JSON with null values",
			Input: `{
				"query": "query { test }",
				"variables": null,
				"operationName": null
			}`,
			ExpectedQuery: "query { test }",
			ExpectedVars:  `{}`,
			ExpectedOp:    "",
			ExpectedError: nil,
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.Name, func(t *testing.T) {
			kit, err := parser.NewKit()
			require.NoError(t, err)
			defer kit.Free()

			err = kit.UnmarshalOperationFromBody([]byte(tc.Input))

			if tc.ExpectedError != nil {
				require.EqualError(t, err, tc.ExpectedError.Error())
			} else {
				require.NoError(t, err)
				require.NotNil(t, kit.parsedOperation)
				assert.Equal(t, tc.ExpectedQuery, kit.parsedOperation.Request.Query)
				require.JSONEq(t, tc.ExpectedVars, string(kit.parsedOperation.Request.Variables))
				assert.Equal(t, tc.ExpectedOp, kit.parsedOperation.Request.OperationName)
			}
		})
	}
}

func TestOperationProcessorIntrospectionQuery(t *testing.T) {
	executor := &Executor{
		PlanConfig:      plan.Configuration{},
		RouterSchema:    nil,
		Resolver:        nil,
		RenameTypeNames: nil,
	}
	parser := NewOperationProcessor(OperationProcessorOptions{
		Executor:                executor,
		MaxOperationSizeInBytes: 10 << 20,
		ParseKitPoolSize:        4,
		IntrospectionEnabled:    false,
	})
	testCases := []struct {
		Name      string
		Input     string
		HttpError bool
		Valid     bool
	}{
		{
			Name:      "namedIntrospectionQuery",
			Input:     namedIntrospectionQuery,
			HttpError: true,
		},
		{
			Name:      "singleNamedIntrospectionQueryWithoutOperationName",
			Input:     singleNamedIntrospectionQueryWithoutOperationName,
			HttpError: true,
		},
		{
			Name:      "silentIntrospectionQuery",
			Input:     silentIntrospectionQuery,
			HttpError: true,
		},
		{
			Name:      "silentIntrospectionQueryWithOperationName",
			Input:     silentIntrospectionQueryWithOperationName,
			HttpError: true,
		},
		{
			Name:      "schemaIntrospectionQueryWithMultipleQueries",
			Input:     schemaIntrospectionQueryWithMultipleQueries,
			HttpError: true,
		},
		{
			Name:      "typeIntrospectionQueryWithMultipleQueries",
			Input:     typeIntrospectionQueryWithMultipleQueries,
			HttpError: true,
		},
		{
			Name:      "typeIntrospectionQuery",
			Input:     typeIntrospectionQuery,
			HttpError: true,
		},
		{
			Name:  "nonIntrospectionQuery",
			Input: nonIntrospectionQuery,
			Valid: true,
		},
		{
			Name:  "nonIntrospectionQueryWithIntrospectionQueryName",
			Input: nonIntrospectionQueryWithIntrospectionQueryName,
			Valid: true,
		},
		{
			Name:  "nonSchemaIntrospectionQueryWithAliases",
			Input: nonSchemaIntrospectionQueryWithAliases,
			Valid: true,
		},
		{
			Name:  "nonTypeIntrospectionQueryWithAliases",
			Input: nonTypeIntrospectionQueryWithAliases,
			Valid: true,
		},
		{
			Name:      "nonSchemaIntrospectionQueryWithAdditionalFields",
			Input:     nonSchemaIntrospectionQueryWithAdditionalFields,
			HttpError: true,
		},
		{
			Name:      "nonTypeIntrospectionQueryWithAdditionalFields",
			Input:     nonTypeIntrospectionQueryWithAdditionalFields,
			HttpError: true,
		},
		{
			Name:      "typeIntrospectionWithAdditionalFields",
			Input:     typeIntrospectionWithAdditionalFields,
			HttpError: true,
		},
		{
			Name:  "nonSchemaIntrospectionQueryWithMultipleQueries",
			Input: nonSchemaIntrospectionQueryWithMultipleQueries,
			Valid: true,
		},
		{
			Name:  "nonTypeIntrospectionQueryWithMultipleQueries",
			Input: nonTypeIntrospectionQueryWithMultipleQueries,
			Valid: true,
		},
		{
			Name:  "mutationQuery",
			Input: mutationQuery,
			Valid: true,
		},
	}

	var inputError HttpError
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.Name, func(t *testing.T) {

			kit, err := parser.NewKit()
			require.NoError(t, err)
			defer kit.Free()

			err = kit.UnmarshalOperationFromBody([]byte(tc.Input))
			assert.NoError(t, err)

			err = kit.Parse()

			if tc.Valid {
				assert.NoError(t, err)
			} else if tc.HttpError {
				assert.True(t, errors.As(err, &inputError), "expected an http error, got %s", err)
				assert.Equal(t, err.Error(), "GraphQL introspection is disabled by Cosmo Router, but the query contained __schema or __type. To enable introspection, set introspection_enabled: true in the Router configuration")
			} else {
				assert.Error(t, err)
			}
		})
	}
}

// TestSkipIncludeVariableNamesStableAfterKitReuse verifies that conditionalsVariableNames
// returns owned strings (not unsafe aliases into kit.doc.Input.RawBytes) so that the slice
// stored in persistedOperationVariableNames remains valid after the kit is returned to the
// pool and reused for a different query. Without explicit string creation the aliased strings would
// silently read garbage, causing cache-key corruption for every subsequent APQ request.
func TestSkipIncludeVariableNamesStableAfterKitReuse(t *testing.T) {
	executor := &Executor{
		PlanConfig:      plan.Configuration{},
		RouterSchema:    nil,
		Resolver:        nil,
		RenameTypeNames: nil,
	}
	// Pool of exactly one kit so that kit2 is guaranteed to reuse kit1's buffer.
	processor := NewOperationProcessor(OperationProcessorOptions{
		Executor:                executor,
		MaxOperationSizeInBytes: 10 << 20,
		ParseKitPoolSize:        1,
	})

	// A query whose @include directives bind two variables.  The variable names
	// "withAligators" and "withCats" live at well-known byte offsets inside the
	// raw query bytes written to kit.doc.Input.RawBytes by Parse().
	const skipIncludeQuery = `query Employee($withAligators: Boolean!, $withCats: Boolean!) { employee(id: 1) { details { pets { ... on Alligator @include(if: $withAligators) { name } ... on Cat @include(if: $withCats) { name } } } } }`

	kit1, err := processor.NewKit()
	require.NoError(t, err)

	kit1.parsedOperation.Request.Query = skipIncludeQuery
	require.NoError(t, kit1.Parse())

	names := kit1.conditionalsVariableNames()
	require.Equal(t, []string{"withAligators", "withCats"}, names,
		"conditionalsVariableNames should return sorted variable names")

	kit1.Free() // returns kit to pool; RawBytes are zeroed in length but NOT zeroed in content

	// Acquire the same kit slot and parse a different query with reversed order of fragments and variables,
	// whose bytes overwrite the positions where "withAligators" and "withCats" used to live.
	const polluterQuery = `query Employee($withCats: Boolean! $withAligators: Boolean!) { employee(id: 1) { details { pets { ... on Cat @include(if: $withCats) { name } ... on Alligator @include(if: $withAligators) { name } } } } }`

	kit2, err := processor.NewKit()
	require.NoError(t, err)
	defer kit2.Free()

	kit2.parsedOperation.Request.Query = polluterQuery
	require.NoError(t, kit2.Parse())

	// Without strings.Clone in conditionalsVariableNames, names[0] and names[1]
	// are unsafe aliases into the now-overwritten RawBytes — they will read the
	// polluter query's bytes and no longer equal the original variable names.
	require.Equal(t, "withAligators", names[0],
		"conditionalsVariableNames must return cloned (not aliased) strings: "+
			"'withAligators' was corrupted after kit reuse")
	require.Equal(t, "withCats", names[1],
		"conditionalsVariableNames must return cloned (not aliased) strings: "+
			"'withCats' was corrupted after kit reuse")
}

// deferTestSchema is a small client schema used by the @defer tests. The @defer
// directive itself is NOT declared here — it is part of the GraphQL base schema
// that asttransform.MergeDefinitionWithBaseSchema merges in below. Per the spec
// (and the Apollo docs) @defer is valid on INLINE_FRAGMENT and FRAGMENT_SPREAD,
// and accepts two optional args: `if: Boolean! = true` and `label: String`.
const deferTestSchema = `
	type Query { user: User }
	type Mutation { updateUser: User }
	type Subscription { userUpdated: User }
	type User { id: ID! name: String! profile: Profile }
	type Profile { email: String! bio: String }
`

// newDeferOperationKit builds an OperationKit whose executor uses deferTestSchema
// (merged with the base schema so @defer is defined). enableDefer mirrors the
// router's `engine.enable_defer` config option (OperationProcessorOptions.EnableDefer).
func newDeferOperationKit(t *testing.T, enableDefer bool) *OperationKit {
	t.Helper()

	clientSchema, report := astparser.ParseGraphqlDocumentString(deferTestSchema)
	require.False(t, report.HasErrors(), "failed to parse defer client schema")
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&clientSchema))

	executor := &Executor{
		PlanConfig:   plan.Configuration{},
		ClientSchema: &clientSchema,
	}
	processor := NewOperationProcessor(OperationProcessorOptions{
		Executor:                executor,
		MaxOperationSizeInBytes: 10 << 20,
		ParseKitPoolSize:        4,
		EnableDefer:             enableDefer,
	})

	kit, err := processor.NewKit()
	require.NoError(t, err)
	return kit
}

// TestOperationProcessorDeferNormalization covers the valid @defer placements
// (the ones the Apollo docs allow) and shows how the EnableDefer option changes
// the normalized representation:
//
//   - EnableDefer=true  -> the @defer fragment is expanded into internal
//     `@__defer_internal(id: N[, label: "..."])` markers on the deferred fields.
//   - EnableDefer=false -> @defer is stripped and the fragment is inlined as if
//     the directive were not present.
//
// Note: `@defer(if: false)` is a compile-time false, so the fragment is always
// inlined without a defer marker, regardless of EnableDefer.
func TestOperationProcessorDeferNormalization(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		Name             string
		Query            string
		Variables        string
		ExpectedEnabled  string // normalized representation when EnableDefer=true
		ExpectedDisabled string // normalized representation when EnableDefer=false
	}{
		{
			Name:             "@defer on inline fragment is rewritten to internal markers when enabled",
			Query:            `query Q { user { id name ... @defer { profile { email } } } }`,
			ExpectedEnabled:  `query Q {user {id name profile @__defer_internal(id: 1) {email @__defer_internal(id: 1)}}}`,
			ExpectedDisabled: `query Q {user {id name profile {email}}}`,
		},
		{
			Name:             "@defer label is preserved on the internal markers",
			Query:            `query Q { user { id name ... @defer(label: "profileDefer") { profile { email } } } }`,
			ExpectedEnabled:  `query Q {user {id name profile @__defer_internal(id: 1, label: "profileDefer") {email @__defer_internal(id: 1, label: "profileDefer")}}}`,
			ExpectedDisabled: `query Q {user {id name profile {email}}}`,
		},
		{
			Name:             "@defer on named fragment spread is inlined and marked when enabled",
			Query:            `query Q { user { id name ...UserProfile @defer } } fragment UserProfile on User { profile { email } }`,
			ExpectedEnabled:  `query Q {user {id name profile @__defer_internal(id: 1) {email @__defer_internal(id: 1)}}}`,
			ExpectedDisabled: `query Q {user {id name profile {email}}}`,
		},
		{
			Name:             "@defer(if: true) is treated as an unconditional defer",
			Query:            `query Q { user { id name ... @defer(if: true) { profile { email } } } }`,
			ExpectedEnabled:  `query Q {user {id name profile @__defer_internal(id: 1) {email @__defer_internal(id: 1)}}}`,
			ExpectedDisabled: `query Q {user {id name profile {email}}}`,
		},
		{
			Name:             "@defer(if: false) is inlined without markers regardless of EnableDefer",
			Query:            `query Q { user { id name ... @defer(if: false) { profile { email } } } }`,
			ExpectedEnabled:  `query Q {user {id name profile {email}}}`,
			ExpectedDisabled: `query Q {user {id name profile {email}}}`,
		},
		{
			Name:             "@defer(if: $var) with a truthy variable is treated as a defer",
			Query:            `query Q($withProfile: Boolean!) { user { id name ... @defer(if: $withProfile) { profile { email } } } }`,
			Variables:        `{"withProfile": true}`,
			ExpectedEnabled:  `query Q {user {id name profile @__defer_internal(id: 1) {email @__defer_internal(id: 1)}}}`,
			ExpectedDisabled: `query Q {user {id name profile {email}}}`,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.Name, func(t *testing.T) {
			t.Parallel()

			for _, enableDefer := range []bool{true, false} {
				t.Run(fmt.Sprintf("name=%s enableDefer=%t", tc.Name, enableDefer), func(t *testing.T) {
					t.Parallel()

					kit := newDeferOperationKit(t, enableDefer)
					defer kit.Free()

					variables := tc.Variables
					if variables == "" {
						variables = "{}"
					}
					body := fmt.Sprintf(`{"query":%q,"operationName":"Q","variables":%s}`, tc.Query, variables)

					require.NoError(t, kit.UnmarshalOperationFromBody([]byte(body)))
					require.NoError(t, kit.Parse())

					_, err := kit.NormalizeOperation("test", false)
					require.NoError(t, err)

					expected := tc.ExpectedDisabled
					if enableDefer {
						expected = tc.ExpectedEnabled
					}
					assert.Equal(t, expected, kit.parsedOperation.NormalizedRepresentation)
				})
			}
		})
	}
}

// TestOperationProcessorDeferValidation covers the @defer placements that are
// rejected. These prevalidation rules run regardless of the EnableDefer option,
// so the operation is rejected during normalization either way.
func TestOperationProcessorDeferValidation(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		Name                     string
		Query                    string
		ExpectedErrorWhenEnabled string
	}{
		{
			Name:                     "@defer on a subscription operation is rejected",
			Query:                    `subscription S { userUpdated { id ... @defer { profile { email } } } }`,
			ExpectedErrorWhenEnabled: `directive "@defer" is not allowed on subscription operations`,
		},
		{
			Name:                     "@defer on a mutation root field is rejected",
			Query:                    `mutation M { ... @defer { updateUser { id } } }`,
			ExpectedErrorWhenEnabled: `directive "@defer" is not allowed on root fields of mutation operations`,
		},
		{
			Name:                     "@defer with a duplicate label is rejected",
			Query:                    `query Q { user { ... @defer(label: "dup") { name } ... @defer(label: "dup") { id } } }`,
			ExpectedErrorWhenEnabled: `directive "@defer" label "dup" must be unique, but was already used on "@defer" directive`,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.Name, func(t *testing.T) {
			t.Parallel()
			// Validation is independent of the EnableDefer option.
			for _, enableDefer := range []bool{true, false} {
				t.Run(fmt.Sprintf("name=%s enableDefer=%t", tc.Name, enableDefer), func(t *testing.T) {
					t.Parallel()
					kit := newDeferOperationKit(t, enableDefer)
					defer kit.Free()

					body := fmt.Sprintf(`{"query":%q,"variables":{}}`, tc.Query)
					require.NoError(t, kit.UnmarshalOperationFromBody([]byte(body)))
					require.NoError(t, kit.Parse())

					_, err := kit.NormalizeOperation("test", false)

					if enableDefer {
						require.Error(t, err)
						assert.ErrorContains(t, err, tc.ExpectedErrorWhenEnabled)
					} else {
						require.NoError(t, err)
					}

				})
			}
		})
	}
}
