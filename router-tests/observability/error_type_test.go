package integration

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	io_prometheus_client "github.com/prometheus/client_model/go"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutils"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap/zapcore"
)

func TestErrorTypeClassification(t *testing.T) {
	t.Parallel()

	t.Run("validation_error on malformed query", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			AccessLogFields:    errorTypeAccessLogFields(),
			LogObservation:     enabledLogObservation(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			_, _ = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query employees { employees { id }`, // Missing closing bracket
			})

			assertErrorTypeInMetrics(t, promRegistry, "validation_error")
			assertErrorTypeInAccessLog(t, xEnv, "validation_error")
		})
	})

	t.Run("input_error on invalid request body", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			AccessLogFields:    errorTypeAccessLogFields(),
			LogObservation:     enabledLogObservation(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			_, _ = xEnv.MakeRequest(http.MethodPost, "/graphql", http.Header{
				"Content-Type": []string{"application/json"},
			}, strings.NewReader(`{invalid json`))

			assertErrorTypeInMetrics(t, promRegistry, "input_error")
			assertErrorTypeInAccessLog(t, xEnv, "input_error")
		})
	})

	t.Run("operation_blocked on blocked mutation", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			AccessLogFields:    errorTypeAccessLogFields(),
			LogObservation:     enabledLogObservation(),
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.BlockMutations = config.BlockOperationConfiguration{
					Enabled: true,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			_, _ = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
			})

			assertErrorTypeInMetrics(t, promRegistry, "operation_blocked")
			assertErrorTypeInAccessLog(t, xEnv, "operation_blocked")
		})
	})

	t.Run("unauthorized on missing auth", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		authenticators, _ := testutils.ConfigureAuth(t)
		accessController, err := core.NewAccessController(core.AccessControllerOptions{
			Authenticators:           authenticators,
			AuthenticationRequired:   true,
			SkipIntrospectionQueries: false,
		})
		require.NoError(t, err)

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			AccessLogFields:    errorTypeAccessLogFields(),
			LogObservation:     enabledLogObservation(),
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// No auth header → unauthorized
			_, _ = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})

			assertErrorTypeInMetrics(t, promRegistry, "unauthorized")
			assertErrorTypeInAccessLog(t, xEnv, "unauthorized")
		})
	})

	t.Run("persisted_operation_not_found on unknown hash", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			AccessLogFields:    errorTypeAccessLogFields(),
			LogObservation:     enabledLogObservation(),
			ApqConfig: config.AutomaticPersistedQueriesConfig{
				Enabled: true,
				Cache: config.AutomaticPersistedQueriesCacheConfig{
					Size: 1024 * 1024,
					TTL:  300,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Send a persisted query hash that doesn't exist
			_, _ = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Extensions: []byte(`{"persistedQuery":{"version":1,"sha256Hash":"0000000000000000000000000000000000000000000000000000000000000000"}}`),
			})

			assertErrorTypeInMetrics(t, promRegistry, "persisted_operation_not_found")
			assertErrorTypeInAccessLog(t, xEnv, "persisted_operation_not_found")
		})
	})

	t.Run("context_timeout on slow subgraph", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			NoRetryClient:      true,
			AccessLogFields:    errorTypeAccessLogFields(),
			LogObservation:     enabledLogObservation(),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							time.Sleep(500 * time.Millisecond)
							w.WriteHeader(http.StatusOK)
						})
					},
				},
			},
			RouterOptions: []core.Option{
				core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(config.TrafficShapingRules{
					All: config.GlobalSubgraphRequestRule{
						RequestTimeout: testutils.ToPtr(100 * time.Millisecond),
						BackoffJitterRetry: config.BackoffJitterRetry{
							Enabled: false,
						},
					},
				})),
				core.WithSubgraphRetryOptions(false, "", 0, 0, 0, "", nil),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			_, _ = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})

			assertErrorTypeInMetrics(t, promRegistry, "context_timeout")
			assertErrorTypeInAccessLog(t, xEnv, "context_timeout")
		})
	})

	t.Run("subgraph_error on subgraph failure", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			NoRetryClient:      true,
			AccessLogFields:    errorTypeAccessLogFields(),
			LogObservation:     enabledLogObservation(),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusForbidden)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Forbidden","extensions":{"code":"UNAUTHORIZED"}}]}`))
						})
					},
				},
			},
			RouterOptions: []core.Option{
				core.WithSubgraphRetryOptions(false, "", 0, 0, 0, "", nil),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			_, _ = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})

			assertErrorTypeInMetrics(t, promRegistry, "subgraph_error")
			assertErrorTypeInAccessLog(t, xEnv, "subgraph_error")
		})
	})

	t.Run("rate_limit on exceeded limit", func(t *testing.T) {
		if testing.Short() {
			t.Skip("skipping test in short mode.")
		}
		t.Parallel()

		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		key := uuid.New().String()
		t.Cleanup(func() {
			client := redis.NewClient(&redis.Options{Addr: "localhost:6379", Password: "test"})
			client.Del(context.Background(), key)
		})

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			AccessLogFields:    errorTypeAccessLogFields(),
			LogObservation:     enabledLogObservation(),
			RouterOptions: []core.Option{
				core.WithRateLimitConfig(&config.RateLimitConfiguration{
					Enabled:  true,
					Strategy: "simple",
					SimpleStrategy: config.RateLimitSimpleStrategy{
						Rate:                    1,
						Burst:                   1,
						Period:                  time.Second * 2,
						RejectExceedingRequests: true,
					},
					Storage: config.RedisConfiguration{
						URLs:      []string{"redis://localhost:6379"},
						KeyPrefix: key,
					},
					Debug: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// First request consumes the token
			_, _ = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			// Second request exceeds the limit
			_, _ = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})

			assertErrorTypeInMetrics(t, promRegistry, "rate_limit")
			// Access log has 2 entries; the second one has the rate_limit error
			requestLog := xEnv.Observer().FilterMessage("/graphql")
			require.Equal(t, 2, requestLog.Len())
			secondRequest := requestLog.All()[1].ContextMap()
			require.Equal(t, true, secondRequest["request_error"])
			require.Equal(t, "rate_limit", secondRequest["error_type"])
		})
	})
}

// errorTypeAccessLogFields returns the access log config to capture error type via expression and context field.
func errorTypeAccessLogFields() []config.CustomAttribute {
	return []config.CustomAttribute{
		{
			Key: "error_type",
			ValueFrom: &config.CustomDynamicAttribute{
				Expression: "request.errorType",
			},
		},
		{
			Key: "request_error",
			ValueFrom: &config.CustomDynamicAttribute{
				ContextField: core.ContextFieldRequestError,
			},
		},
	}
}

func enabledLogObservation() testenv.LogObservationConfig {
	return testenv.LogObservationConfig{
		Enabled:  true,
		LogLevel: zapcore.InfoLevel,
	}
}

// assertErrorTypeInMetrics verifies the wg_error_type label is present on the error metric.
func assertErrorTypeInMetrics(t *testing.T, promRegistry *prometheus.Registry, expectedErrorType string) {
	t.Helper()
	mf, err := promRegistry.Gather()
	require.NoError(t, err)
	errorMetric := findMetricFamilyByName(mf, "router_http_requests_error_total")
	require.NotNil(t, errorMetric, "expected router_http_requests_error_total metric")
	require.NotNil(t, findErrorTypeLabel(errorMetric.GetMetric(), expectedErrorType),
		"expected wg_error_type=%s in metrics", expectedErrorType)
}

// assertErrorTypeInAccessLog verifies request.errorType expression value in access logs.
func assertErrorTypeInAccessLog(t *testing.T, xEnv *testenv.Environment, expectedErrorType string) {
	t.Helper()
	requestLog := xEnv.Observer().FilterMessage("/graphql")
	require.Equal(t, 1, requestLog.Len())
	requestContext := requestLog.All()[0].ContextMap()
	require.Equal(t, true, requestContext["request_error"])
	require.Equal(t, expectedErrorType, requestContext["error_type"])
}

// findErrorTypeLabel finds a metric with a specific wg_error_type label value.
func findErrorTypeLabel(metrics []*io_prometheus_client.Metric, errorType string) *io_prometheus_client.LabelPair {
	for _, m := range metrics {
		for _, l := range m.GetLabel() {
			if l.GetName() == "wg_error_type" && l.GetValue() == errorType {
				return l
			}
		}
	}
	return nil
}
