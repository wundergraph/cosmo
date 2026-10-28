package integration

import (
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/cors"
)

func TestCors(t *testing.T) {
	t.Parallel()

	t.Run("allow all origins allows requests", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketServerReadTimeout = time.Millisecond * 10
			},
			RouterOptions: []core.Option{
				core.WithCors(&cors.Config{
					Enabled:         true,
					AllowAllOrigins: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:      `query { initialPayload }`,
				Extensions: []byte(`{"token":"123"}`),
			}, map[string]string{
				"Origin": "http://example.org",
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"initialPayload":{"extensions":{"token":"123"},"query":"{initialPayload}"}}}`, res.Body)
		})
	})

	t.Run("disallowing origins blocks requests", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCors(&cors.Config{
					Enabled:      true,
					AllowOrigins: []string{"http://example.com"},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:      `query { initialPayload }`,
				Extensions: []byte(`{"token":"123"}`),
			}, map[string]string{
				"Origin": "http://not-example.com",
			})
			require.NoError(t, err)
			require.Equal(t, "", res.Body)
			require.Equal(t, http.StatusForbidden, res.Response.StatusCode)
		})
	})

	t.Run("matching origins succeeds requests", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCors(&cors.Config{
					Enabled:      true,
					AllowOrigins: []string{"http://example.com"},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:      `query { initialPayload }`,
				Extensions: []byte(`{"token":"123"}`),
			}, map[string]string{
				"Origin": "http://example.com",
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"initialPayload":{"extensions":{"token":"123"},"query":"{initialPayload}"}}}`, res.Body)
		})
	})

	t.Run("wildcard expose headers exposes non-standard response headers", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCors(&cors.Config{
					Enabled:         true,
					AllowAllOrigins: true,
					ExposeHeaders:   []string{"*"},
				}),
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Response: []*config.ResponseHeaderRule{
							{
								Operation: config.HeaderRuleOperationPropagate,
								Named:     "X-Trace-Id",
								Algorithm: config.ResponseHeaderRuleAlgorithmLastWrite,
							},
						},
					},
				}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("X-Trace-Id", "trace-123")
							handler.ServeHTTP(w, r)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			}, map[string]string{
				"Origin": "http://example.org",
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, "*", res.Response.Header.Get("Access-Control-Expose-Headers"))
			require.Equal(t, "trace-123", res.Response.Header.Get("X-Trace-Id"))
		})
	})

	t.Run("wildcard matching", func(t *testing.T) {
		t.Parallel()
		t.Run("matching single wildcard succeeds", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCors(&cors.Config{
						Enabled:      true,
						AllowOrigins: []string{"http://example.com/*"},
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
					Query:      `query { initialPayload }`,
					Extensions: []byte(`{"token":"123"}`),
				}, map[string]string{
					"Origin": "http://example.com/test",
				})
				require.NoError(t, err)
				require.Equal(t, `{"data":{"initialPayload":{"extensions":{"token":"123"},"query":"{initialPayload}"}}}`, res.Body)
			})
		})

		t.Run("matching multiple wildcard succeeds", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCors(&cors.Config{
						Enabled:      true,
						AllowOrigins: []string{"http://*example.com:*"},
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
					Query:      `query { initialPayload }`,
					Extensions: []byte(`{"token":"123"}`),
				}, map[string]string{
					"Origin": "http://matching.double.example.com:123/super-scary-extension",
				})
				require.NoError(t, err)
				require.Equal(t, `{"data":{"initialPayload":{"extensions":{"token":"123"},"query":"{initialPayload}"}}}`, res.Body)
			})
		})

		t.Run("matching multiple complex wildcards succeeds", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCors(&cors.Config{
						Enabled:      true,
						AllowOrigins: []string{"http://*example.com:*"},
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
					Query:      `query { initialPayload }`,
					Extensions: []byte(`{"token":"123"}`),
				}, map[string]string{
					"Origin": "http://matching.double.example.com:123/super-scary-extension",
				})
				require.NoError(t, err)
				require.Equal(t, `{"data":{"initialPayload":{"extensions":{"token":"123"},"query":"{initialPayload}"}}}`, res.Body)
			})
		})

		t.Run("matching multiple wildcard fails", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCors(&cors.Config{
						Enabled:      true,
						AllowOrigins: []string{"http://*example.com:*"},
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
					Query:      `query { initialPayload }`,
					Extensions: []byte(`{"token":"123"}`),
				}, map[string]string{
					"Origin": "http://not-matching.double.example.co:123/super-scary-extension",
				})
				require.NoError(t, err)
				require.Equal(t, "", res.Body)
				require.Equal(t, http.StatusForbidden, res.Response.StatusCode)
			})
		})
	})
}
