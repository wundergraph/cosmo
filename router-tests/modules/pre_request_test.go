package module_test

import (
	"encoding/json"
	"github.com/wundergraph/cosmo/router-tests/modules/pre-request-module"
	"go.uber.org/zap/zapcore"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestPreRequestHook(t *testing.T) {
	t.Parallel()

	t.Run("Test PreRequestMiddleware hook is called", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"preRequestModule": pre_request_module.PreRequestModule{},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&pre_request_module.PreRequestModule{}),
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

			requestLog := xEnv.Observer().FilterMessage("PreRequest Hook has been run")
			assert.Len(t, requestLog.All(), 1)
			assert.Equal(t, 200, res.Response.StatusCode)
			assert.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
		})
	})

	t.Run("Test PreRequestMiddleware hook is used to rewrite auth logic", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := configureAuth(t)
		token, err := authServer.Token(map[string]any{})

		require.NoError(t, err)

		preRequestModule := pre_request_module.PreRequestModule{
			TokenContainer: &pre_request_module.TokenContainer{},
		}

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"preRequestModule": preRequestModule,
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&pre_request_module.PreRequestModule{}),
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
			initialRequestLog := xEnv.Observer().FilterMessage("PreRequest Hook has been run")
			assert.Len(t, initialRequestLog.All(), 1)

			preRequestModule.SetToken(token)

			retryRes, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employees { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.Equal(t, http.StatusOK, retryRes.Response.StatusCode)
			retryRequestLog := xEnv.Observer().FilterMessage("PreRequest Hook has been run")
			assert.Len(t, retryRequestLog.All(), 2)
		})
	})
}
