package integration

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/sdk/metric"
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
		EnableRedis:              true,
		LogObservation: testenv.LogObservationConfig{
			Enabled:  true,
			LogLevel: zapcore.InfoLevel,
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		logEntries := xEnv.Observer().All()
		require.Len(t, logEntries, 12)
		natsLogs := xEnv.Observer().FilterMessageSnippet("Nats Event source enabled").All()
		require.Len(t, natsLogs, 2)
		natsConnectedLogs := xEnv.Observer().FilterMessageSnippet("NATS connection established").All()
		require.Len(t, natsConnectedLogs, 4)
		providerIDFields := xEnv.Observer().FilterField(zap.String("provider_id", "default")).All()
		require.Len(t, providerIDFields, 3)
		kafkaLogs := xEnv.Observer().FilterMessageSnippet("Kafka Event source enabled").All()
		require.Len(t, kafkaLogs, 1)
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
		f, err := logging.NewLogFile(filepath.Join(os.TempDir(), "access.log"), 0640)
		require.NoError(t, err)

		require.FileExists(t, fp)
		info, err := os.Stat(fp)
		require.NoError(t, err)
		require.Equal(t, info.Mode(), os.FileMode(0640))

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

	t.Run("Custom file modes", func(t *testing.T) {
		t.Parallel()

		tests := []struct {
			name         string
			mode         config.FileMode
			expectedMode os.FileMode
		}{
			{
				name:         "Should succeed with default mode",
				mode:         0640,
				expectedMode: 0640,
			},
			{
				name:         "Should succeed with custom mode",
				mode:         0600,
				expectedMode: 0600,
			},
			{
				name:         "Should succeed with zero mode",
				mode:         0,
				expectedMode: 0640,
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				fp := filepath.Join(os.TempDir(), "access_filemode.log")
				f, err := logging.NewLogFile(fp, os.FileMode(tt.mode))

				t.Cleanup(func() {
					if f != nil {
						require.NoError(t, f.Close())
						require.NoError(t, os.RemoveAll(fp))
					}
				})

				require.NoError(t, err)
				require.FileExists(t, fp)
				info, err := os.Stat(fp)
				require.NoError(t, err)
				require.Equal(t, info.Mode(), tt.expectedMode)
			})
		}

	})

	t.Run("subgraph", func(t *testing.T) {
		t.Parallel()

		t.Run("Simple", func(t *testing.T) {
			t.Parallel()

			fp := filepath.Join(t.TempDir(), "access.log")
			f, err := logging.NewLogFile(fp, 0640)
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

func TestFlakyAccessLogs(t *testing.T) {
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
			require.Len(t, logEntries, 6)
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
			require.Len(t, logEntries, 6)
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
			require.Len(t, logEntries, 6)
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
			require.Len(t, logEntries, 6)
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
			require.Len(t, logEntries, 6)
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
				core.WithSubgraphRetryOptions(false, "", 0, 0, 0, "", nil),
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
			require.Len(t, logEntries, 6)
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
				core.WithSubgraphRetryOptions(false, "", 0, 0, 0, "", nil),
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
			require.Equal(t, `{"errors":[{"message":"Cannot query field \"notExists\" on type \"Query\".","path":["query"]}]}`, res.Body)
			logEntries := xEnv.Observer().All()
			require.Len(t, logEntries, 6)
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
				"error_message":  "Cannot query field \"notExists\" on type \"Query\".",
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
				core.WithSubgraphRetryOptions(false, "", 0, 0, 0, "", nil),
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
			require.Len(t, logEntries, 7)
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

			require.NotEmpty(t, logEntries[6].Stack)

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
				core.WithSubgraphRetryOptions(false, "", 0, 0, 0, "", nil),
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
			require.Len(t, logEntries, 7)
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

			require.NotEmpty(t, logEntries[6].Stack)

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
			require.Len(t, logEntries, 6)
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
				require.Len(t, logEntries, 7)
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
				require.Len(t, logEntries, 7)
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
				require.Len(t, logEntries, 7)
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
				require.Len(t, logEntries, 7)
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
				require.Len(t, logEntries, 8)
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
				require.Len(t, logEntries, 7)
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
				require.Len(t, logEntries, 8)
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

	t.Run("expression field logging", func(t *testing.T) {
		t.Parallel()

		t.Run("validate expression evaluation", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t,
				&testenv.Config{
					AccessLogFields: []config.CustomAttribute{
						{
							Key: "service_name",
							ValueFrom: &config.CustomDynamicAttribute{
								RequestHeader: "service-name",
							},
						},
						{
							Key: "operation_hash",
							ValueFrom: &config.CustomDynamicAttribute{
								ContextField: core.ContextFieldOperationHash,
							},
						},
						{
							Key: "url_method_expression",
							ValueFrom: &config.CustomDynamicAttribute{
								Expression: "request.url.method",
							},
						},
					},
					LogObservation: testenv.LogObservationConfig{
						Enabled:  true,
						LogLevel: zapcore.InfoLevel,
					},
				},
				func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query:  `query employees { employees { id } }`,
						Header: map[string][]string{"service-name": {"service-name"}},
					})
					require.JSONEq(t, employeesIDData, res.Body)
					requestLog := xEnv.Observer().FilterMessage("/graphql")
					requestLogAll := requestLog.All()
					requestContext := requestLogAll[0].ContextMap()

					expectedValues := map[string]interface{}{
						"log_type":              "request",
						"status":                int64(200),
						"method":                "POST",
						"path":                  "/graphql",
						"query":                 "",
						"ip":                    "[REDACTED]",
						"service_name":          "service-name",        // From request header
						"operation_hash":        "1163600561566987607", // From context
						"url_method_expression": "POST",                // From expression
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
				},
			)
		})

		t.Run("should be able to use an expression for access logging in feature flags", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t,
				&testenv.Config{
					AccessLogFields: []config.CustomAttribute{
						{
							Key: "url_method_expression",
							ValueFrom: &config.CustomDynamicAttribute{
								Expression: "request.url.method",
							},
						},
					},
					LogObservation: testenv.LogObservationConfig{
						Enabled:  true,
						LogLevel: zapcore.InfoLevel,
					},
				},
				func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query employees { employees { id } }`,
						Header: map[string][]string{
							"X-Feature-Flag": {"myff"},
						},
					})
					require.JSONEq(t, employeesIDData, res.Body)
					requestLog := xEnv.Observer().FilterMessage("/graphql")
					requestLogAll := requestLog.All()
					requestContext := requestLogAll[0].ContextMap()

					expectedValues := map[string]interface{}{
						"log_type":              "request",
						"status":                int64(200),
						"method":                "POST",
						"path":                  "/graphql",
						"query":                 "",
						"ip":                    "[REDACTED]",
						"feature_flag":          "myff",
						"url_method_expression": "POST", // From expression
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
				},
			)
		})

		t.Run("validate expression evaluation for default value", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t,
				&testenv.Config{
					AccessLogFields: []config.CustomAttribute{
						{
							Key: "service_name",
							ValueFrom: &config.CustomDynamicAttribute{
								RequestHeader: "service-name",
							},
						},
						{
							Key: "operation_hash",
							ValueFrom: &config.CustomDynamicAttribute{
								ContextField: core.ContextFieldOperationHash,
							},
						},
						{
							Key:     "test_default_value",
							Default: "value-defined",
							ValueFrom: &config.CustomDynamicAttribute{
								Expression: "request.header.Get('some-value-that-does-not-exist')",
							},
						},
					},
					LogObservation: testenv.LogObservationConfig{
						Enabled:  true,
						LogLevel: zapcore.InfoLevel,
					},
				},
				func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query:  `query employees { employees { id } }`,
						Header: map[string][]string{"service-name": {"service-name"}},
					})
					require.JSONEq(t, employeesIDData, res.Body)
					requestLog := xEnv.Observer().FilterMessage("/graphql")
					requestLogAll := requestLog.All()
					requestContext := requestLogAll[0].ContextMap()

					expectedValues := map[string]interface{}{
						"log_type":           "request",
						"status":             int64(200),
						"method":             "POST",
						"path":               "/graphql",
						"query":              "",
						"ip":                 "[REDACTED]",
						"service_name":       "service-name",        // From request header
						"operation_hash":     "1163600561566987607", // From context
						"test_default_value": "value-defined",       // From expression test default value
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
				},
			)
		})

		t.Run("attempt to run with uncompilable expression", func(t *testing.T) {
			t.Parallel()

			err := testenv.RunWithError(t, &testenv.Config{
				AccessLogFields: []config.CustomAttribute{
					{
						Key: "url_method_expression",
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "request.testing.method",
						},
					},
				},
			}, func(t *testing.T, _ *testenv.Environment) {
				assert.Fail(t, "should not be called")
			})

			require.ErrorContains(t, err, "type expr.Request has no field testing")
		})

		t.Run("attempt to run with expression that returns a non acceptable result", func(t *testing.T) {
			t.Parallel()

			err := testenv.RunWithError(t, &testenv.Config{
				AccessLogFields: []config.CustomAttribute{
					{
						Key: "url_method_expression",
						ValueFrom: &config.CustomDynamicAttribute{
							// upper is a function in exprlang
							Expression: "upper",
						},
					},
				},
			}, func(t *testing.T, _ *testenv.Environment) {
				assert.Fail(t, "should not be called")
			})

			require.ErrorContains(t, err, "disallowed type: func(string) string")
		})

		t.Run("attempt to run with expression that returns nil", func(t *testing.T) {
			t.Parallel()

			err := testenv.RunWithError(t, &testenv.Config{
				AccessLogFields: []config.CustomAttribute{
					{
						Key: "url_method_expression",
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "nil",
						},
					},
				},
			}, func(t *testing.T, _ *testenv.Environment) {
				assert.Fail(t, "should not be called")
			})

			require.ErrorContains(t, err, "disallowed nil")
		})

		t.Run("validate error expression for logging being processed in the router", func(t *testing.T) {
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
						Key:     "expression_url_method",
						Default: "",
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "request.error ?? request.url.method",
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
					core.WithSubgraphRetryOptions(false, "", 0, 0, 0, "", nil),
				},
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				}}, func(t *testing.T, xEnv *testenv.Environment) {
				_, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Header: map[string][]string{
						"service-name": {"service-name"},
					},
					Query: `query employees { employees { id } `, // Missing closing bracket
				})
				require.NoError(t, err)
				requestLog := xEnv.Observer().FilterMessage("/graphql")
				requestContext := requestLog.All()[0].ContextMap()

				expectedValues := map[string]interface{}{
					"log_type":              "request",
					"status":                int64(200),
					"method":                "POST",
					"path":                  "/graphql",
					"query":                 "", // http query is empty
					"ip":                    "[REDACTED]",
					"user_agent":            "Go-http-client/1.1",
					"service_name":          "service-name", // From header
					"error_message":         "unexpected token - got: EOF want one of: [RBRACE IDENT SPREAD]",
					"expression_url_method": "unexpected token - got: EOF want one of: [RBRACE IDENT SPREAD]",
					"request_error":         true,
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

		t.Run("validate the evaluation of the body.raw expression for a query", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t,
				&testenv.Config{
					AccessLogFields: []config.CustomAttribute{
						{
							Key: "service_name",
							ValueFrom: &config.CustomDynamicAttribute{
								RequestHeader: "service-name",
							},
						},
						{
							Key: "operation_hash",
							ValueFrom: &config.CustomDynamicAttribute{
								ContextField: core.ContextFieldOperationHash,
							},
						},
						{
							Key: "expression_body",
							ValueFrom: &config.CustomDynamicAttribute{
								Expression: "request.body.raw",
							},
						},
					},
					LogObservation: testenv.LogObservationConfig{
						Enabled:  true,
						LogLevel: zapcore.InfoLevel,
					},
				},
				func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query:  `query employees { employees { id } }`,
						Header: map[string][]string{"service-name": {"service-name"}},
					})
					require.JSONEq(t, employeesIDData, res.Body)
					requestLog := xEnv.Observer().FilterMessage("/graphql")
					requestLogAll := requestLog.All()
					requestContext := requestLogAll[0].ContextMap()

					expectedValues := map[string]interface{}{
						"log_type":        "request",
						"status":          int64(200),
						"method":          "POST",
						"path":            "/graphql",
						"query":           "",
						"ip":              "[REDACTED]",
						"service_name":    "service-name",                                         // From request header
						"operation_hash":  "1163600561566987607",                                  // From context
						"expression_body": "{\"query\":\"query employees { employees { id } }\"}", // From expression
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
				},
			)
		})

		t.Run("validate the evaluation of the body.raw expression for a file upload", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				AccessLogFields: []config.CustomAttribute{
					{
						Key: "operation_hash",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationHash,
						},
					},
					{
						Key: "expression_body",
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "request.body.raw",
						},
					},
				},
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
				RouterOptions: []core.Option{
					core.WithRouterTrafficConfig(&config.RouterTrafficConfiguration{
						MaxRequestBodyBytes:  5 << 20,
						DecompressionEnabled: true,
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				files := []testenv.FileUpload{
					{VariablesPath: "variables.files.0", FileContent: []byte("Contents of first file")},
					{VariablesPath: "variables.files.1", FileContent: []byte("Contents of second file")},
				}

				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     "mutation($files: [Upload!]!) { multipleUpload(files: $files)}",
					Variables: []byte(`{"files":[null, null]}`),
					Files:     files,
				})

				requestLog := xEnv.Observer().FilterMessage("/graphql")
				requestLogAll := requestLog.All()
				requestContext := requestLogAll[0].ContextMap()

				expectedValues := map[string]interface{}{
					"log_type":        "request",
					"status":          int64(200),
					"method":          "POST",
					"path":            "/graphql",
					"query":           "",
					"ip":              "[REDACTED]",
					"operation_hash":  "12894448895119646991",                                                                                                // From context
					"expression_body": "{\"query\":\"mutation($files: [Upload!]!) { multipleUpload(files: $files)}\",\"variables\":{\"files\":[null,null]}}", // From expression
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

		t.Run("validate the evaluation of the body.raw expression conditionally where body.raw is not evaluated", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t,
				&testenv.Config{
					AccessLogFields: []config.CustomAttribute{
						{
							Key: "service_name",
							ValueFrom: &config.CustomDynamicAttribute{
								RequestHeader: "service-name",
							},
						},
						{
							Key: "operation_hash",
							ValueFrom: &config.CustomDynamicAttribute{
								ContextField: core.ContextFieldOperationHash,
							},
						},
						{
							Key: "expression_body",
							ValueFrom: &config.CustomDynamicAttribute{
								Expression: "request.error ?? request.body.raw",
							},
						},
					},
					LogObservation: testenv.LogObservationConfig{
						Enabled:  true,
						LogLevel: zapcore.InfoLevel,
					},
				},
				func(t *testing.T, xEnv *testenv.Environment) {
					xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query:  `query employees { employees { id2 } }`,
						Header: map[string][]string{"service-name": {"service-name"}},
					})
					requestLog := xEnv.Observer().FilterMessage("/graphql")
					requestLogAll := requestLog.All()
					requestContext := requestLogAll[0].ContextMap()

					expectedValues := map[string]interface{}{
						"log_type":        "request",
						"status":          int64(200),
						"method":          "POST",
						"path":            "/graphql",
						"query":           "",
						"ip":              "[REDACTED]",
						"service_name":    "service-name",                                     // From request header
						"operation_hash":  "13143784263060310243",                             // From context
						"expression_body": "Cannot query field \"id2\" on type \"Employee\".", // From expression
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
				},
			)
		})

		t.Run("validate the evaluation of the body.raw expression conditionally where body.raw is evaluated", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t,
				&testenv.Config{
					AccessLogFields: []config.CustomAttribute{
						{
							Key: "service_name",
							ValueFrom: &config.CustomDynamicAttribute{
								RequestHeader: "service-name",
							},
						},
						{
							Key: "operation_hash",
							ValueFrom: &config.CustomDynamicAttribute{
								ContextField: core.ContextFieldOperationHash,
							},
						},
						{
							Key: "expression_body",
							ValueFrom: &config.CustomDynamicAttribute{
								Expression: "request.error ?? request.body.raw",
							},
						},
					},
					LogObservation: testenv.LogObservationConfig{
						Enabled:  true,
						LogLevel: zapcore.InfoLevel,
					},
				},
				func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query:  `query employees { employees { id } }`,
						Header: map[string][]string{"service-name": {"service-name"}},
					})
					require.JSONEq(t, employeesIDData, res.Body)
					requestLog := xEnv.Observer().FilterMessage("/graphql")
					requestLogAll := requestLog.All()
					requestContext := requestLogAll[0].ContextMap()

					expectedValues := map[string]interface{}{
						"log_type":        "request",
						"status":          int64(200),
						"method":          "POST",
						"path":            "/graphql",
						"query":           "",
						"ip":              "[REDACTED]",
						"service_name":    "service-name",                                         // From request header
						"operation_hash":  "1163600561566987607",                                  // From context
						"expression_body": "{\"query\":\"query employees { employees { id } }\"}", // From expression
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
				},
			)
		})

		t.Run("verify trace.sampled in expression is true when request is sampled", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)

			testenv.Run(t, &testenv.Config{
				AccessLogFields: []config.CustomAttribute{
					{
						Key: "is_sampled",
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "request.trace.sampled",
						},
					},
				},
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
				TraceExporter:                exporter,
				DisableSimulateCloudExporter: true,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employees { id } }`,
				})
				requestLog := xEnv.Observer().FilterMessage("/graphql")
				requestLogAll := requestLog.All()
				requestContextMap := requestLogAll[0].ContextMap()

				require.True(t, requestContextMap["is_sampled"].(bool))

				sn := exporter.GetSpans().Snapshots()
				require.Len(t, sn, 9)
			})
		})

		t.Run("verify trace.sampled in expression is false when request is not sampled", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			exporter := tracetest.NewInMemoryExporter(t)

			testenv.Run(t, &testenv.Config{
				AccessLogFields: []config.CustomAttribute{
					{
						Key: "is_sampled",
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "request.trace.sampled",
						},
					},
				},
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
				TraceExporter:                exporter,
				MetricReader:                 metricReader,
				DisableSimulateCloudExporter: true,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employees { id } }`,
					Header: map[string][]string{
						// traceparent header without sample flag set
						"traceparent": {"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203332-00"}, // 00 = not sampled
					},
				})
				requestLog := xEnv.Observer().FilterMessage("/graphql")
				requestLogAll := requestLog.All()
				requestContextMap := requestLogAll[0].ContextMap()

				require.False(t, requestContextMap["is_sampled"].(bool))

				sn := exporter.GetSpans().Snapshots()
				require.Len(t, sn, 0)
			})
		})

		t.Run("verify response body in expression", func(t *testing.T) {
			t.Parallel()

			t.Run("for successful request", func(t *testing.T) {
				testenv.Run(t, &testenv.Config{
					AccessLogFields: []config.CustomAttribute{
						{
							Key: "response_body",
							ValueFrom: &config.CustomDynamicAttribute{
								Expression: "response.body.raw",
							},
						},
					},
					LogObservation: testenv.LogObservationConfig{
						Enabled:  true,
						LogLevel: zapcore.InfoLevel,
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query myQuery { employees { id } }`,
					})

					requestLog := xEnv.Observer().FilterMessage("/graphql")
					requestLogAll := requestLog.All()
					requestContextMap := requestLogAll[0].ContextMap()

					responseBody := requestContextMap["response_body"].(string)
					require.Equal(t,
						`{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`,
						responseBody)
				})
			})

			t.Run("for unsuccessful request", func(t *testing.T) {
				testenv.Run(t, &testenv.Config{
					AccessLogFields: []config.CustomAttribute{
						{
							Key: "response_body",
							ValueFrom: &config.CustomDynamicAttribute{
								Expression: "response.body.raw",
							},
						},
					},
					LogObservation: testenv.LogObservationConfig{
						Enabled:  true,
						LogLevel: zapcore.InfoLevel,
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query myQuery { employees { id2 } }`,
					})

					requestLog := xEnv.Observer().FilterMessage("/graphql")
					requestLogAll := requestLog.All()
					requestContextMap := requestLogAll[0].ContextMap()

					responseBody := requestContextMap["response_body"].(string)
					require.Equal(t,
						`{"errors":[{"message":"Cannot query field \"id2\" on type \"Employee\".","path":["query","employees"]}]}`,
						responseBody)
				})
			})
		})
	})

	t.Run("verify error codes from engine and not subgraph", func(t *testing.T) {
		t.Run("verify graphql validation error", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t,
				&testenv.Config{
					RouterOptions: []core.Option{
						core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
							UseGraphQLValidationFailedStatus: config.ApolloCompatibilityFlag{
								Enabled: true,
							},
						}),
					},
					AccessLogFields: []config.CustomAttribute{
						{
							Key: "error_codes",
							ValueFrom: &config.CustomDynamicAttribute{
								ContextField: core.ContextFieldGraphQLErrorCodes,
							},
						},
					},
					LogObservation: testenv.LogObservationConfig{
						Enabled:  true,
						LogLevel: zapcore.InfoLevel,
					},
				},
				func(t *testing.T, xEnv *testenv.Environment) {
					response, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
						Query: `query employees { employees2 { id } }`,
					})
					require.NoError(t, err)
					require.Equal(t, http.StatusBadRequest, response.Response.StatusCode)

					requestLog := xEnv.Observer().FilterMessage("/graphql")
					requestLogAll := requestLog.All()
					requestContext := requestLogAll[0].ContextMap()

					actual, ok := requestContext["error_codes"].([]interface{})
					if !ok {
						require.Fail(t, "error_codes error when casting")
					}

					require.Len(t, actual, 1)
					require.Equal(t, "GRAPHQL_VALIDATION_FAILED", actual[0])
				},
			)
		})

		t.Run("verify graphql bad input error", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t,
				&testenv.Config{
					RouterOptions: []core.Option{
						core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
							ReplaceInvalidVarErrors: config.ApolloCompatibilityFlag{
								Enabled: true,
							},
						}),
					},
					AccessLogFields: []config.CustomAttribute{
						{
							Key: "error_codes",
							ValueFrom: &config.CustomDynamicAttribute{
								ContextField: core.ContextFieldGraphQLErrorCodes,
							},
						},
					},
					LogObservation: testenv.LogObservationConfig{
						Enabled:  true,
						LogLevel: zapcore.InfoLevel,
					},
				},
				func(t *testing.T, xEnv *testenv.Environment) {
					xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query employee { employee(id: "7") { id } }`,
					})

					requestLog := xEnv.Observer().FilterMessage("/graphql")
					requestLogAll := requestLog.All()
					requestContext := requestLogAll[0].ContextMap()

					actual, ok := requestContext["error_codes"].([]interface{})
					if !ok {
						require.Fail(t, "error_codes error when casting")
					}

					require.Len(t, actual, 1)
					require.Equal(t, "BAD_USER_INPUT", actual[0])
				},
			)
		})

		t.Run("verify graphql validation input type error", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t,
				&testenv.Config{
					RouterOptions: []core.Option{
						core.WithApolloRouterCompatibilityFlags(config.ApolloRouterCompatibilityFlags{
							ReplaceInvalidVarErrors: config.ApolloCompatibilityFlag{
								Enabled: true,
							},
						}),
					},
					AccessLogFields: []config.CustomAttribute{
						{
							Key: "error_codes",
							ValueFrom: &config.CustomDynamicAttribute{
								ContextField: core.ContextFieldGraphQLErrorCodes,
							},
						},
					},
					LogObservation: testenv.LogObservationConfig{
						Enabled:  true,
						LogLevel: zapcore.InfoLevel,
					},
				},
				func(t *testing.T, xEnv *testenv.Environment) {
					xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query employee { employee(id: "7") { id } }`,
					})

					requestLog := xEnv.Observer().FilterMessage("/graphql")
					requestLogAll := requestLog.All()
					requestContext := requestLogAll[0].ContextMap()

					actual, ok := requestContext["error_codes"].([]interface{})
					if !ok {
						require.Fail(t, "error_codes error when casting")
					}

					require.Len(t, actual, 1)
					require.Equal(t, "VALIDATION_INVALID_TYPE_VARIABLE", actual[0])
				},
			)
		})

	})

	t.Run("verify batching operation id is printed", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t,
			&testenv.Config{
				BatchingConfig: config.BatchingConfig{
					Enabled:            true,
					MaxConcurrency:     10,
					MaxEntriesPerBatch: 100,
				},
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
			},
			func(t *testing.T, xEnv *testenv.Environment) {
				queries := []testenv.GraphQLRequest{
					{
						Query: `query employees { employees { id } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
				}
				res, err := xEnv.MakeGraphQLBatchedRequestRequest(queries, nil)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)

				requestLog := xEnv.Observer().FilterMessage("/graphql")
				requestLogAll := requestLog.All()
				require.Len(t, requestLogAll, len(queries))

				batchedIds := make([]string, 0)
				for i := 0; i < len(queries); i++ {
					if actual, ok := requestLogAll[i].ContextMap()["batched_request_operation_id"].(string); ok {
						batchedIds = append(batchedIds, actual)
					}
				}

				expectedBatchIds := []string{
					"batch-operation-0",
					"batch-operation-1",
					"batch-operation-2",
				}

				require.ElementsMatch(t, expectedBatchIds, batchedIds)
			},
		)
	})
	t.Run("verify batching operation id is not printed for normal requests", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t,
			&testenv.Config{
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
			},
			func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query employee { employee(id: "7") { id } }`,
				})

				requestLog := xEnv.Observer().FilterMessage("/graphql")
				requestLogAll := requestLog.All()

				batchOperationId, ok := requestLogAll[0].ContextMap()["batched_request_operation_id"].(string)
				assert.False(t, ok)
				assert.Empty(t, batchOperationId)
			},
		)
	})

	t.Run("verify subgraph expressions", func(t *testing.T) {
		t.Parallel()

		t.Run("verify subgraph fetch duration value is attached", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				SubgraphAccessLogsEnabled: true,
				SubgraphAccessLogFields: []config.CustomAttribute{
					{
						Key: "fetch_duration",
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "subgraph.request.clientTrace.fetchDuration",
						},
					},
				},
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employees { id } }`,
				})
				requestLog := xEnv.Observer().FilterMessage("/graphql")
				requestLogAll := requestLog.All()
				requestContextMap := requestLogAll[0].ContextMap()

				fetchDuration, ok := requestContextMap["fetch_duration"].(time.Duration)
				require.True(t, ok)
				require.Greater(t, int(fetchDuration), 0)
			})
		})

		t.Run("verify subgraph fetch duration value is attached for multiple subgraph calls", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				SubgraphAccessLogsEnabled: true,
				SubgraphAccessLogFields: []config.CustomAttribute{
					{
						Key: "fetch_duration",
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "subgraph.request.clientTrace.fetchDuration",
						},
					},
				},
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employees { id isAvailable } }`,
				})
				requestLog := xEnv.Observer().FilterMessage("/graphql")
				requestLogAll := requestLog.All()

				employeeSubgraphLogs := requestLogAll[0]
				fetchDuration1, ok := employeeSubgraphLogs.ContextMap()["fetch_duration"].(time.Duration)
				require.True(t, ok)
				require.Greater(t, int(fetchDuration1), 0)

				availabilitySubgraphLogs := requestLogAll[1]
				fetchDuration2, ok := availabilitySubgraphLogs.ContextMap()["fetch_duration"].(time.Duration)
				require.True(t, ok)
				require.Greater(t, int(fetchDuration2), 0)
			})
		})

		t.Run("verify subgraph fetch duration in conditional expression", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				SubgraphAccessLogsEnabled: true,
				SubgraphAccessLogFields: []config.CustomAttribute{
					{
						Key: "fetch_duration",
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "subgraph.request.error != nil ? subgraph.request.clientTrace.fetchDuration : ''",
						},
					},
				},
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
				Subgraphs: testenv.SubgraphsConfig{
					Availability: testenv.SubgraphConfig{
						Middleware: func(_ http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
								w.Header().Set("Content-Type", "application/json")
								w.WriteHeader(http.StatusForbidden)
								_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}`))
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employees { id isAvailable } }`,
				})
				requestLog := xEnv.Observer().FilterMessage("/graphql")
				requestLogAll := requestLog.All()

				employeeSubgraphLogs := requestLogAll[0]
				_, ok := employeeSubgraphLogs.ContextMap()["fetch_duration"]
				require.False(t, ok)

				availabilitySubgraphLogs := requestLogAll[1]
				fetchDuration2, ok := availabilitySubgraphLogs.ContextMap()["fetch_duration"].(time.Duration)
				require.True(t, ok)
				require.Greater(t, int(fetchDuration2), 0)
			})
		})

		t.Run("verify connAcquireDuration value is attached", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				SubgraphAccessLogsEnabled: true,
				SubgraphAccessLogFields: []config.CustomAttribute{
					{
						Key: "conn_acquire_duration",
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "subgraph.request.clientTrace.connAcquireDuration",
						},
					},
				},
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employees { id } }`,
				})
				requestLog := xEnv.Observer().FilterMessage("/graphql")
				requestLogAll := requestLog.All()
				requestContextMap := requestLogAll[0].ContextMap()

				connAcquireDuration, ok := requestContextMap["conn_acquire_duration"].(time.Duration)
				require.True(t, ok)

				require.Greater(t, int(connAcquireDuration), 0)
			})
		})

		t.Run("verify connAcquireDuration value is attached for multiple subgraph calls", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				SubgraphAccessLogsEnabled: true,
				SubgraphAccessLogFields: []config.CustomAttribute{
					{
						Key: "conn_acquire_duration",
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "subgraph.request.clientTrace.connAcquireDuration",
						},
					},
				},
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employees { id isAvailable } }`,
				})
				requestLog := xEnv.Observer().FilterMessage("/graphql")
				requestLogAll := requestLog.All()

				employeeSubgraphLogs := requestLogAll[0]
				connAcquireDuration1, ok := employeeSubgraphLogs.ContextMap()["conn_acquire_duration"].(time.Duration)
				require.True(t, ok)
				require.Greater(t, int(connAcquireDuration1), 0)

				availabilitySubgraphLogs := requestLogAll[1]
				connAcquireDuration2, ok := availabilitySubgraphLogs.ContextMap()["conn_acquire_duration"].(time.Duration)
				require.True(t, ok)
				require.Greater(t, int(connAcquireDuration2), 0)
			})
		})

		t.Run("verify subgraph error in expressions", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				SubgraphAccessLogsEnabled: true,
				SubgraphAccessLogFields: []config.CustomAttribute{
					{
						Key: "conn_acquire_duration",
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "subgraph.request.error != nil ? subgraph.request.clientTrace.connAcquireDuration : ''",
						},
					},
				},
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
				Subgraphs: testenv.SubgraphsConfig{
					Availability: testenv.SubgraphConfig{
						Middleware: func(_ http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
								w.Header().Set("Content-Type", "application/json")
								w.WriteHeader(http.StatusForbidden)
								_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}`))
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employees { id isAvailable } }`,
				})
				requestLog := xEnv.Observer().FilterMessage("/graphql")
				requestLogAll := requestLog.All()

				employeeSubgraphLogs := requestLogAll[0]
				_, ok := employeeSubgraphLogs.ContextMap()["conn_acquire_duration"]
				require.False(t, ok)

				availabilitySubgraphLogs := requestLogAll[1]
				connAcquireDuration2, ok := availabilitySubgraphLogs.ContextMap()["conn_acquire_duration"].(time.Duration)
				require.True(t, ok)
				require.Greater(t, int(connAcquireDuration2), 0)
			})
		})

		t.Run("verify cleanup of attributes which contains expression and other attributes", func(t *testing.T) {
			t.Parallel()

			key := "conn_acquire_duration"
			testenv.Run(t, &testenv.Config{
				SubgraphAccessLogsEnabled: true,
				SubgraphAccessLogFields: []config.CustomAttribute{
					{
						Key: key,
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: "operation_hash",
							Expression:   "subgraph.request.clientTrace.connAcquireDuration",
						},
					},
				},
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employees { id } }`,
				})
				requestLog := xEnv.Observer().FilterMessage("/graphql")
				requestLogAll := requestLog.All()
				requestContextMap := requestLogAll[0].ContextMap()

				keyCount := 0
				for _, entry := range requestLogAll[0].Context {
					if entry.Key == key {
						keyCount++
					}
				}

				// There should  only be one instance of the key
				require.Equal(t, 1, keyCount)

				connAcquireDuration, ok := requestContextMap["conn_acquire_duration"].(time.Duration)
				require.True(t, ok)
				require.Greater(t, int(connAcquireDuration), 0)
			})
		})

		t.Run("verify subgraph response body printed", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				SubgraphAccessLogsEnabled: true,
				SubgraphAccessLogFields: []config.CustomAttribute{
					{
						Key: "response_body",
						ValueFrom: &config.CustomDynamicAttribute{
							Expression: "subgraph.response.body.raw",
						},
					},
				},
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employees { isAvailable products hobbies { employees { id tag } } }  }`,
				})
				requestLog := xEnv.Observer().FilterMessage("/graphql")

				actual1 := requestLog.All()[0].ContextMap()["response_body"].(string)
				require.Equal(t,
					`{"data":{"employees":[{"__typename":"Employee","id":1},{"__typename":"Employee","id":2},{"__typename":"Employee","id":3},{"__typename":"Employee","id":4},{"__typename":"Employee","id":5},{"__typename":"Employee","id":7},{"__typename":"Employee","id":8},{"__typename":"Employee","id":10},{"__typename":"Employee","id":11},{"__typename":"Employee","id":12}]}}`,
					actual1)

				actual2 := requestLog.All()[1].ContextMap()["response_body"].(string)
				require.Equal(t,
					`{"data":{"_entities":[{"__typename":"Employee","isAvailable":false},{"__typename":"Employee","isAvailable":false},{"__typename":"Employee","isAvailable":false},{"__typename":"Employee","isAvailable":false},{"__typename":"Employee","isAvailable":false},{"__typename":"Employee","isAvailable":false},{"__typename":"Employee","isAvailable":false},{"__typename":"Employee","isAvailable":false},{"__typename":"Employee","isAvailable":false},{"__typename":"Employee","isAvailable":false}]}}`,
					actual2)

				actual3 := requestLog.All()[2].ContextMap()["response_body"].(string)
				require.Equal(t,
					`{"data":{"_entities":[{"__typename":"Employee","products":["CONSULTANCY","COSMO","ENGINE","MARKETING","SDK"]},{"__typename":"Employee","products":["COSMO","SDK"]},{"__typename":"Employee","products":["CONSULTANCY","MARKETING"]},{"__typename":"Employee","products":["FINANCE","HUMAN_RESOURCES","MARKETING"]},{"__typename":"Employee","products":["ENGINE","SDK"]},{"__typename":"Employee","products":["COSMO","SDK"]},{"__typename":"Employee","products":["COSMO","SDK"]},{"__typename":"Employee","products":["CONSULTANCY","COSMO","SDK"]},{"__typename":"Employee","products":["FINANCE"]},{"__typename":"Employee","products":["CONSULTANCY","COSMO","ENGINE","SDK"]}]}}`,
					actual3)

				actual4 := requestLog.All()[3].ContextMap()["response_body"].(string)
				require.Equal(t,
					`{"data":{"_entities":[{"__typename":"Employee","hobbies":[{"employees":[{"id":1,"__typename":"Employee"},{"id":2,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":4,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":2,"__typename":"Employee"},{"id":7,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":7,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":11,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":2,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":4,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]}]},{"__typename":"Employee","hobbies":[{"employees":[{"id":1,"__typename":"Employee"},{"id":2,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":4,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":2,"__typename":"Employee"},{"id":7,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":2,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]}]},{"__typename":"Employee","hobbies":[{"employees":[{"id":1,"__typename":"Employee"},{"id":2,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":4,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":2,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":4,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":7,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":11,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":4,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]}]},{"__typename":"Employee","hobbies":[{"employees":[{"id":1,"__typename":"Employee"},{"id":2,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":4,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]},{"employees":[{"id":4,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":4,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]}]},{"__typename":"Employee","hobbies":[{"employees":[{"id":1,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":7,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":11,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":7,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":11,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":7,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":11,"__typename":"Employee"}]}]},{"__typename":"Employee","hobbies":[{"employees":[{"id":1,"__typename":"Employee"},{"id":2,"__typename":"Employee"},{"id":7,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":7,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":11,"__typename":"Employee"}]}]},{"__typename":"Employee","hobbies":[{"employees":[{"id":1,"__typename":"Employee"},{"id":2,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":4,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":2,"__typename":"Employee"},{"id":7,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":7,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":11,"__typename":"Employee"}]}]},{"__typename":"Employee","hobbies":[{"employees":[{"id":1,"__typename":"Employee"},{"id":2,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":2,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":4,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":2,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":4,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":2,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":4,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":7,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":11,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":4,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]}]},{"__typename":"Employee","hobbies":[{"employees":[{"id":1,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":7,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":11,"__typename":"Employee"}]}]},{"__typename":"Employee","hobbies":[{"employees":[{"id":1,"__typename":"Employee"},{"id":2,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":2,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":4,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":2,"__typename":"Employee"},{"id":7,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]},{"employees":[{"id":1,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":4,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]}]}]}}`,
					actual4)

				actual5 := requestLog.All()[4].ContextMap()["response_body"].(string)
				require.Equal(t,
					`{"data":{"_entities":[{"__typename":"Employee","tag":""},{"__typename":"Employee","tag":""},{"__typename":"Employee","tag":""},{"__typename":"Employee","tag":""},{"__typename":"Employee","tag":""},{"__typename":"Employee","tag":""},{"__typename":"Employee","tag":""},{"__typename":"Employee","tag":""},{"__typename":"Employee","tag":""},{"__typename":"Employee","tag":""}]}}`,
					actual5)
			})
		})

	})

	t.Run("verify ignore list", func(t *testing.T) {
		t.Parallel()

		t.Run("without any ignored values", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				variables := `{"criteria":  {"nationality":  "GERMAN"   }}`
				persistedQueries := `{"persistedQuery": {"version": 1, "sha256Hash": "e33580cf6276de9a75fb3b1c4b7580fec2a1c8facd13f3487bf6c7c3f854f7e3"}}`
				operationName := `Find`

				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
					OperationName: []byte(operationName),
					Variables:     []byte(variables),
					Extensions:    []byte(persistedQueries),
					Header:        header,
				})
				require.NoError(t, err)
				require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, res.Body)

				requestLog := xEnv.Observer().FilterMessage("/graphql")
				require.Equal(t, 1, requestLog.Len())
				requestContext := requestLog.All()[0].ContextMap()

				query := requestContext["query"].(string)

				rawQueryString := fmt.Sprintf("extensions=%s&operationName=%s&variables=%s",
					url.QueryEscape(persistedQueries),
					url.QueryEscape(operationName),
					url.QueryEscape(variables))
				require.Equal(t, rawQueryString, query)

				parseQuery, err := url.ParseQuery(query)
				require.NoError(t, err)

				require.Equal(t, variables, parseQuery.Get("variables"))
				require.Equal(t, operationName, parseQuery.Get("operationName"))
				require.Equal(t, persistedQueries, parseQuery.Get("extensions"))
			})
		})

		t.Run("with ignored values", func(t *testing.T) {
			t.Parallel()

			ignoreList := []string{
				"operationName",
				"variables",
			}

			testenv.Run(t, &testenv.Config{
				IgnoreQueryParamsList: ignoreList,
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				variables := `{"criteria":  {"nationality":  "GERMAN"   }}`
				persistedQueries := `{"persistedQuery": {"version": 1, "sha256Hash": "e33580cf6276de9a75fb3b1c4b7580fec2a1c8facd13f3487bf6c7c3f854f7e3"}}`
				operationName := `Find`

				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
					OperationName: []byte(operationName),
					Variables:     []byte(variables),
					Extensions:    []byte(persistedQueries),
					Header:        header,
				})
				require.NoError(t, err)
				require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, res.Body)

				requestLog := xEnv.Observer().FilterMessage("/graphql")
				require.Equal(t, 1, requestLog.Len())
				requestContext := requestLog.All()[0].ContextMap()

				query := requestContext["query"].(string)

				rawQueryString := "extensions=" + url.QueryEscape(persistedQueries)

				require.Equal(t, rawQueryString, query)

				parseQuery, err := url.ParseQuery(query)
				require.NoError(t, err)

				require.Empty(t, parseQuery.Get("variables"))
				require.Empty(t, parseQuery.Get("operationName"))
				require.Equal(t, persistedQueries, parseQuery.Get("extensions"))
			})
		})

		t.Run("with POST while including query params", func(t *testing.T) {
			t.Parallel()

			customQueryParamHeaderName := "somekey"
			customQueryParamHeaderValue := "somevalue"

			ignoreList := []string{
				customQueryParamHeaderName,
			}

			testenv.Run(t, &testenv.Config{
				IgnoreQueryParamsList: ignoreList,
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.InfoLevel,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				request := testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
				}
				data, err := json.Marshal(request)
				require.NoError(t, err)
				req, err := http.NewRequestWithContext(xEnv.Context, http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(data))
				require.NoError(t, err)
				req.Header.Set("Accept-Encoding", "identity")

				additionalKey := "anothervariable"
				additionalValue := "anothervalue"

				q := req.URL.Query()
				q.Add(customQueryParamHeaderName, customQueryParamHeaderValue)
				q.Add(additionalKey, additionalValue)
				req.URL.RawQuery = q.Encode()

				res, err := xEnv.MakeGraphQLRequestRaw(req)
				require.NoError(t, err)
				require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)

				requestLog := xEnv.Observer().FilterMessage("/graphql")
				require.Equal(t, 1, requestLog.Len())
				requestContext := requestLog.All()[0].ContextMap()

				query := requestContext["query"].(string)

				rawQueryString := fmt.Sprintf("%s=%s", additionalKey, url.QueryEscape(additionalValue))
				require.Equal(t, rawQueryString, query)

				parseQuery, err := url.ParseQuery(query)
				require.NoError(t, err)

				require.Empty(t, parseQuery.Get(customQueryParamHeaderName))
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
