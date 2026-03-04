package module_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	forbiddenhandler "github.com/wundergraph/cosmo/router-tests/modules/custom-forbidden-handler"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestForbiddenHandlerModule(t *testing.T) {
	t.Parallel()

	moduleCfg := config.Config{
		Modules: map[string]interface{}{
			"forbiddenHandlerModule": forbiddenhandler.ForbiddenHandlerModule{},
		},
	}
	routerOpts := []core.Option{
		core.WithModulesConfig(moduleCfg.Modules),
		core.WithCustomModules(&forbiddenhandler.ForbiddenHandlerModule{}),
	}

	t.Run("subgraph 403 returns standardized forbidden response", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: routerOpts,
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusForbidden)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Insufficient permissions to fulfill the request.","extensions":{"code":403,"remedy":null,"serviceName":"xxx"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.NoError(t, err)

			assert.Equal(t, http.StatusForbidden, res.Response.StatusCode)
			assert.JSONEq(t, `{"errors":[{"message":"Insufficient permissions to fulfill the request.","extensions":{"code":"FORBIDDEN"}}]}`, res.Body)
		})
	})

	t.Run("multi-subgraph query with one 403 returns no partial data", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: routerOpts,
			Subgraphs: testenv.SubgraphsConfig{
				// Products subgraph returns 403, employees subgraph works normally
				Products: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusForbidden)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Insufficient permissions to fulfill the request.","extensions":{"code":403}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// This query touches both employees (works) and products (403)
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.NoError(t, err)

			// Even though employees subgraph succeeded, the entire response
			// should be the standardized error with no partial data
			assert.Equal(t, http.StatusForbidden, res.Response.StatusCode)
			assert.JSONEq(t, `{"errors":[{"message":"Insufficient permissions to fulfill the request.","extensions":{"code":"FORBIDDEN"}}]}`, res.Body)
		})
	})

	t.Run("no 403 passes response through normally", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: routerOpts,
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
			RouterOptions: routerOpts,
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

			// Should NOT be 403 — the module should not intercept non-403 errors
			assert.NotEqual(t, http.StatusForbidden, res.Response.StatusCode)
			assert.NotContains(t, res.Body, `"code":"FORBIDDEN"`)
		})
	})

	t.Run("all subgraphs return 403", func(t *testing.T) {
		t.Parallel()

		forbidden := func(handler http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"errors":[{"message":"Forbidden","extensions":{"code":403}}]}`))
			})
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: routerOpts,
			Subgraphs: testenv.SubgraphsConfig{
				GlobalMiddleware: forbidden,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.NoError(t, err)

			assert.Equal(t, http.StatusForbidden, res.Response.StatusCode)
			assert.JSONEq(t, `{"errors":[{"message":"Insufficient permissions to fulfill the request.","extensions":{"code":"FORBIDDEN"}}]}`, res.Body)
		})
	})
}
