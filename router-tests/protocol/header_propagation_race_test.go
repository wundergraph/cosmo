package integration

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestHeaderPropagationConcurrentMapWrites(t *testing.T) {
	t.Parallel()

	// Query that hits employees, availability, products, and hobbies subgraphs.
	// The entity resolution for isAvailable, products, and hobbies happens in
	// parallel, which is what creates the concurrent writes to the shared
	// responseHeaderPropagation header map.
	const queryMultipleSubgraphs = `{
	  employees {
		id
		isAvailable
		hobbies {
		  ... on Gaming {
			name
		  }
		}
	  }
	}`

	const expectedResponse = `{"data":{"employees":[{"id":1,"isAvailable":false,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]},{"id":2,"isAvailable":false,"hobbies":[{},{"name":"Counter Strike"},{}]},{"id":3,"isAvailable":false,"hobbies":[{},{},{},{}]},{"id":4,"isAvailable":false,"hobbies":[{},{},{}]},{"id":5,"isAvailable":false,"hobbies":[{},{},{}]},{"id":7,"isAvailable":false,"hobbies":[{"name":"Chess"},{}]},{"id":8,"isAvailable":false,"hobbies":[{},{"name":"Miscellaneous"},{}]},{"id":10,"isAvailable":false,"hobbies":[{},{},{},{},{},{}]},{"id":11,"isAvailable":false,"hobbies":[{}]},{"id":12,"isAvailable":false,"hobbies":[{},{},{"name":"Miscellaneous"},{}]}]}}`

	t.Run("response set rule with parallel subgraph fetches", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Response: []*config.ResponseHeaderRule{
							{
								Operation: config.HeaderRuleOperationSet,
								Name:      "X-Custom-Header",
								Value:     "test-value",
							},
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: queryMultipleSubgraphs,
			})
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, expectedResponse, res.Body)

			require.Equal(t, "test-value", res.Response.Header.Get("X-Custom-Header"), "single request failed")
		})
	})

	t.Run("cache control policy with parallel subgraph fetches", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			CacheControlPolicy: config.CacheControlPolicy{
				Enabled: true,
				Value:   "max-age=300",
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Cache-Control", "max-age=120")
							handler.ServeHTTP(w, r)
						})
					},
				},
				Hobbies: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Cache-Control", "max-age=60")
							handler.ServeHTTP(w, r)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: queryMultipleSubgraphs,
			})
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, expectedResponse, res.Body)

			require.Equal(t, "max-age=60", res.Response.Header.Get("Cache-Control"), "single request failed")
		})
	})

	t.Run("multiple response set rules with parallel subgraph fetches", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Response: []*config.ResponseHeaderRule{
							{
								Operation: config.HeaderRuleOperationSet,
								Name:      "X-Header-A",
								Value:     "value-a",
							},
							{
								Operation: config.HeaderRuleOperationSet,
								Name:      "X-Header-B",
								Value:     "value-b",
							},
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: queryMultipleSubgraphs,
			})
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, expectedResponse, res.Body)

			require.Equal(t, "value-a", res.Response.Header.Get("X-Header-A"), "single request failed")
			require.Equal(t, "value-b", res.Response.Header.Get("X-Header-B"), "single request failed")
		})
	})
}
