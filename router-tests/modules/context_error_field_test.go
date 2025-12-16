package module_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	contexterror "github.com/wundergraph/cosmo/router-tests/modules/context-error"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestContextErrorModule(t *testing.T) {
	t.Parallel()

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
