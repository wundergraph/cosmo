package core

import (
	"context"
	"errors"
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
			Input:         `{"operationName": "test", "variables": {"foo": "bar"}, "extensions": {"persistedQuery": {"version": 1, "sha256Hash": "does-not-exist"}}}`,
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

			_, err = kit.NormalizeVariables()
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
