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

	t.Run("router_lifecycle_hooks_not_called_for_non_graphql_endpoint", func(t *testing.T) {
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

	t.Run("no_regression_when_no_hooks_are_registered", func(t *testing.T) {
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

			requestLog := xEnv.Observer().FilterMessage("Firing RouterRequest hooks")
			responseLog := xEnv.Observer().FilterMessage("Firing RouterResponse hooks")
			assert.Len(t, requestLog.All(), 1)
			assert.Len(t, responseLog.All(), 0)

			assert.Equal(t, 200, res.Response.StatusCode)
			assert.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
		})
	})

	t.Run("router_lifecycle_hooks_overwrites_response", func(t *testing.T) {
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
			settingResponseLog := xEnv.Observer().FilterMessage("Setting response after RouterResponse hooks")

			assert.Len(t, requestLog.All(), 1)
			assert.Len(t, responseLog.All(), 1)
			assert.Len(t, settingResponseLog.All(), 1)

			assert.Equal(t, 202, res.Response.StatusCode)	
			assert.JSONEq(t, `{"error":"graphQL partial failure"}`, res.Body)
		})
	})

	t.Run("router_lifecycle_hooks_authorization", func(t *testing.T) {
		t.Parallel()

		myAuthorizationModule := &my_custom_module.AuthorizationModule{}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithMyCustomModules(myAuthorizationModule),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employees { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)

			assert.Equal(t, 403, res.Response.StatusCode)
			assert.JSONEq(t, `{"error":"unauthorized"}`, res.Body)
		})
	})
}

func TestOperationLifecycleHooks(t *testing.T) {
	t.Parallel()

	t.Run("operation_lifecycle_hooks_detailed_client_info", func(t *testing.T) {
		t.Parallel()

		myDetailedClientModule := &my_custom_module.DetailedClientModule{}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithMyCustomModules(myDetailedClientModule),
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

			operationRequestLog := xEnv.Observer().FilterMessage("OnOperationRequest")
			operationResponseLog := xEnv.Observer().FilterMessage("OnOperationResponse")
			assert.Len(t, operationRequestLog.All(), 1)
			assert.Len(t, operationResponseLog.All(), 1)

			clientInfo := operationResponseLog.All()[0].ContextMap()["clientInfo"].(*my_custom_module.DetailedClientInfo)
			assert.Equal(t, "detailed-client", clientInfo.Name)
			assert.Equal(t, "1.0.0", clientInfo.Version)
			assert.Equal(t, "iOS", clientInfo.DeviceOS)
			assert.Equal(t, "My App", clientInfo.AppName)

			assert.Equal(t, 200, res.Response.StatusCode)
			assert.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
		})
	})

	t.Run("operation_lifecycle_hooks_metrics", func(t *testing.T) {
		t.Parallel()

		myMetricsModule := &my_custom_module.MetricsModule{}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithMyCustomModules(myMetricsModule),
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

			operationPreParseLog := xEnv.Observer().FilterMessage("OnOperationPreParse")
			operationPostParseLog := xEnv.Observer().FilterMessage("OnOperationPostParse")
			assert.Len(t, operationPreParseLog.All(), 1)
			assert.Len(t, operationPostParseLog.All(), 1)


			operationPreNormalizeLog := xEnv.Observer().FilterMessage("OnOperationPreNormalize")
			operationPostNormalizeLog := xEnv.Observer().FilterMessage("OnOperationPostNormalize")
			assert.Len(t, operationPreNormalizeLog.All(), 1)
			assert.Len(t, operationPostNormalizeLog.All(), 1)
			assert.Equal(t, false, operationPostNormalizeLog.All()[0].ContextMap()["params"].(*core.OperationPostNormalizeParams).NormalizeCacheHit)

			operationPreValidateLog := xEnv.Observer().FilterMessage("OnOperationPreValidate")
			operationPostValidateLog := xEnv.Observer().FilterMessage("OnOperationPostValidate")
			assert.Len(t, operationPreValidateLog.All(), 1)
			assert.Len(t, operationPostValidateLog.All(), 1)

			operationPrePlanLog := xEnv.Observer().FilterMessage("OnOperationPrePlan")
			operationPostPlanLog := xEnv.Observer().FilterMessage("OnOperationPostPlan")
			assert.Len(t, operationPrePlanLog.All(), 1)
			assert.Len(t, operationPostPlanLog.All(), 1)
			assert.Equal(t, false, operationPostPlanLog.All()[0].ContextMap()["params"].(*core.OperationPostPlanParams).PlanCacheHit)

			assert.Equal(t, 200, res.Response.StatusCode)
			assert.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
		})
	})
}

