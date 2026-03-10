package module_test

import (
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	forbiddenhandler "github.com/wundergraph/cosmo/router-tests/modules/custom-forbidden-handler"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// expectedForbiddenBody is the standardised response the module must produce
// whenever any subgraph returns a 403.
const expectedForbiddenBody = `{"errors":[{"message":"Insufficient permissions to fulfill the request.","extensions":{"errorCode":"FORBIDDEN"}}],"data":null}`

func forbiddenModuleOpts() []core.Option {
	return []core.Option{
		core.WithModulesConfig(map[string]interface{}{
			"forbiddenHandlerModule": forbiddenhandler.ForbiddenHandlerModule{},
		}),
		core.WithCustomModules(&forbiddenhandler.ForbiddenHandlerModule{}),
	}
}

// forbiddenMiddleware returns a subgraph middleware that replies with an HTTP 403.
func forbiddenMiddleware() func(http.Handler) http.Handler {
	return func(handler http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"errors":[{"message":"Insufficient permissions to fulfill the request.","extensions":{"code":403,"remedy":null,"serviceName":"xxx"}}]}`))
		})
	}
}

// forbiddenMiddlewareWithCounter is like forbiddenMiddleware but also increments
// an atomic counter so tests can verify how many calls were received.
func forbiddenMiddlewareWithCounter(counter *atomic.Int32) func(http.Handler) http.Handler {
	return func(handler http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			counter.Add(1)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"errors":[{"message":"Forbidden","extensions":{"code":403}}]}`))
		})
	}
}

// countingMiddleware wraps the default handler but increments a counter.
func countingMiddleware(counter *atomic.Int32) func(http.Handler) http.Handler {
	return func(handler http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			counter.Add(1)
			handler.ServeHTTP(w, r)
		})
	}
}

// modifySubgraphErrorPropagation returns a config modifier that puts the error
// pipeline into passthrough mode with only "errorCode" allowed in extensions,
// matching the desired output format.
func modifySubgraphErrorPropagation() func(*config.SubgraphErrorPropagationConfiguration) {
	return func(cfg *config.SubgraphErrorPropagationConfiguration) {
		cfg.Enabled = true
		cfg.Mode = config.SubgraphErrorPropagationModePassthrough
		cfg.AllowedExtensionFields = []string{"errorCode"}
		cfg.PropagateStatusCodes = false
	}
}

func TestForbiddenHandlerModule(t *testing.T) {
	t.Parallel()

	t.Run("subgraph HTTP 403 returns standardised forbidden response", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:                  forbiddenModuleOpts(),
			ModifySubgraphErrorPropagation: modifySubgraphErrorPropagation(),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: forbiddenMiddleware(),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.NoError(t, err)

			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.JSONEq(t, expectedForbiddenBody, res.Body)
		})
	})

	t.Run("subgraph returns 200 with GraphQL error extensions.code=403 in body", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:                  forbiddenModuleOpts(),
			ModifySubgraphErrorPropagation: modifySubgraphErrorPropagation(),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Insufficient permissions to fulfill the request.","extensions":{"code":403,"remedy":null,"serviceName":"xxx"}}],"data":{"data":null}}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.NoError(t, err)

			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.JSONEq(t, expectedForbiddenBody, res.Body)
		})
	})

	t.Run("subgraph returns 200 with GraphQL error extensions.errorCode=FORBIDDEN", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:                  forbiddenModuleOpts(),
			ModifySubgraphErrorPropagation: modifySubgraphErrorPropagation(),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Insufficient permissions to fulfill the request.","extensions":{"errorCode":"FORBIDDEN"}}],"data":null}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.NoError(t, err)

			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.JSONEq(t, expectedForbiddenBody, res.Body)
		})
	})

	t.Run("multi-subgraph query with one 403 returns no partial data", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:                  forbiddenModuleOpts(),
			ModifySubgraphErrorPropagation: modifySubgraphErrorPropagation(),
			Subgraphs: testenv.SubgraphsConfig{
				// Hobbies subgraph returns 403, employees subgraph works normally
				Hobbies: testenv.SubgraphConfig{
					Middleware: forbiddenMiddleware(),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// This query touches both employees (works) and hobbies (403)
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employee(id: 1) { id hobbies { ... on Exercise { category } } } }`,
			})
			require.NoError(t, err)

			// Even though the employees subgraph succeeded, the entire response
			// should be the standardised error with no partial data.
			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.JSONEq(t, expectedForbiddenBody, res.Body)
		})
	})

	t.Run("all subgraphs return 403", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:                  forbiddenModuleOpts(),
			ModifySubgraphErrorPropagation: modifySubgraphErrorPropagation(),
			Subgraphs: testenv.SubgraphsConfig{
				GlobalMiddleware: forbiddenMiddleware(),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employee(id: 1) { id hobbies { ... on Exercise { category } } } }`,
			})
			require.NoError(t, err)

			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.JSONEq(t, expectedForbiddenBody, res.Body)
		})
	})

	t.Run("no 403 passes response through normally", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:                  forbiddenModuleOpts(),
			ModifySubgraphErrorPropagation: modifySubgraphErrorPropagation(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employee(id: 1) { id } }`,
			})
			require.NoError(t, err)

			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)
		})
	})

	t.Run("non-403 subgraph error is not intercepted", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:                  forbiddenModuleOpts(),
			ModifySubgraphErrorPropagation: modifySubgraphErrorPropagation(),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusInternalServerError)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Internal server error"}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.NoError(t, err)

			// Should NOT be the forbidden response — error passes through the
			// normal pipeline unmodified by the module.
			assert.JSONEq(t,
				`{"errors":[{"message":"Internal server error"}],"data":{"employees":null}}`,
				res.Body,
			)
		})
	})

	t.Run("short-circuits subsequent subgraph calls after 403", func(t *testing.T) {
		t.Parallel()

		var employeesCallCount atomic.Int32
		var hobbiesCallCount atomic.Int32

		testenv.Run(t, &testenv.Config{
			RouterOptions:                  forbiddenModuleOpts(),
			ModifySubgraphErrorPropagation: modifySubgraphErrorPropagation(),
			Subgraphs: testenv.SubgraphsConfig{
				// Employees is called first (root query) and returns 403.
				Employees: testenv.SubgraphConfig{
					Middleware: forbiddenMiddlewareWithCounter(&employeesCallCount),
				},
				// Hobbies would be called as a dependent fetch — should be short-circuited.
				Hobbies: testenv.SubgraphConfig{
					Middleware: countingMiddleware(&hobbiesCallCount),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employee(id: 1) { id hobbies { ... on Exercise { category } } } }`,
			})
			require.NoError(t, err)

			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.JSONEq(t, expectedForbiddenBody, res.Body)

			// The employees subgraph was called (and returned 403).
			assert.Equal(t, int32(1), employeesCallCount.Load(), "employees subgraph should have been called once")
			// The hobbies subgraph should have been short-circuited and never called.
			assert.Equal(t, int32(0), hobbiesCallCount.Load(), "hobbies subgraph should have been short-circuited")
		})
	})

	t.Run("ALLOWED_EXTENSION_FIELDS filters non-forbidden subgraph errors", func(t *testing.T) {
		t.Parallel()

		// This test verifies that the router's ALLOWED_EXTENSION_FIELDS config
		// works correctly for errors that are NOT forbidden (and thus flow through
		// the normal pipeline without module interception).
		testenv.Run(t, &testenv.Config{
			RouterOptions: forbiddenModuleOpts(),
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.AllowedExtensionFields = []string{"errorCode"}
				cfg.PropagateStatusCodes = false
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Something went wrong","extensions":{"errorCode":"SOME_ERROR","notAllowed":"secret","remedy":"retry"}}],"data":{"employees":null}}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.NoError(t, err)

			// The non-forbidden error flows through the pipeline: only "errorCode"
			// survives the AllowedExtensionFields filter; "notAllowed" and "remedy"
			// are stripped.
			assert.JSONEq(t,
				`{"errors":[{"message":"Something went wrong","extensions":{"errorCode":"SOME_ERROR"}}],"data":{"employees":null}}`,
				res.Body,
			)
		})
	})

	// This test reproduces the exact scenario from the bug report:
	// - Query spans 2 subgraphs (employees + hobbies)
	// - One subgraph returns HTTP 200 with a GraphQL error containing
	//   extensions.errorCode:"FORBIDDEN" plus extra fields (code, serviceName, statusCode)
	// - WITHOUT the module the router would produce duplicated errors for
	//   BOTH subgraphs and unfiltered extensions (code, serviceName, statusCode)
	// - WITH the module: single error, only errorCode survives, data:null
	t.Run("fixes reported duplication and unfiltered extensions on HTTP 200 with errorCode FORBIDDEN", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:                  forbiddenModuleOpts(),
			ModifySubgraphErrorPropagation: modifySubgraphErrorPropagation(),
			Subgraphs: testenv.SubgraphsConfig{
				// Hobbies subgraph returns HTTP 200 with a GraphQL error —
				// the exact shape from the bug report.
				Hobbies: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Insufficient permissions to fulfill the request.","extensions":{"errorCode":"FORBIDDEN","code":403,"serviceName":"hobbies","statusCode":200}}],"data":null}`))
						})
					},
				},
				// Employees subgraph works normally.
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employee(id: 1) { id hobbies { ... on Exercise { category } } } }`,
			})
			require.NoError(t, err)

			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			// Must be a SINGLE error (not duplicated per subgraph) with only
			// "errorCode" in extensions (not code, serviceName, statusCode)
			// and data:null (no partial data from the successful employees subgraph).
			assert.JSONEq(t, expectedForbiddenBody, res.Body)
		})
	})

	// Baseline: same scenario WITHOUT the module to show the broken behavior
	// the module is designed to fix: duplicated errors and unfiltered extensions.
	t.Run("baseline without module: duplicated errors and unfiltered extensions", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			// No module — default router behavior.
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				// Allow all extension fields to mirror the user's config.
				cfg.AllowAllExtensionFields = true
				cfg.PropagateStatusCodes = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Hobbies: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Insufficient permissions to fulfill the request.","extensions":{"errorCode":"FORBIDDEN","code":403}}],"data":null}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employee(id: 1) { id hobbies { ... on Exercise { category } } } }`,
			})
			require.NoError(t, err)

			// Without the module, the error is propagated with ALL extension
			// fields (errorCode, code, statusCode) and data contains partial
			// results from the successful employees subgraph. This is the broken
			// behavior the module fixes.
			assert.JSONEq(t,
				`{"errors":[{"message":"Insufficient permissions to fulfill the request.","extensions":{"errorCode":"FORBIDDEN","code":403,"statusCode":200}}],"data":{"employee":{"id":1,"hobbies":null}}}`,
				res.Body,
			)
		})
	})

	t.Run("parallel subgraph fetches both returning 403 produce single error", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:                  forbiddenModuleOpts(),
			ModifySubgraphErrorPropagation: modifySubgraphErrorPropagation(),
			Subgraphs: testenv.SubgraphsConfig{
				// Both subgraphs return 403 — fetched in parallel (independent root fields)
				Employees: testenv.SubgraphConfig{
					Middleware: forbiddenMiddleware(),
				},
				Products: testenv.SubgraphConfig{
					Middleware: forbiddenMiddleware(),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employees { id } productTypes { __typename } }`,
			})
			require.NoError(t, err)

			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			// Must be a SINGLE error even though two parallel subgraphs both returned 403
			assert.JSONEq(t, expectedForbiddenBody, res.Body)
		})
	})

	t.Run("module produces same response regardless of AllowAllExtensionFields config", func(t *testing.T) {
		t.Parallel()

		// With AllowAllExtensionFields the router pipeline would normally let
		// serviceName, statusCode, code ("DOWNSTREAM_SERVICE_ERROR"), etc.
		// through. The module must still produce the exact same standardised
		// response because it writes forbiddenErrorBody directly, bypassing
		// whatever the pipeline decorated.
		testenv.Run(t, &testenv.Config{
			RouterOptions: forbiddenModuleOpts(),
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.AllowAllExtensionFields = true
				cfg.PropagateStatusCodes = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: forbiddenMiddleware(),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.NoError(t, err)

			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			// Must be the exact standardised body — no extra fields like
			// serviceName, statusCode, or code:"DOWNSTREAM_SERVICE_ERROR".
			assert.JSONEq(t, expectedForbiddenBody, res.Body)
		})
	})

}
