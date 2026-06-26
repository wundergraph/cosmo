package integration

import (
	_ "embed"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
)

//go:embed testdata/provides_interface_config.json
var providesInterfaceRouterConfigJSONTemplate string

func TestProvidesFieldSetOverInterfaceTypedField(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: providesInterfaceRouterConfigJSONTemplate,
		Subgraphs: testenv.SubgraphsConfig{
			Test1: testenv.SubgraphConfig{
				Middleware: func(_ http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						t.Fatalf("subgraph a should not be used for media query")
					})
				},
			},
			Products: testenv.SubgraphConfig{
				Middleware: func(_ http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						req := readGraphQLRequest(t, r)
						switch req.Query {
						case `{media {__typename ... on Book {id animals {id name}}}}`,
							`{media {__typename ... on Book {id animals {__typename ... on Cat {id name __typename} ... on Dog {id name}}}}}`:
							require.Empty(t, req.Variables)
						default:
							require.Failf(t, "unexpected products request", "query=%s variables=%s", req.Query, string(req.Variables))
						}

						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusOK)
						_, _ = w.Write([]byte(`{"data":{"media":{"__typename":"Book","id":"m1","animals":[{"__typename":"Dog","id":"a1","name":"Fido"},{"__typename":"Cat","id":"a2","name":"Whiskers"}]}}}`))
					})
				},
			},
			Availability: testenv.SubgraphConfig{
				Middleware: func(_ http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						req := readGraphQLRequest(t, r)
						require.Equal(t, `query($representations: [_Any!]!){_entities(representations: $representations){... on Cat {__typename age}}}`, req.Query)
						require.JSONEq(t, `{"representations":[{"__typename":"Cat","id":"a2"}]}`, string(req.Variables))

						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusOK)
						_, _ = w.Write([]byte(`{"data":{"_entities":[{"__typename":"Cat","age":6}]}}`))
					})
				},
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ media { id animals { id name } } }`,
		})

		require.Equal(t, `{"data":{"media":{"id":"m1","animals":[{"id":"a1","name":"Fido"},{"id":"a2","name":"Whiskers"}]}}}`, res.Body)
		require.Equal(t, int64(0), xEnv.SubgraphRequestCount.Test1.Load())
		require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Products.Load())
		require.Equal(t, int64(0), xEnv.SubgraphRequestCount.Availability.Load())

		res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ media { id animals { id name ... on Cat { age } } } }`,
		})

		require.Equal(t, `{"data":{"media":{"id":"m1","animals":[{"id":"a1","name":"Fido"},{"id":"a2","name":"Whiskers","age":6}]}}}`, res.Body)
		require.Equal(t, int64(0), xEnv.SubgraphRequestCount.Test1.Load())
		require.Equal(t, int64(2), xEnv.SubgraphRequestCount.Products.Load())
		require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Availability.Load())
	})
}

func readGraphQLRequest(t *testing.T, r *http.Request) core.GraphQLRequest {
	t.Helper()

	body, err := io.ReadAll(r.Body)
	require.NoError(t, err)

	var req core.GraphQLRequest
	require.NoError(t, json.Unmarshal(body, &req))
	return req
}
