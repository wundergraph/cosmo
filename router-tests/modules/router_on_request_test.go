package module_test

import (
	"encoding/json"
	"net/http"
	"testing"

	router_on_request "github.com/wundergraph/cosmo/router-tests/modules/router-on-request"
	"go.uber.org/zap/zapcore"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestRouterOnRequestHook(t *testing.T) {
	t.Parallel()

	t.Run("Test RouterOnRequest hook is called", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"routerOnRequestModule": router_on_request.RouterOnRequestModule{},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&router_on_request.RouterOnRequestModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employees { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)

			requestLog := xEnv.Observer().FilterMessage("RouterOnRequest Hook has been run")
			assert.Len(t, requestLog.All(), 1)
			assert.Equal(t, 200, res.Response.StatusCode)
			assert.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
		})
	})

	t.Run("Test RouterOnRequest hook is used to rewrite auth logic", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := configureAuth(t)
		token, err := authServer.Token(map[string]any{})

		require.NoError(t, err)

		onRequestModule := router_on_request.RouterOnRequestModule{
			TokenContainer: &router_on_request.TokenContainer{},
		}

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"routerOnRequestModule": onRequestModule,
			},
		}

		accessController, err := core.NewAccessController(core.AccessControllerOptions{
			Authenticators:             authenticators,
			AuthenticationRequired:     true,
			IntrospectionAuthMode:      core.IntrospectionAuthModeFull,
			IntrospectionAuthSkipToken: "",
		})
		require.NoError(t, err)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&router_on_request.RouterOnRequestModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			initialRes, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employees { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusUnauthorized, initialRes.Response.StatusCode)
			initialRequestLog := xEnv.Observer().FilterMessage("RouterOnRequest Hook has been run")
			assert.Len(t, initialRequestLog.All(), 1)

			onRequestModule.SetToken(token)

			retryRes, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employees { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, retryRes.Response.StatusCode)
			retryRequestLog := xEnv.Observer().FilterMessage("RouterOnRequest Hook has been run")
			assert.Len(t, retryRequestLog.All(), 2)
		})
	})
}
