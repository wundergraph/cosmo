package integration

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// TestGraphQLOverHTTPStatusCodes verifies that request errors, which are written
// without a "data" entry, use the 4xx status codes of the GraphQL over HTTP spec
// instead of 200. See https://github.com/graphql/graphql-over-http/blob/d438b209d60fa3d34b0530b605e60d5640c7ef9b/spec/GraphQLOverHTTP.md#status-codes
func TestGraphQLOverHTTPStatusCodes(t *testing.T) {
	t.Parallel()

	const (
		mutation      = `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`
		deferQuery    = `query { employees { id ... @defer { isAvailable } } }`
		persistedHash = "9015ddfadd802bb378a14e48cea51e9bf9a07c7f8a71d85c56d7b104fea84937"
	)

	type testCase struct {
		name           string
		request        testenv.GraphQLRequest
		expectedBody   string
		expectedStatus int
	}

	run := func(t *testing.T, xEnv *testenv.Environment, cases []testCase) {
		t.Helper()
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				res, err := xEnv.MakeGraphQLRequest(tc.request)
				require.NoError(t, err)
				require.Equal(t, tc.expectedBody, res.Body)
				require.Equal(t, tc.expectedStatus, res.Response.StatusCode)
			})
		}
	}

	// blockedBy only matches requests that carry the given X-Block header value,
	// so the block rules don't interfere with the other cases sharing the router.
	blockedBy := func(value string) config.BlockOperationConfiguration {
		return config.BlockOperationConfiguration{
			Enabled:   true,
			Condition: "request.header.Get('X-Block') == '" + value + "'",
		}
	}

	t.Run("without persisted operations", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.UseGraphQLOverHTTPStatusCodes = true
				securityConfiguration.BlockMutations = blockedBy("mutation")
				securityConfiguration.BlockSubscriptions = blockedBy("subscription")
				securityConfiguration.BlockNonPersistedOperations = blockedBy("non-persisted")
			},
			RouterOptions: []core.Option{
				core.WithIntrospection(false, config.IntrospectionConfiguration{Enabled: false}),
				core.WithFileUploadConfig(&config.FileUpload{Enabled: false}),
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{Disabled: true}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			run(t, xEnv, []testCase{
				{
					name:           "403 for blocked mutation",
					request:        testenv.GraphQLRequest{Query: mutation, Header: http.Header{"X-Block": []string{"mutation"}}},
					expectedBody:   `{"errors":[{"message":"operation type 'mutation' is blocked"}]}`,
					expectedStatus: http.StatusForbidden,
				},
				{
					name: "403 for blocked subscription over SSE",
					request: testenv.GraphQLRequest{
						Query:  `subscription { currentTime { unixTime } }`,
						Header: http.Header{"X-Block": []string{"subscription"}, "Accept": []string{"text/event-stream"}},
					},
					expectedBody:   "event: next\ndata: {\"errors\":[{\"message\":\"operation type 'subscription' is blocked\"}]}",
					expectedStatus: http.StatusForbidden,
				},
				{
					name:           "403 for blocked non-persisted operation",
					request:        testenv.GraphQLRequest{Query: `{ employees { id } }`, Header: http.Header{"X-Block": []string{"non-persisted"}}},
					expectedBody:   `{"errors":[{"message":"non-persisted operation is blocked"}]}`,
					expectedStatus: http.StatusForbidden,
				},
				{
					name:           "403 for introspection when disabled",
					request:        testenv.GraphQLRequest{Query: `{ __schema { __typename } }`},
					expectedBody:   `{"errors":[{"message":"GraphQL introspection is disabled by Cosmo Router, but the query contained __schema or __type. To enable introspection, set introspection_enabled: true in the Router configuration"}]}`,
					expectedStatus: http.StatusForbidden,
				},
				{
					name:           "422 for missing operation name with multiple anonymous operations",
					request:        testenv.GraphQLRequest{Query: `{ employees { id } } { employees { id } }`},
					expectedBody:   `{"errors":[{"message":"operation name is required when multiple operations are defined"}]}`,
					expectedStatus: http.StatusUnprocessableEntity,
				},
				{
					name:           "422 for operation name not found on named operation",
					request:        testenv.GraphQLRequest{Query: `query Exists { employees { id } }`, OperationName: []byte(`"Missing"`)},
					expectedBody:   `{"errors":[{"message":"operation with name 'Missing' not found"}]}`,
					expectedStatus: http.StatusUnprocessableEntity,
				},
				{
					name:           "422 for operation name not found on anonymous operation",
					request:        testenv.GraphQLRequest{Query: `{ employees { id } }`, OperationName: []byte(`"Missing"`)},
					expectedBody:   `{"errors":[{"message":"operation with name 'Missing' not found"}]}`,
					expectedStatus: http.StatusUnprocessableEntity,
				},
				{
					name:           "422 for required variable not provided",
					request:        testenv.GraphQLRequest{Query: `query Find($criteria: SearchInput!) { findEmployees(criteria: $criteria) { id } }`},
					expectedBody:   `{"errors":[{"message":"Variable \"$criteria\" of required type \"SearchInput!\" was not provided."}]}`,
					expectedStatus: http.StatusUnprocessableEntity,
				},
				{
					name: "422 for variable that cannot be coerced",
					request: testenv.GraphQLRequest{
						Query:     `query Find($criteria: SearchInput!) { findEmployees(criteria: $criteria) { id } }`,
						Variables: []byte(`{"criteria":{"nationality":1}}`),
					},
					expectedBody:   `{"errors":[{"message":"Variable \"$criteria\" got invalid value 1 at \"criteria.nationality\"; Enum \"Nationality\" cannot represent non-string value: 1."}]}`,
					expectedStatus: http.StatusUnprocessableEntity,
				},
				{
					name: "422 for persisted query when persisted operations are disabled",
					request: testenv.GraphQLRequest{
						Extensions: []byte(`{"persistedQuery":{"version":1,"sha256Hash":"` + persistedHash + `"}}`),
					},
					expectedBody:   `{"errors":[{"message":"could not resolve persisted query, feature is not configured"}]}`,
					expectedStatus: http.StatusUnprocessableEntity,
				},
				{
					name:           "406 for @defer without multipart/mixed in Accept",
					request:        testenv.GraphQLRequest{Query: deferQuery, Header: http.Header{"Accept": []string{"application/json"}}},
					expectedBody:   `{"errors":[{"message":"the router received a query with the @defer directive but the client does not accept multipart/mixed HTTP responses. To enable @defer support, add the HTTP header 'Accept: multipart/mixed'","extensions":{"code":"DEFER_BAD_HEADER"}}]}`,
					expectedStatus: http.StatusNotAcceptable,
				},
				{
					name: "406 for @defer with unsupported incremental delivery format",
					request: testenv.GraphQLRequest{
						Query:  deferQuery,
						Header: http.Header{"Accept": []string{"multipart/mixed;deferSpec=20220824,application/graphql-response+json,application/json;q=0.9"}},
					},
					expectedBody:   `{"errors":[{"message":"the router received a query with the @defer directive but the client requested the incremental delivery format 'deferSpec=20220824', while the router implements 'incrementalSpec=v0.2'. Use a client that supports this format, for example Apollo Client with GraphQL17Alpha9Handler","extensions":{"code":"DEFER_UNSUPPORTED_SPEC"}}]}`,
					expectedStatus: http.StatusNotAcceptable,
				},
			})

			t.Run("415 for multipart request when file upload is disabled", func(t *testing.T) {
				res, err := xEnv.MakeGraphQLRequestAsMultipartForm(testenv.GraphQLRequest{
					Query:     "mutation($files: [Upload!]!) { multipleUpload(files: $files)}",
					Variables: []byte(`{"files":[null]}`),
					Files:     make([]testenv.FileUpload, 1),
				})
				require.NoError(t, err)
				require.Equal(t, `{"errors":[{"message":"file upload disabled"}]}`, res.Body)
				require.Equal(t, http.StatusUnsupportedMediaType, res.Response.StatusCode)
			})

			t.Run("405 with Allow header for mutation over GET", func(t *testing.T) {
				res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{Query: mutation})
				require.NoError(t, err)
				require.Equal(t, `{"errors":[{"message":"Mutations can only be sent over HTTP POST"}]}`, res.Body)
				require.Equal(t, http.StatusMethodNotAllowed, res.Response.StatusCode)
				require.Equal(t, http.MethodPost, res.Response.Header.Get("Allow"))
			})
		})
	})

	t.Run("with safelist", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.UseGraphQLOverHTTPStatusCodes = true
				securityConfiguration.BlockPersistedOperations = blockedBy("persisted")
			},
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Safelist: config.SafelistConfiguration{Enabled: true},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			run(t, xEnv, []testCase{
				{
					name: "403 for operation not on the safelist",
					request: testenv.GraphQLRequest{
						OperationName: []byte(`"Employees"`),
						Query:         `query Employees { employees { id details { forename } } }`,
						Header:        http.Header{"Graphql-Client-Name": []string{"my-client"}},
					},
					expectedBody:   `{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`,
					expectedStatus: http.StatusForbidden,
				},
				{
					name: "403 for blocked persisted operation",
					request: testenv.GraphQLRequest{
						OperationName: []byte(`"Employees"`),
						Extensions:    []byte(`{"persistedQuery":{"version":1,"sha256Hash":"` + persistedHash + `"}}`),
						Header:        http.Header{"Graphql-Client-Name": []string{"my-client"}, "X-Block": []string{"persisted"}},
					},
					expectedBody:   `{"errors":[{"message":"persisted operation is blocked"}]}`,
					expectedStatus: http.StatusForbidden,
				},
			})
		})
	})
}
