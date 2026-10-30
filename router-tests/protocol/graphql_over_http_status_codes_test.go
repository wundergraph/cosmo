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

	// requireStatus sends the request and checks the error body and status code of the response.
	requireStatus := func(t *testing.T, xEnv *testenv.Environment, request testenv.GraphQLRequest, expectedBody string, expectedStatus int) {
		t.Helper()
		res, err := xEnv.MakeGraphQLRequest(request)
		require.NoError(t, err)
		require.Equal(t, expectedBody, res.Body)
		require.Equal(t, expectedStatus, res.Response.StatusCode)
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
			t.Run("403 for blocked mutation", func(t *testing.T) {
				requireStatus(t, xEnv,
					testenv.GraphQLRequest{Query: mutation, Header: http.Header{"X-Block": []string{"mutation"}}},
					`{"errors":[{"message":"operation type 'mutation' is blocked"}]}`,
					http.StatusForbidden,
				)
			})

			t.Run("403 for blocked subscription over SSE", func(t *testing.T) {
				requireStatus(t, xEnv,
					testenv.GraphQLRequest{
						Query:  `subscription { currentTime { unixTime } }`,
						Header: http.Header{"X-Block": []string{"subscription"}, "Accept": []string{"text/event-stream"}},
					},
					"event: next\ndata: {\"errors\":[{\"message\":\"operation type 'subscription' is blocked\"}]}",
					http.StatusForbidden,
				)
			})

			t.Run("403 for blocked non-persisted operation", func(t *testing.T) {
				requireStatus(t, xEnv,
					testenv.GraphQLRequest{Query: `{ employees { id } }`, Header: http.Header{"X-Block": []string{"non-persisted"}}},
					`{"errors":[{"message":"non-persisted operation is blocked"}]}`,
					http.StatusForbidden,
				)
			})

			t.Run("403 for introspection when disabled", func(t *testing.T) {
				requireStatus(t, xEnv,
					testenv.GraphQLRequest{Query: `{ __schema { __typename } }`},
					`{"errors":[{"message":"GraphQL introspection is disabled by Cosmo Router, but the query contained __schema or __type. To enable introspection, set introspection_enabled: true in the Router configuration"}]}`,
					http.StatusForbidden,
				)
			})

			t.Run("422 for missing operation name with multiple anonymous operations", func(t *testing.T) {
				requireStatus(t, xEnv,
					testenv.GraphQLRequest{Query: `{ employees { id } } { employees { id } }`},
					`{"errors":[{"message":"operation name is required when multiple operations are defined"}]}`,
					http.StatusUnprocessableEntity,
				)
			})

			t.Run("422 for operation name not found on named operation", func(t *testing.T) {
				requireStatus(t, xEnv,
					testenv.GraphQLRequest{Query: `query Exists { employees { id } }`, OperationName: []byte(`"Missing"`)},
					`{"errors":[{"message":"operation with name 'Missing' not found"}]}`,
					http.StatusUnprocessableEntity,
				)
			})

			t.Run("422 for operation name not found on anonymous operation", func(t *testing.T) {
				requireStatus(t, xEnv,
					testenv.GraphQLRequest{Query: `{ employees { id } }`, OperationName: []byte(`"Missing"`)},
					`{"errors":[{"message":"operation with name 'Missing' not found"}]}`,
					http.StatusUnprocessableEntity,
				)
			})

			t.Run("422 for required variable not provided", func(t *testing.T) {
				requireStatus(t, xEnv,
					testenv.GraphQLRequest{Query: `query Find($criteria: SearchInput!) { findEmployees(criteria: $criteria) { id } }`},
					`{"errors":[{"message":"Variable \"$criteria\" of required type \"SearchInput!\" was not provided."}]}`,
					http.StatusUnprocessableEntity,
				)
			})

			t.Run("422 for variable that cannot be coerced", func(t *testing.T) {
				requireStatus(t, xEnv,
					testenv.GraphQLRequest{
						Query:     `query Find($criteria: SearchInput!) { findEmployees(criteria: $criteria) { id } }`,
						Variables: []byte(`{"criteria":{"nationality":1}}`),
					},
					`{"errors":[{"message":"Variable \"$criteria\" got invalid value 1 at \"criteria.nationality\"; Enum \"Nationality\" cannot represent non-string value: 1."}]}`,
					http.StatusUnprocessableEntity,
				)
			})

			t.Run("422 for persisted query when persisted operations are disabled", func(t *testing.T) {
				requireStatus(t, xEnv,
					testenv.GraphQLRequest{
						Extensions: []byte(`{"persistedQuery":{"version":1,"sha256Hash":"` + persistedHash + `"}}`),
					},
					`{"errors":[{"message":"could not resolve persisted query, feature is not configured"}]}`,
					http.StatusUnprocessableEntity,
				)
			})

			t.Run("406 for @defer without multipart/mixed in Accept", func(t *testing.T) {
				requireStatus(t, xEnv,
					testenv.GraphQLRequest{Query: deferQuery, Header: http.Header{"Accept": []string{"application/json"}}},
					`{"errors":[{"message":"the router received a query with the @defer directive but the client does not accept multipart/mixed HTTP responses. To enable @defer support, add the HTTP header 'Accept: multipart/mixed'","extensions":{"code":"DEFER_BAD_HEADER"}}]}`,
					http.StatusNotAcceptable,
				)
			})

			t.Run("406 for @defer with unsupported incremental delivery format", func(t *testing.T) {
				requireStatus(t, xEnv,
					testenv.GraphQLRequest{
						Query:  deferQuery,
						Header: http.Header{"Accept": []string{"multipart/mixed;deferSpec=20220824,application/graphql-response+json,application/json;q=0.9"}},
					},
					`{"errors":[{"message":"the router received a query with the @defer directive but the client requested the incremental delivery format 'deferSpec=20220824', while the router implements 'incrementalSpec=v0.2'. Use a client that supports this format, for example Apollo Client with GraphQL17Alpha9Handler","extensions":{"code":"DEFER_UNSUPPORTED_SPEC"}}]}`,
					http.StatusNotAcceptable,
				)
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
			t.Run("403 for operation not on the safelist", func(t *testing.T) {
				requireStatus(t, xEnv,
					testenv.GraphQLRequest{
						OperationName: []byte(`"Employees"`),
						Query:         `query Employees { employees { id details { forename } } }`,
						Header:        http.Header{"Graphql-Client-Name": []string{"my-client"}},
					},
					`{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`,
					http.StatusForbidden,
				)
			})

			t.Run("403 for blocked persisted operation", func(t *testing.T) {
				requireStatus(t, xEnv,
					testenv.GraphQLRequest{
						OperationName: []byte(`"Employees"`),
						Extensions:    []byte(`{"persistedQuery":{"version":1,"sha256Hash":"` + persistedHash + `"}}`),
						Header:        http.Header{"Graphql-Client-Name": []string{"my-client"}, "X-Block": []string{"persisted"}},
					},
					`{"errors":[{"message":"persisted operation is blocked"}]}`,
					http.StatusForbidden,
				)
			})
		})
	})
}
