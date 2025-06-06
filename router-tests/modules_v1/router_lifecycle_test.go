package my_custom_module

import (
	"encoding/json"
	"net/http"
	"testing"

	"go.uber.org/zap/zapcore"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/modules_v1/my_custom_module"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
)

func TestRouterLifecycleHooks(t *testing.T) {
	t.Parallel()

	t.Run("Test router lifecycle hooks are not called for non-graphql endpoint", func(t *testing.T) {
		t.Parallel()

		myLoggingModule := &my_custom_module.MyOverwriteResponseModule{}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithMyCustomModules(myLoggingModule),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.DebugLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeRequest(http.MethodPost, "/non-graphql-endpoint", nil, nil)
			require.NoError(t, err)

			requestLog := xEnv.Observer().FilterMessage("Firing RouterRequest hooks")
			responseLog := xEnv.Observer().FilterMessage("Firing RouterResponse hooks")
			assert.Len(t, requestLog.All(), 0)
			assert.Len(t, responseLog.All(), 0)
			assert.Equal(t, 404, res.StatusCode)
		})
	})

	t.Run("No regression when no hooks are registered", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.DebugLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employees { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)

			assert.Equal(t, 200, res.Response.StatusCode)
			assert.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
		})
	})

	t.Run("Test router lifecycle hooks are called - on error overwrites response", func(t *testing.T) {
		t.Parallel()

		myLoggingModule := &my_custom_module.MyOverwriteResponseModule{}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithMyCustomModules(myLoggingModule),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.DebugLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employees { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)

			requestLog := xEnv.Observer().FilterMessage("Firing RouterRequest hooks")
			responseLog := xEnv.Observer().FilterMessage("Firing RouterResponse hooks")
			settingResponseLog := xEnv.Observer().FilterMessage("Setting response after router response hooks")

			assert.Len(t, requestLog.All(), 1)
			assert.Len(t, responseLog.All(), 1)
			assert.Len(t, settingResponseLog.All(), 1)

			assert.Equal(t, 202, res.Response.StatusCode)	
			assert.JSONEq(t, `{"error":"graphQL partial failure"}`, res.Body)
		})
	})

}