package integration

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
)

// Interface guard
var (
	_ core.EnginePreOriginHandler = (*MyPanicModule2)(nil)
	_ core.Module                 = (*MyPanicModule2)(nil)
)

type MyPanicModule2 struct{}

func (m MyPanicModule2) OnOriginRequest(req *http.Request, ctx core.RequestContext) (*http.Request, *http.Response) {

	if req.Header.Get("panic-with-string") == "true" {
		panic("implement me")
	}

	if req.Header.Get("panic-with-error") == "true" {
		panic(fmt.Errorf("implement me"))
	}

	return req, nil
}

func (m MyPanicModule2) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       "MyPanicModule2",
		Priority: math.MaxInt32,
		New: func() core.Module {
			return &MyPanicModule2{}
		},
	}
}

var (
	allSubgraphLogs = []config.CustomAttribute{
		{
			Key:     "service_name",
			Default: "",
			ValueFrom: &config.CustomDynamicAttribute{
				RequestHeader: "service-name",
			},
		},
		{
			Key:     "response_header",
			Default: "",
			ValueFrom: &config.CustomDynamicAttribute{
				ResponseHeader: "response-header-name",
			},
		},
		{
			Key:     "operation_name",
			Default: "",
			ValueFrom: &config.CustomDynamicAttribute{
				ContextField: core.ContextFieldOperationName,
			},
		},
		{
			Key:     "operation_type",
			Default: "",
			ValueFrom: &config.CustomDynamicAttribute{
				ContextField: core.ContextFieldOperationType,
			},
		},
		{
			Key:     "operation_hash",
			Default: "",
			ValueFrom: &config.CustomDynamicAttribute{
				ContextField: core.ContextFieldOperationHash,
			},
		},
		{
			Key:     "operation_persisted_hash",
			Default: "",
			ValueFrom: &config.CustomDynamicAttribute{
				ContextField: core.ContextFieldPersistedOperationSha256,
			},
		},
		{
			Key:     "operation_sha256",
			Default: "",
			ValueFrom: &config.CustomDynamicAttribute{
				ContextField: core.ContextFieldOperationSha256,
			},
		},
		{
			Key:     "response_error_message",
			Default: "",
			ValueFrom: &config.CustomDynamicAttribute{
				ContextField: core.ContextFieldResponseErrorMessage,
			},
		},
		{
			Key:     "parsed_time",
			Default: "",
			ValueFrom: &config.CustomDynamicAttribute{
				ContextField: core.ContextFieldOperationParsingTime,
			},
		},
		{
			Key:     "validation_time",
			Default: "",
			ValueFrom: &config.CustomDynamicAttribute{
				ContextField: core.ContextFieldOperationValidationTime,
			},
		},
		{
			Key:     "planned_time",
			Default: "",
			ValueFrom: &config.CustomDynamicAttribute{
				ContextField: core.ContextFieldOperationPlanningTime,
			},
		},
		{
			Key:     "normalized_time",
			Default: "",
			ValueFrom: &config.CustomDynamicAttribute{
				ContextField: core.ContextFieldOperationNormalizationTime,
			},
		},
		{
			Key:     "request_error",
			Default: "",
			ValueFrom: &config.CustomDynamicAttribute{
				ContextField: core.ContextFieldRequestError,
			},
		},
	}
)

func TestRouterStartLogs(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigWithEdfsJSONTemplate,
		EnableNats:               true,
		EnableKafka:              true,
		LogObservation: testenv.LogObservationConfig{
			Enabled:  true,
			LogLevel: zapcore.InfoLevel,
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		logEntries := xEnv.Observer().All()
		require.Len(t, logEntries, 13)
		natsLogs := xEnv.Observer().FilterMessageSnippet("Nats Event source enabled").All()
		require.Len(t, natsLogs, 4)
		providerIDFields := xEnv.Observer().FilterField(zap.String("provider_id", "default")).All()
		require.Len(t, providerIDFields, 2)
		kafkaLogs := xEnv.Observer().FilterMessageSnippet("Kafka Event source enabled").All()
		require.Len(t, kafkaLogs, 2)
		playgroundLog := xEnv.Observer().FilterMessage("Serving GraphQL playground")
		require.Equal(t, playgroundLog.Len(), 1)
		featureFlagLog := xEnv.Observer().FilterMessage("Feature flags enabled")
		require.Equal(t, featureFlagLog.Len(), 1)
		serverListeningLog := xEnv.Observer().FilterMessage("Server initialized and ready to serve requests")
		require.Equal(t, serverListeningLog.Len(), 1)
	})
}

func TestAccessLogsFileOutput(t *testing.T) {
	t.Parallel()

	t.Run("Simple", func(t *testing.T) {
		t.Parallel()

		fp := filepath.Join(os.TempDir(), "access.log")
		f, err := logging.NewLogFile(filepath.Join(os.TempDir(), "access.log"))
		require.NoError(t, err)

		t.Cleanup(func() {
			require.NoError(t, f.Close())
			require.NoError(t, os.RemoveAll(fp))
		})

		logger := logging.NewZapAccessLogger(f, false, false)
		require.NoError(t, err)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessLogs(&core.AccessLogsConfig{
					Attributes: []config.CustomAttribute{},
					Logger:     logger,
				}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			}}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)
			data, err := os.ReadFile(fp)
			require.NoError(t, err)

			var logEntry map[string]interface{}
			require.NoError(t, json.Unmarshal(data, &logEntry))

			require.Equal(t, logEntry["level"], "info")
			require.Equal(t, logEntry["status"], float64(200))
			require.Equal(t, logEntry["method"], "POST")
			require.Equal(t, logEntry["msg"], "/graphql")
			require.Equal(t, logEntry["log_type"], "request")
			require.Equal(t, logEntry["user_agent"], "Go-http-client/1.1")
			require.NotEmpty(t, logEntry["request_id"])
			require.NotEmpty(t, logEntry["hostname"])
			require.NotEmpty(t, logEntry["config_version"])
			require.NotEmpty(t, logEntry["pid"])
			require.NotEmpty(t, logEntry["time"])
			require.NotEmpty(t, logEntry["ip"])
			require.Equal(t, logEntry["query"], "")
			require.NotEmpty(t, logEntry["latency"])
		})
	})

	t.Run("subgraph", func(t *testing.T) {
		t.Parallel()

		t.Run("Simple", func(t *testing.T) {
			t.Parallel()

			fp := filepath.Join(t.TempDir(), "access.log")
			f, err := logging.NewLogFile(fp)
			require.NoError(t, err)

			t.Cleanup(func() {
				require.NoError(t, f.Close())
				require.NoError(t, os.RemoveAll(fp))
			})

			logger := logging.NewZapAccessLogger(f, false, false)
			require.NoError(t, err)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessLogs(&core.AccessLogsConfig{
						SubgraphEnabled: true,
						Logger:          logger,
					}),
				},
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				}}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
				})
				require.JSONEq(t, employeesIDData, res.Body)
				data, err := os.ReadFile(fp)
				require.NoError(t, err)

				lines := bytes.Split(data, []byte("\n"))
				var logEntry map[string]interface{}
				require.NoError(t, json.Unmarshal(lines[0], &logEntry))

				expectedValues1 := map[string]interface{}{
					"level":         "info",
					"msg":           "/graphql",
					"log_type":      "client/subgraph",
					"subgraph_name": "employees",
					"subgraph_id":   "0",
					"status":        float64(200),
					"method":        "POST",
					"path":          "/graphql",
					"query":         "",
					"ip":            "[REDACTED]",
				}
				additionalExpectedKeys1 := []string{
					"time", "hostname", "pid", "latency",
					"user_agent", "config_version", "request_id", "trace_id", "url",
				}
				checkValues(t, logEntry, expectedValues1, additionalExpectedKeys1)
			})
		})
	})
}

func TestAccessLogs(t *testing.T) {
	t.Parallel()

	t.Run("Simple without custom attributes", func(t *testing.T) {
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
			require.Len(t, logEntries, 10)
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

	t.Run("Simple with tracing enabled", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			TraceExporter: exporter,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)
			logEntries := xEnv.Observer().All()
			require.Len(t, logEntries, 10)
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
				"user_agent", "latency", "config_version", "request_id", "pid", "hostname", "trace_id",
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
						ContextField: core.ContextFieldOperationHash,
					},
				},
				{
					Key:     "operation_sha256",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationSha256,
					},
				},
				{
					Key:     "operation_name",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationName,
					},
				},
				{
					Key:     "operation_type",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationType,
					},
				},
				{
					Key:     "normalized_time",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationNormalizationTime,
					},
				},
				{
					Key:     "parsed_time",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationParsingTime,
					},
				},
				{
					Key:     "validation_time",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationValidationTime,
					},
				},
				{
					Key:     "request_error",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldRequestError,
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
			require.Len(t, logEntries, 10)
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
				"service_name":     "service-name",                                                     // From header
				"operation_hash":   "1163600561566987607",                                              // From context
				"operation_sha256": "c13e0fafb0a3a72e74c19df743fedee690fe133554a17a9408747585a0d1b423", // From context
				"operation_name":   "employees",                                                        // From context
				"operation_type":   "query",                                                            // From context
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

	t.Run("Fallback to default value when defining a header", func(t *testing.T) {
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
						ContextField: core.ContextFieldPersistedOperationSha256,
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
			require.Len(t, logEntries, 10)
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

	t.Run("Fallback to default value when no value_from was provided", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			AccessLogFields: []config.CustomAttribute{
				{
					Key:     "env",
					Default: "staging",
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
			require.Len(t, logEntries, 10)
			requestLog := xEnv.Observer().FilterMessage("/graphql")
			require.Equal(t, requestLog.Len(), 1)
			requestContext := requestLog.All()[0].ContextMap()
			expectedValues := map[string]interface{}{
				"log_type": "request",
				"status":   int64(200),
				"method":   "POST",
				"path":     "/graphql",
				"query":    "",
				"ip":       "[REDACTED]",
				"env":      "staging", // From default
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

	t.Run("Log as much information possible when operation parsing fails", func(t *testing.T) {
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
					Key: "error_message",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldResponseErrorMessage,
					},
				},
				{
					Key:     "operation_hash",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationHash,
					},
				},
				{
					Key:     "operation_name",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationName,
					},
				},
				{
					Key:     "operation_type",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationType,
					},
				},
				{
					Key:     "normalized_time",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationNormalizationTime,
					},
				},
				{
					Key:     "parsed_time",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationParsingTime,
					},
				},
				{
					Key:     "validation_time",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationValidationTime,
					},
				},
				{
					Key:     "request_error",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldRequestError,
					},
				},
			},
			NoRetryClient: true,
			RouterOptions: []core.Option{
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableNetPoll:          true,
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
			require.Len(t, logEntries, 10)
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
				"service_name":  "service-name", // From header
				"error_message": "unexpected token - got: EOF want one of: [RBRACE IDENT SPREAD]",
				"request_error": true,
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

	t.Run("Log as much information possible when operation validation fails", func(t *testing.T) {
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
					Key: "error_message",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldResponseErrorMessage,
					},
				},
				{
					Key:     "operation_hash",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationHash,
					},
				},
				{
					Key:     "operation_name",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationName,
					},
				},
				{
					Key:     "operation_type",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationType,
					},
				},
				{
					Key:     "normalized_time",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationNormalizationTime,
					},
				},
				{
					Key:     "parsed_time",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationParsingTime,
					},
				},
				{
					Key:     "validation_time",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationValidationTime,
					},
				},
				{
					Key:     "request_error",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldRequestError,
					},
				},
			},
			NoRetryClient: true,
			RouterOptions: []core.Option{
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableNetPoll:          true,
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
			require.Equal(t, `{"errors":[{"message":"field: notExists not defined on type: Query","path":["query"]}]}`, res.Body)
			logEntries := xEnv.Observer().All()
			require.Len(t, logEntries, 10)
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
				"error_message":  "field: notExists not defined on type: Query",
				"operation_hash": "3291586836053813139",
				"request_error":  true,
			}
			additionalExpectedKeys := []string{
				"latency",
				"config_version",
				"request_id",
				"pid",
				"hostname",
				"parsed_time",
				"normalized_time",
				"validation_time",
			}

			checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
		})
	})

	t.Run("Log as much information possible on execution / error panic", func(t *testing.T) {
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
					Key: "error_message",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldResponseErrorMessage,
					},
				},
				{
					Key:     "operation_hash",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationHash,
					},
				},
				{
					Key:     "operation_name",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationName,
					},
				},
				{
					Key:     "operation_type",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationType,
					},
				},
				{
					Key:     "normalized_time",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationNormalizationTime,
					},
				},
				{
					Key:     "parsed_time",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationParsingTime,
					},
				},
				{
					Key:     "validation_time",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationValidationTime,
					},
				},
				{
					Key:     "request_error",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldRequestError,
					},
				},
			},
			NoRetryClient: true,
			RouterOptions: []core.Option{
				core.WithCustomModules(&MyPanicModule2{}),
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
							{Named: "panic-with-error", Operation: config.HeaderRuleOperationPropagate},
						},
					},
				}),
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableNetPoll:          true,
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
			require.Len(t, logEntries, 11)
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
				"service_name":   "service-name",        // From header
				"operation_hash": "1163600561566987607", // From context
				"operation_name": "employees",           // From context
				"operation_type": "query",               // From context
				"error_message":  "implement me",
				"request_error":  true,
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

			require.NotEmpty(t, logEntries[10].Stack)

			checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
		})
	})

	t.Run("Log as much information possible on execution / string panic", func(t *testing.T) {
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
					Key: "error_message",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldResponseErrorMessage,
					},
				},
				{
					Key:     "operation_hash",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationHash,
					},
				},
				{
					Key:     "operation_name",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationName,
					},
				},
				{
					Key:     "operation_type",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationType,
					},
				},
				{
					Key:     "normalized_time",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationNormalizationTime,
					},
				},
				{
					Key:     "parsed_time",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationParsingTime,
					},
				},
				{
					Key:     "validation_time",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldOperationValidationTime,
					},
				},
				{
					Key:     "request_error",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldRequestError,
					},
				},
			},
			NoRetryClient: true,
			RouterOptions: []core.Option{
				core.WithCustomModules(&MyPanicModule2{}),
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
							{Named: "panic-with-string", Operation: config.HeaderRuleOperationPropagate},
						},
					},
				}),
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableNetPoll:          true,
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
			require.Len(t, logEntries, 11)
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
				"service_name":   "service-name",        // From header
				"operation_hash": "1163600561566987607", // From context
				"operation_name": "employees",           // From context
				"operation_type": "query",               // From context
				"error_message":  "implement me",
				"request_error":  true,
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

			require.NotEmpty(t, logEntries[10].Stack)

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
						ContextField: core.ContextFieldGraphQLErrorCodes,
					},
				},
				{
					Key:     "service_names",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldGraphQLErrorServices,
					},
				},
				{
					Key:     "request_error",
					Default: "",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldRequestError,
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
			require.Len(t, logEntries, 10)
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
				"request_error": true,
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

	t.Run("subgraph logs", func(t *testing.T) {
		t.Parallel()

		t.Run("Simple without custom attributes", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				SubgraphAccessLogsEnabled: true,
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				}}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
				})
				require.JSONEq(t, employeesIDData, res.Body)
				logEntries := xEnv.Observer().All()
				require.Len(t, logEntries, 11)
				requestLog := xEnv.Observer().FilterMessage("/graphql")
				require.Equal(t, requestLog.Len(), 2)

				requestContext := requestLog.All()[0].ContextMap()
				expectedValues := map[string]interface{}{
					"log_type":      "client/subgraph",
					"subgraph_name": "employees",
					"subgraph_id":   "0",
					"status":        int64(200),
					"method":        "POST",
					"path":          "/graphql",
					"query":         "", // http query is empty
					"ip":            "[REDACTED]",
				}
				additionalExpectedKeys := []string{
					"user_agent", "latency", "config_version", "request_id", "pid", "hostname",
				}
				checkValues(t, requestContext, expectedValues, append(additionalExpectedKeys, "trace_id", "url"))

				requestContext1 := requestLog.All()[1].ContextMap()
				expectedValues1 := map[string]interface{}{
					"log_type": "request",
					"status":   int64(200),
					"method":   "POST",
					"path":     "/graphql",
					"query":    "", // http query is empty
					"ip":       "[REDACTED]",
				}
				checkValues(t, requestContext1, expectedValues1, additionalExpectedKeys)
			})
		})

		t.Run("Simple with tracing enabled", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)

			testenv.Run(t, &testenv.Config{
				SubgraphAccessLogsEnabled: true,
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
				TraceExporter: exporter,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
				})
				require.JSONEq(t, employeesIDData, res.Body)
				logEntries := xEnv.Observer().All()
				require.Len(t, logEntries, 11)
				requestLog := xEnv.Observer().FilterMessage("/graphql")
				require.Equal(t, requestLog.Len(), 2)
				requestContext := requestLog.All()[0].ContextMap()
				expectedValues := map[string]interface{}{
					"log_type":      "client/subgraph",
					"subgraph_name": "employees",
					"subgraph_id":   "0",
					"status":        int64(200),
					"method":        "POST",
					"path":          "/graphql",
					"query":         "", // http query is empty
					"ip":            "[REDACTED]",
				}
				additionalExpectedKeys := []string{
					"user_agent", "latency", "config_version", "request_id", "pid", "hostname", "trace_id",
				}
				checkValues(t, requestContext, expectedValues, append(additionalExpectedKeys, "url"))

				requestContext1 := requestLog.All()[1].ContextMap()
				expectedValues1 := map[string]interface{}{
					"log_type": "request",
					"status":   int64(200),
					"method":   "POST",
					"path":     "/graphql",
					"query":    "", // http query is empty
					"ip":       "[REDACTED]",
				}
				checkValues(t, requestContext1, expectedValues1, additionalExpectedKeys)
			})
		})

		t.Run("Doesn't add in router custom access log fields", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				SubgraphAccessLogsEnabled: true,
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
							ContextField: core.ContextFieldOperationHash,
						},
					},
					{
						Key:     "operation_sha256",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationSha256,
						},
					},
					{
						Key:     "operation_name",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationName,
						},
					},
					{
						Key:     "operation_type",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationType,
						},
					},
					{
						Key:     "normalized_time",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationNormalizationTime,
						},
					},
					{
						Key:     "parsed_time",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationParsingTime,
						},
					},
					{
						Key:     "validation_time",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationValidationTime,
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
				require.Len(t, logEntries, 11)
				requestLog := xEnv.Observer().FilterMessage("/graphql")
				require.Equal(t, requestLog.Len(), 2)
				requestContext := requestLog.All()[0].ContextMap()
				expectedValues := map[string]interface{}{
					"log_type":      "client/subgraph",
					"subgraph_name": "employees",
					"subgraph_id":   "0",
					"status":        int64(200),
					"method":        "POST",
					"path":          "/graphql",
					"query":         "", // http query is empty
					"ip":            "[REDACTED]",
				}
				additionalExpectedKeys := []string{
					"user_agent", "latency", "config_version", "request_id", "pid", "hostname", "trace_id", "url",
				}
				checkValues(t, requestContext, expectedValues, additionalExpectedKeys)

				requestContext1 := requestLog.All()[1].ContextMap()
				expectedValues1 := map[string]interface{}{
					"log_type":         "request",
					"status":           int64(200),
					"method":           "POST",
					"path":             "/graphql",
					"query":            "",
					"ip":               "[REDACTED]",
					"service_name":     "service-name",                                                     // From header
					"operation_hash":   "1163600561566987607",                                              // From context
					"operation_sha256": "c13e0fafb0a3a72e74c19df743fedee690fe133554a17a9408747585a0d1b423", // From context
					"operation_name":   "employees",                                                        // From context
					"operation_type":   "query",                                                            // From context
				}
				additionalExpectedKeys1 := []string{
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
				checkValues(t, requestContext1, expectedValues1, additionalExpectedKeys1)
			})
		})

		t.Run("Adds subgraph custom access log fields", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				SubgraphAccessLogsEnabled: true,
				SubgraphAccessLogFields:   allSubgraphLogs,
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						All: &config.GlobalHeaderRule{
							Request: []*config.RequestHeaderRule{
								{
									Operation: config.HeaderRuleOperationPropagate,
									Named:     "service-name",
								},
							},
						},
					}),
				},
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								w.Header().Set("response-header-name", "my-response-value")
								handler.ServeHTTP(w, r)
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:  `query employees { employees { id } }`,
					Header: map[string][]string{"service-name": {"service-name"}},
				})
				require.JSONEq(t, employeesIDData, res.Body)
				logEntries := xEnv.Observer().All()
				require.Len(t, logEntries, 11)
				requestLog := xEnv.Observer().FilterMessage("/graphql")
				require.Equal(t, requestLog.Len(), 2)
				requestContext := requestLog.All()[0].ContextMap()
				expectedValues := map[string]interface{}{
					"log_type":         "client/subgraph",
					"subgraph_name":    "employees",
					"subgraph_id":      "0",
					"status":           int64(200),
					"method":           "POST",
					"path":             "/graphql",
					"query":            "", // http query is empty
					"ip":               "[REDACTED]",
					"service_name":     "service-name",                                                     // From request header
					"response_header":  "my-response-value",                                                // From response header
					"operation_hash":   "1163600561566987607",                                              // From context
					"operation_sha256": "c13e0fafb0a3a72e74c19df743fedee690fe133554a17a9408747585a0d1b423", // From context
					"operation_name":   "employees",                                                        // From context
					"operation_type":   "query",                                                            // From context
				}
				additionalExpectedKeys := []string{
					"user_agent", "latency", "config_version", "request_id", "pid", "hostname", "normalized_time", "parsed_time", "planned_time", "validation_time", "trace_id", "url",
				}
				checkValues(t, requestContext, expectedValues, additionalExpectedKeys)

				requestContext1 := requestLog.All()[1].ContextMap()
				expectedValues1 := map[string]interface{}{
					"log_type": "request",
					"status":   int64(200),
					"method":   "POST",
					"path":     "/graphql",
					"query":    "",
					"ip":       "[REDACTED]",
				}
				additionalExpectedKeys1 := []string{
					"user_agent",
					"latency",
					"config_version",
					"request_id",
					"pid",
					"hostname",
				}
				checkValues(t, requestContext1, expectedValues1, additionalExpectedKeys1)
			})
		})

		t.Run("Sets subgraph custom access logs with subgraph errors", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				SubgraphAccessLogsEnabled: true,
				AccessLogFields: []config.CustomAttribute{
					{
						Key:     "request_error",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldRequestError,
						},
					},
				},
				SubgraphAccessLogFields: allSubgraphLogs,
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						All: &config.GlobalHeaderRule{
							Request: []*config.RequestHeaderRule{
								{
									Operation: config.HeaderRuleOperationPropagate,
									Named:     "service-name",
								},
							},
						},
					}),
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
					Query:  `query employees { employees { id details { forename surname } notes } }`,
					Header: map[string][]string{"service-name": {"service-name"}},
				})
				require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'.","extensions":{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}],"statusCode":403}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
				logEntries := xEnv.Observer().All()
				require.Len(t, logEntries, 12)
				requestLog := xEnv.Observer().FilterMessage("/graphql")
				require.Equal(t, requestLog.Len(), 3)

				employeeContext := requestLog.All()[0].ContextMap()
				employeeSubgraphVals := map[string]interface{}{
					"log_type":         "client/subgraph",
					"subgraph_name":    "employees",
					"subgraph_id":      "0",
					"status":           int64(200),
					"method":           "POST",
					"path":             "/graphql",
					"query":            "", // http query is empty
					"ip":               "[REDACTED]",
					"service_name":     "service-name",                                                     // From request header
					"operation_hash":   "13939103824696605913",                                             // From context
					"operation_sha256": "049efe2ebbdf2e4845e69f69cb7965963b118612a6247ab6d91b1961ea0158dc", // From context
					"operation_name":   "employees",                                                        // From context
					"operation_type":   "query",                                                            // From context
				}
				additionalExpectedKeys := []string{
					"user_agent", "latency", "config_version", "request_id", "pid", "hostname", "normalized_time", "parsed_time", "planned_time", "validation_time", "trace_id", "url",
				}
				checkValues(t, employeeContext, employeeSubgraphVals, additionalExpectedKeys)

				productContext := requestLog.All()[1].ContextMap()
				productSubgraphVals := map[string]interface{}{
					"log_type":               "client/subgraph",
					"subgraph_name":          "products",
					"subgraph_id":            "3",
					"status":                 int64(403),
					"method":                 "POST",
					"path":                   "/graphql",
					"query":                  "", // http query is empty
					"ip":                     "[REDACTED]",
					"service_name":           "service-name",                                                     // From request header
					"response_error_message": "Failed to fetch from Subgraph 'products' at Path: 'employees'.",   // From context
					"operation_hash":         "13939103824696605913",                                             // From context
					"operation_sha256":       "049efe2ebbdf2e4845e69f69cb7965963b118612a6247ab6d91b1961ea0158dc", // From context
					"operation_name":         "employees",                                                        // From context
					"operation_type":         "query",                                                            // From context
					"request_error":          true,                                                               // From context
				}
				checkValues(t, productContext, productSubgraphVals, additionalExpectedKeys)

				graphContext := requestLog.All()[2].ContextMap()
				graphVals := map[string]interface{}{
					"log_type":      "request",
					"status":        int64(200),
					"method":        "POST",
					"path":          "/graphql",
					"query":         "",
					"ip":            "[REDACTED]",
					"request_error": true, // From context
				}
				graphKeys := []string{
					"user_agent",
					"latency",
					"config_version",
					"request_id",
					"pid",
					"hostname",
				}
				checkValues(t, graphContext, graphVals, graphKeys)
			})
		})

		t.Run("Sets persisted operation hash from access log fields", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				SubgraphAccessLogsEnabled: true,
				SubgraphAccessLogFields: []config.CustomAttribute{
					{
						Key:     "service_name",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							RequestHeader: "service-name",
						},
					},
					{
						Key:     "response_header",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							ResponseHeader: "response-header-name",
						},
					},
					{
						Key:     "operation_name",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationName,
						},
					},
					{
						Key:     "operation_type",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationType,
						},
					},
					{
						Key:     "operation_hash",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationHash,
						},
					},
					{
						Key:     "operation_persisted_hash",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldPersistedOperationSha256,
						},
					},
					{
						Key:     "operation_sha256",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationSha256,
						},
					},
					{
						Key:     "response_error_message",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldResponseErrorMessage,
						},
					},
					{
						Key:     "parsed_time",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationParsingTime,
						},
					},
					{
						Key:     "validation_time",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationValidationTime,
						},
					},
					{
						Key:     "planned_time",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationPlanningTime,
						},
					},
					{
						Key:     "normalized_time",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationNormalizationTime,
						},
					},
				},
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						All: &config.GlobalHeaderRule{
							Request: []*config.RequestHeaderRule{
								{
									Operation: config.HeaderRuleOperationPropagate,
									Named:     "service-name",
								},
							},
						},
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					OperationName: []byte(`"Employees"`),
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
					Header:        map[string][]string{"service-name": {"service-name"}, "graphql-client-name": {"my-client"}},
				})
				require.NoError(t, err)
				require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
				logEntries := xEnv.Observer().All()
				require.Len(t, logEntries, 11)
				requestLog := xEnv.Observer().FilterMessage("/graphql")
				require.Equal(t, requestLog.Len(), 2)
				requestContext := requestLog.All()[0].ContextMap()
				expectedValues := map[string]interface{}{
					"log_type":                 "client/subgraph",
					"subgraph_name":            "employees",
					"subgraph_id":              "0",
					"status":                   int64(200),
					"method":                   "POST",
					"path":                     "/graphql",
					"query":                    "", // http query is empty
					"ip":                       "[REDACTED]",
					"service_name":             "service-name",                                                     // From request header
					"operation_persisted_hash": "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f", // From context
					"operation_hash":           "1163600561566987607",                                              // From context
					"operation_sha256":         "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // From context
					"operation_name":           "Employees",                                                        // From context
					"operation_type":           "query",                                                            // From context
				}
				additionalExpectedKeys := []string{
					"user_agent", "latency", "config_version", "request_id", "pid", "hostname", "normalized_time", "parsed_time", "planned_time", "validation_time", "trace_id", "url",
				}
				checkValues(t, requestContext, expectedValues, additionalExpectedKeys)

				requestContext1 := requestLog.All()[1].ContextMap()
				expectedValues1 := map[string]interface{}{
					"log_type": "request",
					"status":   int64(200),
					"method":   "POST",
					"path":     "/graphql",
					"query":    "",
					"ip":       "[REDACTED]",
				}
				additionalExpectedKeys1 := []string{
					"user_agent",
					"latency",
					"config_version",
					"request_id",
					"pid",
					"hostname",
				}
				checkValues(t, requestContext1, expectedValues1, additionalExpectedKeys1)
			})
		})

		t.Run("handles unresponsive subgraph errors gracefully", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				SubgraphAccessLogsEnabled: true,
				ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
					cfg.Enabled = false
					cfg.Mode = config.SubgraphErrorPropagationModeWrapped
				},
				Subgraphs: testenv.SubgraphsConfig{
					Products: testenv.SubgraphConfig{
						CloseOnStart: true,
					},
				},
				AccessLogFields: []config.CustomAttribute{
					{
						Key:     "request_error",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldRequestError,
						},
					},
				},
				SubgraphAccessLogFields: allSubgraphLogs,
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						All: &config.GlobalHeaderRule{
							Request: []*config.RequestHeaderRule{
								{
									Operation: config.HeaderRuleOperationPropagate,
									Named:     "service-name",
								},
							},
						},
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:  `query employees { employees { id details { forename surname } notes } }`,
					Header: map[string][]string{"service-name": {"service-name"}},
				})
				require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'."}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
				logEntries := xEnv.Observer().All()
				require.Len(t, logEntries, 12)
				requestLog := xEnv.Observer().FilterMessage("/graphql")
				require.Equal(t, requestLog.Len(), 3)

				employeeContext := requestLog.All()[0].ContextMap()
				employeeSubgraphVals := map[string]interface{}{
					"log_type":         "client/subgraph",
					"subgraph_name":    "employees",
					"subgraph_id":      "0",
					"status":           int64(200),
					"method":           "POST",
					"path":             "/graphql",
					"query":            "", // http query is empty
					"ip":               "[REDACTED]",
					"service_name":     "service-name",                                                     // From request header
					"operation_hash":   "13939103824696605913",                                             // From context
					"operation_sha256": "049efe2ebbdf2e4845e69f69cb7965963b118612a6247ab6d91b1961ea0158dc", // From context
					"operation_name":   "employees",                                                        // From context
					"operation_type":   "query",                                                            // From context
				}
				additionalExpectedKeys := []string{
					"user_agent", "latency", "config_version", "request_id", "pid", "hostname", "normalized_time", "parsed_time", "planned_time", "validation_time", "trace_id", "url",
				}
				checkValues(t, employeeContext, employeeSubgraphVals, additionalExpectedKeys)

				productContext := requestLog.All()[1].ContextMap()
				productSubgraphVals := map[string]interface{}{
					"log_type":         "client/subgraph",
					"subgraph_name":    "products",
					"subgraph_id":      "3",
					"status":           int64(0),
					"method":           "POST",
					"path":             "/graphql",
					"query":            "", // http query is empty
					"ip":               "[REDACTED]",
					"service_name":     "service-name",                                                     // From request header
					"operation_hash":   "13939103824696605913",                                             // From context
					"operation_sha256": "049efe2ebbdf2e4845e69f69cb7965963b118612a6247ab6d91b1961ea0158dc", // From context
					"operation_name":   "employees",                                                        // From context
					"operation_type":   "query",                                                            // From context
					"request_error":    true,                                                               // From context
				}
				checkValues(t, productContext, productSubgraphVals, append(additionalExpectedKeys, "response_error_message"))

				graphContext := requestLog.All()[2].ContextMap()
				graphVals := map[string]interface{}{
					"log_type":      "request",
					"status":        int64(200),
					"method":        "POST",
					"path":          "/graphql",
					"query":         "",
					"ip":            "[REDACTED]",
					"request_error": true, // From context
				}
				graphKeys := []string{
					"user_agent",
					"latency",
					"config_version",
					"request_id",
					"pid",
					"hostname",
				}
				checkValues(t, graphContext, graphVals, graphKeys)
			})
		})
	})
}

func checkValues(t *testing.T, requestContext map[string]interface{}, expectedValues map[string]interface{}, additionalExpectedKeys []string) {
	t.Helper()

	require.Lenf(t, requestContext, len(expectedValues)+len(additionalExpectedKeys), "unexpected number of keys")

	for key, val := range expectedValues {
		mapVal, exists := requestContext[key]
		require.Truef(t, exists, "key '%s' not found", key)
		require.Equalf(t, val, mapVal, "expected '%v', got '%v'", val, mapVal)
	}
	for _, key := range additionalExpectedKeys {
		_, exists := requestContext[key]
		require.Truef(t, exists, "key '%s' not found", key)
	}
}
