package integration_test

import (
	"fmt"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"math"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

// Interface guard
var (
	_ core.EnginePreOriginHandler = (*MyPanicModule)(nil)
	_ core.Module                 = (*MyPanicModule)(nil)
)

type MyPanicModule struct{}

func (m MyPanicModule) OnOriginRequest(req *http.Request, ctx core.RequestContext) (*http.Request, *http.Response) {

	if req.Header.Get("panic-with-string") == "true" {
		panic("implement me")
	}

	if req.Header.Get("panic-with-error") == "true" {
		panic(fmt.Errorf("implement me"))
	}

	return req, nil
}

func (m MyPanicModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       "myPanicModule",
		Priority: math.MaxInt32,
		New: func() core.Module {
			return &MyPanicModule{}
		},
	}
}

func TestRouterStartLogs(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{LogObservation: testenv.LogObservationConfig{
		Enabled:  true,
		LogLevel: zapcore.InfoLevel,
	}}, func(t *testing.T, xEnv *testenv.Environment) {
		logEntries := xEnv.Observer().All()
		require.Len(t, logEntries, 11)
		natsLogs := xEnv.Observer().FilterMessageSnippet("Nats Event source enabled").All()
		require.Len(t, natsLogs, 4)
		providerIDFields := xEnv.Observer().FilterField(zap.String("provider_id", "default")).All()
		require.Len(t, providerIDFields, 1)
		kafkaLogs := xEnv.Observer().FilterMessageSnippet("Kafka Event source enabled").All()
		require.Len(t, kafkaLogs, 2)
		playgroundLog := xEnv.Observer().FilterMessage("Serving GraphQL playground")
		require.Equal(t, playgroundLog.Len(), 1)
		featureFlagLog := xEnv.Observer().FilterMessage("Feature flags enabled")
		require.Equal(t, featureFlagLog.Len(), 1)
		serverListeningLog := xEnv.Observer().FilterMessage("Server listening and serving")
		require.Equal(t, serverListeningLog.Len(), 1)
	})
}

func TestQueryWithLogging(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		LogObservation: testenv.LogObservationConfig{
			Enabled:  true,
			LogLevel: zapcore.InfoLevel,
		}}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id } }`,
		})
		require.JSONEq(t, employeesIDData, res.Body)
		logEntries := xEnv.Observer().All()
		require.Len(t, logEntries, 12)
		requestLog := xEnv.Observer().FilterMessage("/graphql")
		require.Equal(t, requestLog.Len(), 1)
		requestContext := requestLog.All()[0].ContextMap()
		expectedValues := map[string]interface{}{
			"log_type": "request",
			"status":   int64(200),
			"method":   "POST",
			"path":     "/graphql",
			"query":    "", // http query is empty
			"ip":       "[REDACTED]",
		}
		additionalExpectedKeys := []string{
			"user_agent", "latency", "config_version", "request_id", "pid", "hostname",
		}
		checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
	})
}

func TestQueryWithLoggingError(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		NoRetryClient: true,
		Subgraphs: testenv.SubgraphsConfig{
			Employees: testenv.SubgraphConfig{
				CloseOnStart: true,
			},
		},
		RouterOptions: []core.Option{
			core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
				EnableSingleFlight:     true,
				MaxConcurrentResolvers: 1,
			}),
			core.WithSubgraphRetryOptions(false, 0, 0, 0),
		},
		LogObservation: testenv.LogObservationConfig{
			Enabled:  true,
			LogLevel: zapcore.InfoLevel,
		}}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query: `{ employees { id } }`,
		})
		require.NoError(t, err)
		require.JSONEq(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'."}],"data":{"employees":null}}`, res.Body)
		logEntries := xEnv.Observer().All()
		require.Len(t, logEntries, 13)
		requestLog := xEnv.Observer().FilterMessage("/graphql")
		require.Equal(t, requestLog.Len(), 1)
		requestContext := requestLog.All()[0].ContextMap()
		expectedValues := map[string]interface{}{
			"log_type":   "request",
			"status":     int64(200),
			"method":     "POST",
			"path":       "/graphql",
			"query":      "",
			"ip":         "[REDACTED]",
			"user_agent": "Go-http-client/1.1",
		}
		additionalExpectedKeys := []string{
			"latency", "config_version", "request_id", "pid", "hostname",
		}
		checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
	})
}

func TestQueryWithLoggingPanicWithString(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		NoRetryClient: true,
		RouterOptions: []core.Option{
			core.WithCustomModules(&MyPanicModule{}),
			core.WithHeaderRules(config.HeaderRules{
				All: &config.GlobalHeaderRule{
					Request: []*config.RequestHeaderRule{
						{Named: "panic-with-string", Operation: config.HeaderRuleOperationPropagate},
					},
				},
			}),
			core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
				EnableSingleFlight:     true,
				MaxConcurrentResolvers: 1,
			}),
			core.WithSubgraphRetryOptions(false, 0, 0, 0),
		},
		LogObservation: testenv.LogObservationConfig{
			Enabled:  true,
			LogLevel: zapcore.InfoLevel,
		}}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Header: map[string][]string{
				"panic-with-string": {"true"},
			},
			Query: `{ employees { id } }`,
		})
		require.NoError(t, err)
		require.Equal(t, "", res.Body)
		logEntries := xEnv.Observer().All()
		require.Len(t, logEntries, 13)
		requestLog := xEnv.Observer().FilterMessage("[Recovery from panic]")
		require.Equal(t, requestLog.Len(), 1)
		requestContext := requestLog.All()[0].ContextMap()
		expectedValues := map[string]interface{}{
			"log_type":   "request",
			"status":     int64(500),
			"method":     "POST",
			"path":       "/graphql",
			"query":      "",
			"ip":         "[REDACTED]",
			"user_agent": "Go-http-client/1.1",
			"error":      "implement me", // From panic
		}
		additionalExpectedKeys := []string{
			"latency", "config_version", "request_id", "pid", "hostname",
		}
		require.NotEmpty(t, logEntries[12].Stack)

		checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
	})
}

func TestQueryWithLoggingPanicWithError(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		NoRetryClient: true,
		RouterOptions: []core.Option{
			core.WithCustomModules(&MyPanicModule{}),
			core.WithHeaderRules(config.HeaderRules{
				All: &config.GlobalHeaderRule{
					Request: []*config.RequestHeaderRule{
						{Named: "panic-with-error", Operation: config.HeaderRuleOperationPropagate},
					},
				},
			}),
			core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
				EnableSingleFlight:     true,
				MaxConcurrentResolvers: 1,
			}),
			core.WithSubgraphRetryOptions(false, 0, 0, 0),
		},
		LogObservation: testenv.LogObservationConfig{
			Enabled:  true,
			LogLevel: zapcore.InfoLevel,
		}}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Header: map[string][]string{
				"panic-with-error": {"true"},
			},
			Query: `{ employees { id } }`,
		})
		require.NoError(t, err)
		require.Equal(t, "", res.Body)
		logEntries := xEnv.Observer().All()
		require.Len(t, logEntries, 13)
		requestLog := xEnv.Observer().FilterMessage("[Recovery from panic]")
		require.Equal(t, requestLog.Len(), 1)
		requestContext := requestLog.All()[0].ContextMap()
		expectedValues := map[string]interface{}{
			"log_type":   "request",
			"status":     int64(500),
			"method":     "POST",
			"path":       "/graphql",
			"query":      "", // http query is empty
			"ip":         "[REDACTED]",
			"user_agent": "Go-http-client/1.1",
			"error":      "implement me",
		}
		additionalExpectedKeys := []string{
			"latency", "config_version", "request_id", "pid", "hostname",
		}

		require.NotEmpty(t, logEntries[12].Stack)

		checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
	})
}

func TestAccessLogs(t *testing.T) {

	t.Run("Add custom access log fields", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			AccessLogFields: []config.CustomAttribute{
				{
					Key:     "service_name",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						RequestHeader: "service-name",
					},
				},
				{
					Key:     "operation_hash",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.OperationHashContextField,
					},
				},
				{
					Key:     "operation_name",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.OperationNameContextField,
					},
				},
				{
					Key:     "operation_type",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.OperationTypeContextField,
					},
				},
				{
					Key:     "normalized_time",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.OperationNormalizationTimeContextField,
					},
				},
				{
					Key:     "parsed_time",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.OperationParsingTimeContextField,
					},
				},
				{
					Key:     "validation_time",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.OperationValidationTimeContextField,
					},
				},
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			}}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  `query employees { employees { id } }`,
				Header: map[string][]string{"service-name": {"service-name"}},
			})
			require.JSONEq(t, employeesIDData, res.Body)
			logEntries := xEnv.Observer().All()
			require.Len(t, logEntries, 12)
			requestLog := xEnv.Observer().FilterMessage("/graphql")
			require.Equal(t, requestLog.Len(), 1)
			requestContext := requestLog.All()[0].ContextMap()
			expectedValues := map[string]interface{}{
				"log_type":       "request",
				"status":         int64(200),
				"method":         "POST",
				"path":           "/graphql",
				"query":          "",
				"ip":             "[REDACTED]",
				"service_name":   "service-name",         // From header
				"operation_hash": "14226210703439426856", // From context
				"operation_name": "employees",            // From context
				"operation_type": "query",                // From context
			}
			additionalExpectedKeys := []string{
				"user_agent",
				"latency",
				"config_version",
				"request_id",
				"pid",
				"hostname",
				"normalized_time",
				"parsed_time",
				"validation_time",
			}
			checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
		})
	})
}

func checkValues(t *testing.T, requestContext map[string]interface{}, expectedValues map[string]interface{}, additionalExpectedKeys []string) {
	t.Helper()

	require.Len(t, requestContext, len(expectedValues)+len(additionalExpectedKeys))

	for key, val := range expectedValues {
		mapVal, exists := requestContext[key]
		require.Truef(t, exists, "key '%s' not found", key)
		require.Equalf(t, mapVal, val, "expected '%v', got '%v'", val, mapVal)
	}
	for _, key := range additionalExpectedKeys {
		_, exists := requestContext[key]
		require.Truef(t, exists, "key '%s' not found", key)
	}
}
