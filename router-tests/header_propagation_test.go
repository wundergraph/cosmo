package integration

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestHeaderPropagation(t *testing.T) {
	t.Parallel()

	const queryEmployeeWithHobby = `{
	  employee(id: 1) {
		id
		hobbies {
		  ... on Gaming {
			name
		  }
		}
	  }
	}`

	global := func(alg config.ResponseHeaderRuleAlgorithm) []core.Option {
		return []core.Option{
			core.WithHeaderRules(config.HeaderRules{
				All: &config.GlobalHeaderRule{
					Response: []*config.ResponseHeaderRule{
						{
							Operation: config.HeaderRuleOperationPropagate,
							Named:     "X-Custom-Header",
							Algorithm: alg,
						},
					},
				},
			}),
		}
	}

	partial := func(alg config.ResponseHeaderRuleAlgorithm) []core.Option {
		return []core.Option{
			core.WithHeaderRules(config.HeaderRules{
				Subgraphs: map[string]*config.GlobalHeaderRule{
					"employees": {
						Response: []*config.ResponseHeaderRule{
							{
								Operation: config.HeaderRuleOperationPropagate,
								Named:     "X-Custom-Header",
								Algorithm: alg,
							},
						},
					},
				},
			}),
		}
	}

	local := func(alg config.ResponseHeaderRuleAlgorithm) []core.Option {
		return []core.Option{
			core.WithHeaderRules(config.HeaderRules{
				Subgraphs: map[string]*config.GlobalHeaderRule{
					"employees": {
						Response: []*config.ResponseHeaderRule{
							{
								Operation: config.HeaderRuleOperationPropagate,
								Named:     "X-Custom-Header",
								Algorithm: alg,
							},
						},
					},
					"hobbies": {
						Response: []*config.ResponseHeaderRule{
							{
								Operation: config.HeaderRuleOperationPropagate,
								Named:     "X-Custom-Header",
								Algorithm: alg,
							},
						},
					},
				},
			}),
		}
	}

	subgraphsPropagateCustomHeader := testenv.SubgraphsConfig{
		Employees: testenv.SubgraphConfig{
			Middleware: func(handler http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("X-Custom-Header", "employee-value")
					handler.ServeHTTP(w, r)
				})
			},
		},
		Hobbies: testenv.SubgraphConfig{
			Middleware: func(handler http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("X-Custom-Header", "hobby-value")
					handler.ServeHTTP(w, r)
				})
			},
		},
	}

	t.Run("propagate no", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			Subgraphs: subgraphsPropagateCustomHeader,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: queryEmployeeWithHobby,
			})
			ch := res.Response.Header.Get("X-Custom-Header")
			require.Equal(t, "", ch)
			require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
		})
	})

	t.Run("global last write wins", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: global(config.ResponseHeaderRuleAlgorithmLastWrite),
			Subgraphs:     subgraphsPropagateCustomHeader,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: queryEmployeeWithHobby,
			})
			ch := res.Response.Header.Get("X-Custom-Header")
			require.Equal(t, "hobby-value", ch)
			require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
		})
	})

	t.Run("local last write wins", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: local(config.ResponseHeaderRuleAlgorithmLastWrite),
			Subgraphs:     subgraphsPropagateCustomHeader,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: queryEmployeeWithHobby,
			})
			ch := res.Response.Header.Get("X-Custom-Header")
			require.Equal(t, "hobby-value", ch)
			require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
		})
	})

	t.Run("partial last write wins", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: partial(config.ResponseHeaderRuleAlgorithmLastWrite),
			Subgraphs:     subgraphsPropagateCustomHeader,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: queryEmployeeWithHobby,
			})
			ch := res.Response.Header.Get("X-Custom-Header")
			require.Equal(t, "employee-value", ch)
			require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
		})
	})
}
