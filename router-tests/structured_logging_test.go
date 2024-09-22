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

func TestAccessLogs(t *testing.T) {

	t.Parallel()

	t.Run("Simple", func(t *testing.T) {
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
	})

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

	t.Run("Fallback to default value", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			AccessLogFields: []config.CustomAttribute{
				{
					Key:     "service_name",
					Default: "default-service-name",
					ValueFrom: &config.CustomDynamicAttribute{
						RequestHeader: "service-name",
					},
				},
				{
					Key:     "operation_sha256",
					Default: "default-sha256", // Makes less sense, but it's just for testing‚
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.PersistedOperationSha256ContextField,
					},
				},
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			}}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query employees { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)
			logEntries := xEnv.Observer().All()
			require.Len(t, logEntries, 12)
			requestLog := xEnv.Observer().FilterMessage("/graphql")
			require.Equal(t, requestLog.Len(), 1)
			requestContext := requestLog.All()[0].ContextMap()
			expectedValues := map[string]interface{}{
				"log_type":         "request",
				"status":           int64(200),
				"method":           "POST",
				"path":             "/graphql",
				"query":            "",
				"ip":               "[REDACTED]",
				"service_name":     "default-service-name", // From header
				"operation_sha256": "default-sha256",       // From context
			}
			additionalExpectedKeys := []string{
				"user_agent",
				"latency",
				"config_version",
				"request_id",
				"pid",
				"hostname",
			}
			checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
		})
	})

	t.Run("Log when operation parsing fails", func(t *testing.T) {
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
			NoRetryClient: true,
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
				Header: map[string][]string{
					"service-name": {"service-name"},
				},
				Query: `query employees { employees { id } `, // Missing closing bracket
			})
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"unexpected token - got: EOF want one of: [RBRACE IDENT SPREAD]","locations":[{"line":0,"column":0}]}]}`, res.Body)
			logEntries := xEnv.Observer().All()
			require.Len(t, logEntries, 12)
			requestLog := xEnv.Observer().FilterMessage("/graphql")
			require.Equal(t, requestLog.Len(), 1)
			requestContext := requestLog.All()[0].ContextMap()
			expectedValues := map[string]interface{}{
				"log_type":     "request",
				"status":       int64(200),
				"method":       "POST",
				"path":         "/graphql",
				"query":        "", // http query is empty
				"ip":           "[REDACTED]",
				"user_agent":   "Go-http-client/1.1",
				"service_name": "service-name", // From header
			}
			additionalExpectedKeys := []string{
				"latency",
				"config_version",
				"request_id",
				"pid",
				"hostname",
				"parsed_time",
			}

			checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
		})
	})

	t.Run("Log when operation normalization fails", func(t *testing.T) {
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
			NoRetryClient: true,
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
				Header: map[string][]string{
					"service-name": {"service-name"},
				},
				Query: `query employees { notExists { id } }`, // Missing closing bracket
			})
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"field: notExists not defined on type: Query","path":["query","notExists"]}]}`, res.Body)
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
				"query":          "", // http query is empty
				"ip":             "[REDACTED]",
				"user_agent":     "Go-http-client/1.1",
				"service_name":   "service-name", // From header
				"operation_type": "query",        // From context
				"operation_name": "employees",    // From context
			}
			additionalExpectedKeys := []string{
				"latency",
				"config_version",
				"request_id",
				"pid",
				"hostname",
				"parsed_time",
				"normalized_time",
			}

			checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
		})
	})

	t.Run("Log when panic occurs on execution / error panic", func(t *testing.T) {
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
					"service-name":     {"service-name"},
				},
				Query: `query employees { employees { id } }`,
			})
			require.NoError(t, err)
			require.Equal(t, "", res.Body)
			logEntries := xEnv.Observer().All()
			require.Len(t, logEntries, 13)
			requestLog := xEnv.Observer().FilterMessage("[Recovery from panic]")
			require.Equal(t, requestLog.Len(), 1)
			requestContext := requestLog.All()[0].ContextMap()
			expectedValues := map[string]interface{}{
				"log_type":       "request",
				"status":         int64(500),
				"method":         "POST",
				"path":           "/graphql",
				"query":          "", // http query is empty
				"ip":             "[REDACTED]",
				"user_agent":     "Go-http-client/1.1",
				"error":          "implement me",
				"service_name":   "service-name",         // From header
				"operation_hash": "14226210703439426856", // From context
				"operation_name": "employees",            // From context
				"operation_type": "query",                // From context
			}
			additionalExpectedKeys := []string{
				"latency",
				"config_version",
				"request_id",
				"pid",
				"hostname",
				"normalized_time",
				"parsed_time",
				"validation_time",
			}

			require.NotEmpty(t, logEntries[12].Stack)

			checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
		})
	})

	t.Run("Log when panic occurs on execution / string panic", func(t *testing.T) {
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
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Header: map[string][]string{
					"panic-with-string": {"true"},
					"service-name":      {"service-name"},
				},
				Query: `query employees { employees { id } }`,
			})
			require.NoError(t, err)
			require.Equal(t, "", res.Body)
			logEntries := xEnv.Observer().All()
			require.Len(t, logEntries, 13)
			requestLog := xEnv.Observer().FilterMessage("[Recovery from panic]")
			require.Equal(t, requestLog.Len(), 1)
			requestContext := requestLog.All()[0].ContextMap()
			expectedValues := map[string]interface{}{
				"log_type":       "request",
				"status":         int64(500),
				"method":         "POST",
				"path":           "/graphql",
				"query":          "", // http query is empty
				"ip":             "[REDACTED]",
				"user_agent":     "Go-http-client/1.1",
				"error":          "implement me",
				"service_name":   "service-name",         // From header
				"operation_hash": "14226210703439426856", // From context
				"operation_name": "employees",            // From context
				"operation_type": "query",                // From context
			}
			additionalExpectedKeys := []string{
				"latency",
				"config_version",
				"request_id",
				"pid",
				"hostname",
				"normalized_time",
				"parsed_time",
				"validation_time",
			}

			require.NotEmpty(t, logEntries[12].Stack)

			checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
		})
	})

	t.Run("Log graphql error codes and service names", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			AccessLogFields: []config.CustomAttribute{
				{
					Key:     "error_codes",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.GraphQLErrorCodesContextField,
					},
				},
				{
					Key:     "service_names",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.GraphQLErrorServicesContextField,
					},
				},
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
			},
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusForbidden)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'.","extensions":{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}],"statusCode":403}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
			logEntries := xEnv.Observer().All()
			require.Len(t, logEntries, 13)
			requestLog := xEnv.Observer().FilterMessage("/graphql")
			require.Equal(t, requestLog.Len(), 1)
			requestContext := requestLog.All()[0].ContextMap()
			expectedValues := map[string]interface{}{
				"log_type":      "request",
				"status":        int64(200),
				"method":        "POST",
				"path":          "/graphql",
				"query":         "", // http query is empty
				"ip":            "[REDACTED]",
				"user_agent":    "Go-http-client/1.1",
				"error_codes":   []interface{}{"UNAUTHORIZED"},
				"service_names": []interface{}{"products"},
			}
			additionalExpectedKeys := []string{
				"latency",
				"config_version",
				"request_id",
				"pid",
				"hostname",
			}

			checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
		})
	})
}

func checkValues(t *testing.T, requestContext map[string]interface{}, expectedValues map[string]interface{}, additionalExpectedKeys []string) {
	t.Helper()

	require.Lenf(t, requestContext, len(expectedValues)+len(additionalExpectedKeys), "unexpected number of keys")

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
