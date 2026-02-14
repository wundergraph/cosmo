package module_test

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	integration "github.com/wundergraph/cosmo/router-tests"
	contexterror "github.com/wundergraph/cosmo/router-tests/modules/context-error"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestContextErrorModule(t *testing.T) {
	t.Parallel()

	t.Run("error is captured in context when authentication fails", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := integration.ConfigureAuth(t)
		accessController, err := core.NewAccessController(core.AccessControllerOptions{
			Authenticators:           authenticators,
			AuthenticationRequired:   true,
			SkipIntrospectionQueries: false,
			IntrospectionSkipSecret:  "",
		})
		require.NoError(t, err)

		cfg := config.Config{
			Modules: map[string]interface{}{
				"contextErrorModule": contexterror.ContextErrorModule{},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&contexterror.ContextErrorModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with an invalid token should fail
			header := http.Header{
				"Authorization": []string{"Bearer invalid"},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`{"query":"{ employees { id } }"}`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Contains(t, string(data), "unauthorized")

			// Verify the X-Has-Error header is set when authentication fails
			require.Equal(t, "true", res.Header.Get("X-Has-Error"))
		})
	})

	t.Run("error is captured in context when subgraph fails", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Modules: map[string]interface{}{
				"contextErrorModule": contexterror.ContextErrorModule{},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&contexterror.ContextErrorModule{}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusInternalServerError)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Internal server error","extensions":{"code":"INTERNAL_SERVER_ERROR"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})

			// Verify the response contains errors from the subgraph failure
			require.Contains(t, res.Body, "errors")
			require.Contains(t, res.Body, "Failed to fetch from Subgraph")

			// Verify the X-Has-Error header is set when subgraph fails
			require.Equal(t, "true", res.Response.Header.Get("X-Has-Error"))
		})
	})

	t.Run("in case of errors in the response, cache control is set to no-cache", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
			},
			Subgraphs: testenv.SubgraphsConfig{
				GlobalMiddleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.WriteHeader(http.StatusInternalServerError)
					})
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(`{"query":"{ employees { id } }"}`))
			require.NoError(t, err)
			require.Equal(t, "no-store, no-cache, must-revalidate", res.Header.Get("Cache-Control"))
			defer res.Body.Close()
			body, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees', Reason: empty response.","extensions":{"statusCode":500}}],"data":{"employees":null}}`, string(body))
		})
	})

	t.Run("no error in context when request succeeds", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Modules: map[string]interface{}{
				"contextErrorModule": contexterror.ContextErrorModule{},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&contexterror.ContextErrorModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query MyQuery { employee(id: 1) { id } }`,
			})

			require.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)

			// Verify the X-Has-Error header is NOT set when request succeeds
			require.Empty(t, res.Response.Header.Get("X-Has-Error"))
		})
	})
}
