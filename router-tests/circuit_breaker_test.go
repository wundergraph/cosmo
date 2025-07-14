package integration

import (
	"context"
	"github.com/prometheus/client_golang/prometheus"
	io_prometheus_client "github.com/prometheus/client_model/go"
	"net/http"
	"sort"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/metric/metricdata/metricdatatest"
	"go.uber.org/zap/zapcore"

	"time"
)

const (
	successSubgraphJSON = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`
	subgraphErrorJSON   = `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'."}],"data":{"employees":null}}`
)

const (
	AttemptSuccessfulRequest = true
	SendFailedRequest        = false
)

type SendRequestOptions struct {
	t                *testing.T
	xEnv             *testenv.Environment
	isSuccessRequest *atomic.Bool
	invertCheck      bool
	customQuery      string
}

func TestFlakyCircuitBreaker(t *testing.T) {
	t.Parallel()

	t.Run("verify circuit breaker becoming half open after sleep window", func(t *testing.T) {
		t.Parallel()

		var requestsToSucceed = 3
		var requestsToFail = 9

		breaker := getCircuitBreakerWithDefaults()
		breaker.HalfOpenAttempts = 2
		breaker.SleepWindow = 2 * time.Second
		breaker.ErrorThresholdPercentage = 70

		trafficConfig := getTrafficConfigWithTimeout(breaker, 1*time.Second)

		var isSuccessRequest atomic.Bool

		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.DebugLevel,
			},
			RouterOptions: []core.Option{
				core.WithSubgraphCircuitBreakerOptions(core.NewSubgraphCircuitBreakerOptions(trafficConfig)),
				core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(trafficConfig)),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							if isSuccessRequest.Load() {
								_, err := w.Write([]byte(successSubgraphJSON))
								require.NoError(t, err)
							} else {
								simulateConnectionFailureOnClose(w)
							}
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			opts := SendRequestOptions{t: t, xEnv: xEnv, isSuccessRequest: &isSuccessRequest}

			for range requestsToSucceed {
				sendRequest(opts, "", AttemptSuccessfulRequest)
			}
			for range requestsToFail {
				sendRequest(opts, "", SendFailedRequest)
			}

			// Baseline verification
			require.Equal(t, 1, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())
			require.Equal(t, 2, xEnv.Observer().FilterMessage("Circuit breaker open, request callback did not execute").Len())

			// Wait for the circuit breaker to become half open
			time.Sleep(breaker.SleepWindow + 100*time.Millisecond)

			// We try to send a call when its half open, but it fails, making it fully open again
			// Half Open Attempt 1 and 2: Failure
			sendRequest(opts, "", SendFailedRequest)
			sendRequest(opts, "", SendFailedRequest)
			// Since the closing attempts failed we should still have the same length as before
			require.Equal(t, 1, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())

			// Wait for the circuit breaker to become half open for the second time
			time.Sleep(breaker.SleepWindow + 100*time.Millisecond)

			sendRequest(opts, "", AttemptSuccessfulRequest)

			message := xEnv.Observer().FilterMessage("Circuit breaker status changed")
			require.Equal(t, 2, message.Len())

			contextMap := message.All()[1].ContextMap()
			require.False(t, contextMap["is_open"].(bool))
		})
	})

	t.Run("verify number of required successful attempts to close circuit breaker", func(t *testing.T) {
		t.Parallel()

		var requestsToSucceed = 3
		var requestsToFail = 9

		// Use defaults, but override required
		breaker := getCircuitBreakerWithDefaults()
		breaker.HalfOpenAttempts = 2
		breaker.SleepWindow = 2 * time.Second
		breaker.ErrorThresholdPercentage = 70
		breaker.RequiredSuccessfulAttempts = 3

		trafficConfig := getTrafficConfigWithTimeout(breaker, 1*time.Second)

		var isSuccessRequest atomic.Bool

		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.DebugLevel,
			},
			RouterOptions: []core.Option{
				core.WithSubgraphCircuitBreakerOptions(core.NewSubgraphCircuitBreakerOptions(trafficConfig)),
				core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(trafficConfig)),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							if isSuccessRequest.Load() {
								_, err := w.Write([]byte(successSubgraphJSON))
								require.NoError(t, err)
							} else {
								simulateConnectionFailureOnClose(w)
							}
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			opts := SendRequestOptions{t: t, xEnv: xEnv, isSuccessRequest: &isSuccessRequest}

			for range requestsToSucceed {
				sendRequest(opts, "", AttemptSuccessfulRequest)
			}
			for range requestsToFail {
				sendRequest(opts, "", SendFailedRequest)
			}

			// Baseline verification
			require.Equal(t, 1, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())
			require.Equal(t, 2, xEnv.Observer().FilterMessage("Circuit breaker open, request callback did not execute").Len())

			// Wait for the circuit breaker to become half open
			time.Sleep(breaker.SleepWindow + 100*time.Millisecond)

			// We need three successful attempts to close the circuit breaker
			// Attempt 1 and 2 to open
			sendRequest(opts, "", AttemptSuccessfulRequest)
			sendRequest(opts, "", AttemptSuccessfulRequest)

			// We are attempting a successful request, however since the state
			// is still half-open, and the max attempts is 2 this will cause
			// the request to fail
			optsCopy := opts
			optsCopy.invertCheck = true
			sendRequest(optsCopy, "", AttemptSuccessfulRequest)

			// Verify that nothing has changed despite two successful attempts
			require.Equal(t, 1, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())

			time.Sleep(breaker.SleepWindow + 100*time.Millisecond)

			sendRequest(opts, "", AttemptSuccessfulRequest)

			// Should be changed
			message := xEnv.Observer().FilterMessage("Circuit breaker status changed")
			require.Equal(t, 2, message.Len())

			contextMap := message.All()[1].ContextMap()
			require.False(t, contextMap["is_open"].(bool))
		})
	})

	t.Run("verify circuit breaker rolling window", func(t *testing.T) {
		t.Parallel()

		breaker := getCircuitBreakerWithDefaults()
		breaker.NumBuckets = 5
		breaker.RequestThreshold = 5
		breaker.RollingDuration = 10000 * time.Millisecond
		breaker.ErrorThresholdPercentage = 90

		durationPerBucket := breaker.RollingDuration / time.Duration(breaker.NumBuckets)

		trafficConfig := getTrafficConfigWithTimeout(breaker, 10*time.Millisecond)

		var isSuccessRequest atomic.Bool

		t.Run("with one request per bucket", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.DebugLevel,
				},
				RouterOptions: []core.Option{
					core.WithSubgraphCircuitBreakerOptions(core.NewSubgraphCircuitBreakerOptions(trafficConfig)),
					core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(trafficConfig)),
				},
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(_ http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
								if isSuccessRequest.Load() {
									_, err := w.Write([]byte(successSubgraphJSON))
									require.NoError(t, err)
								} else {
									simulateConnectionFailureOnClose(w)
								}
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				opts := SendRequestOptions{t: t, xEnv: xEnv, isSuccessRequest: &isSuccessRequest}
				t.Log("Bucket 1", time.Now())
				time.Sleep(durationPerBucket)
				sendRequest(opts, "", SendFailedRequest)

				t.Log("Bucket 2", time.Now())
				time.Sleep(durationPerBucket)
				sendRequest(opts, "", SendFailedRequest)

				t.Log("Bucket 3", time.Now())
				time.Sleep(durationPerBucket)
				sendRequest(opts, "", AttemptSuccessfulRequest)

				t.Log("Bucket 4", time.Now())
				time.Sleep(durationPerBucket)
				sendRequest(opts, "", SendFailedRequest)

				t.Log("Bucket 5", time.Now())
				time.Sleep(durationPerBucket)
				sendRequest(opts, "", SendFailedRequest)

				// Circuit breaker should not have triggered as bucket 3 has not been evicted to meet 90% err rate
				message := xEnv.Observer().FilterMessage("Circuit breaker status changed")
				require.Zero(t, message.Len())

				t.Log("Bucket 6: evict bucket 1", time.Now())
				time.Sleep(durationPerBucket)
				sendRequest(opts, "", SendFailedRequest)

				t.Log("Bucket 7: evict bucket 2", time.Now())
				time.Sleep(durationPerBucket)
				sendRequest(opts, "", SendFailedRequest)

				// Circuit breaker should not have triggered as bucket 3 has not been evicted to meet 90% err rate
				message = xEnv.Observer().FilterMessage("Circuit breaker status changed")
				require.Zero(t, message.Len())

				t.Log("Bucket 8: evict bucket 3", time.Now())
				time.Sleep(durationPerBucket)
				sendRequest(opts, "", SendFailedRequest)

				// Evict bucket 3 with true causing a 100% error rate
				message = xEnv.Observer().FilterMessage("Circuit breaker status changed")
				require.Equal(t, 1, message.Len())
			})
		})

		t.Run("with multiple requests per bucket", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				LogObservation: testenv.LogObservationConfig{
					Enabled:  true,
					LogLevel: zapcore.DebugLevel,
				},
				RouterOptions: []core.Option{
					core.WithSubgraphCircuitBreakerOptions(core.NewSubgraphCircuitBreakerOptions(trafficConfig)),
					core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(trafficConfig)),
				},
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(_ http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
								if isSuccessRequest.Load() {
									_, err := w.Write([]byte(successSubgraphJSON))
									require.NoError(t, err)
								} else {
									simulateConnectionFailureOnClose(w)
								}
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				opts := SendRequestOptions{t: t, xEnv: xEnv, isSuccessRequest: &isSuccessRequest}
				t.Log("Bucket 1")
				time.Sleep(durationPerBucket)
				sendRequest(opts, "", SendFailedRequest)
				sendRequest(opts, "", SendFailedRequest)
				require.Zero(t, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())

				t.Log("Bucket 2")
				time.Sleep(durationPerBucket)
				sendRequest(opts, "", SendFailedRequest)
				sendRequest(opts, "", SendFailedRequest)
				require.Zero(t, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())

				t.Log("Bucket 3")
				time.Sleep(durationPerBucket)
				sendRequest(opts, "", AttemptSuccessfulRequest)
				sendRequest(opts, "", SendFailedRequest)
				sendRequest(opts, "", SendFailedRequest)
				sendRequest(opts, "", SendFailedRequest)
				require.Zero(t, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())

				// 1/9 successful requests
				t.Log("Bucket 4")
				time.Sleep(durationPerBucket)
				sendRequest(opts, "", SendFailedRequest)
				require.Zero(t, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())

				t.Log("Bucket 5")
				time.Sleep(durationPerBucket)

				// 1/8 successful requests
				t.Log("Bucket 6: evict bucket 1")
				time.Sleep(durationPerBucket)
				sendRequest(opts, "", SendFailedRequest)
				require.Zero(t, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())

				// 1/8 successful requests
				t.Log("Bucket 7: evict bucket 2")
				time.Sleep(durationPerBucket)
				sendRequest(opts, "", SendFailedRequest)
				sendRequest(opts, "", SendFailedRequest)
				require.Zero(t, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())

				t.Log("Bucket 8: evict bucket 3")
				time.Sleep(durationPerBucket)
				// We have 0/4 successful requests right now, this means 100% error rate
				// but we are under the threshold of 5 requests to trigger the circuit
				require.Zero(t, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())

				sendRequest(opts, "", SendFailedRequest)

				// 0/5 successful requests, which means err percentage is over 90% (100%) and 5 requests
				require.Equal(t, 1, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())
			})
		})
	})
}

func TestCircuitBreaker(t *testing.T) {
	t.Parallel()

	t.Run("verify tripping based on request threshold", func(t *testing.T) {
		t.Parallel()

		breaker := getCircuitBreakerWithDefaults()
		breaker.RequestThreshold = 2

		trafficConfig := getTrafficConfigWithTimeout(breaker, 1*time.Second)

		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.DebugLevel,
			},
			RouterOptions: []core.Option{
				core.WithSubgraphCircuitBreakerOptions(core.NewSubgraphCircuitBreakerOptions(trafficConfig)),
				core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(trafficConfig)),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							simulateConnectionFailureOnClose(w)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			opts := SendRequestOptions{t: t, xEnv: xEnv}

			// The circuit is internally marked as tripped post-request
			// thus even though N requests are executed we only care about when the status changed to tripped
			requestsRequiredToTrip := breaker.RequestThreshold - 1

			// PRE TRIP REQUESTS
			for range requestsRequiredToTrip {
				sendRequest(opts, "", SendFailedRequest)
			}

			// Verify that the circuit breaker status has not changed yet
			preCircuitBreak := xEnv.Observer().FilterMessage("Circuit breaker status changed")
			require.Zero(t, preCircuitBreak.Len())

			// TRIP REQUEST: This is the request that will trip the circuit breaker
			sendRequest(opts, "", SendFailedRequest)

			// Verify that the circuit breaker status changed, but it was not already open
			require.Equal(t, 1, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())
			require.Zero(t, xEnv.Observer().FilterMessage("Circuit breaker open, request callback did not execute").Len())

			// DENIED REQUEST: This is the request that will be denied due to the circuit breaker being already open
			sendRequest(opts, "", SendFailedRequest)

			// Verify that the callback did not run
			postDeniedRequest := xEnv.Observer().FilterMessage("Circuit breaker open, request callback did not execute")
			require.Equal(t, 1, postDeniedRequest.Len())
		})
	})

	t.Run("verify circuit breaker tripping on error threshold", func(t *testing.T) {
		t.Parallel()

		// Should add up to 10, 70% Error rate
		var successRequests = 3
		var failureRequests = 7

		// Use defaults, but override required
		breaker := getCircuitBreakerWithDefaults()
		breaker.ErrorThresholdPercentage = 70

		trafficConfig := getTrafficConfigWithTimeout(breaker, 1*time.Second)

		// We use this variable to communicate between the subgraph
		// what it should do, this is possible since we run requests one by one serially
		var isSuccessRequest atomic.Bool

		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.DebugLevel,
			},
			RouterOptions: []core.Option{
				core.WithSubgraphCircuitBreakerOptions(core.NewSubgraphCircuitBreakerOptions(trafficConfig)),
				core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(trafficConfig)),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							if isSuccessRequest.Load() {
								_, err := w.Write([]byte(successSubgraphJSON))
								require.NoError(t, err)
							} else {
								simulateConnectionFailureOnClose(w)
							}
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			opts := SendRequestOptions{t: t, xEnv: xEnv, isSuccessRequest: &isSuccessRequest}

			// PRE TRIP requests
			for range successRequests {
				sendRequest(opts, "", AttemptSuccessfulRequest)
			}
			for range failureRequests - 1 {
				sendRequest(opts, "", SendFailedRequest)
			}

			// Verify that the circuit breaker status has not changed yet
			preCircuitBreak := xEnv.Observer().FilterMessage("Circuit breaker status changed")
			require.Zero(t, preCircuitBreak.Len())

			// TRIP REQUEST: This is the request that will trip the circuit breaker
			sendRequest(opts, "", SendFailedRequest)

			// Verify that the circuit breaker status changed, but it was not already open
			require.Equal(t, 1, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())
			require.Zero(t, xEnv.Observer().FilterMessage("Circuit breaker open, request callback did not execute").Len())

			// DENIED REQUEST: This is the request that will be denied due to the circuit breaker being already open
			sendRequest(opts, "", SendFailedRequest)

			// Verify that the callback did not run
			postDeniedRequest := xEnv.Observer().FilterMessage("Circuit breaker open, request callback did not execute")
			require.Equal(t, 1, postDeniedRequest.Len())
		})
	})

	t.Run("verify circuit breaker does not trip separately for feature flag", func(t *testing.T) {
		t.Parallel()

		breaker := getCircuitBreakerWithDefaults()
		breaker.RequestThreshold = 2
		breaker.ErrorThresholdPercentage = 100

		trafficConfig := getTrafficConfigWithTimeout(breaker, 1*time.Second)

		var isSuccessRequest atomic.Bool

		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.DebugLevel,
			},
			RouterOptions: []core.Option{
				core.WithSubgraphCircuitBreakerOptions(core.NewSubgraphCircuitBreakerOptions(trafficConfig)),
				core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(trafficConfig)),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							if isSuccessRequest.Load() {
								_, err := w.Write([]byte(successSubgraphJSON))
								require.NoError(t, err)
							} else {
								simulateConnectionFailureOnClose(w)
							}
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			opts := SendRequestOptions{t: t, xEnv: xEnv, isSuccessRequest: &isSuccessRequest}
			// Trip the base
			sendRequest(opts, "", SendFailedRequest)
			require.Zero(t, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())
			sendRequest(opts, "", SendFailedRequest)
			require.Equal(t, 1, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())

			// Should not trip separately for the feature flag, the count should be the same
			sendRequest(opts, "myff", SendFailedRequest)
			require.Equal(t, 1, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())
			sendRequest(opts, "myff", SendFailedRequest)
			require.Equal(t, 1, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())
		})
	})

	t.Run("verify circuit breaker trip separately for feature flag subgraph", func(t *testing.T) {
		t.Parallel()

		breaker := getCircuitBreakerWithDefaults()
		breaker.RequestThreshold = 2
		breaker.ErrorThresholdPercentage = 100

		trafficConfig := getTrafficConfigWithTimeout(breaker, 1*time.Second)

		var isSuccessRequest atomic.Bool

		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.DebugLevel,
			},
			RouterOptions: []core.Option{
				core.WithSubgraphCircuitBreakerOptions(core.NewSubgraphCircuitBreakerOptions(trafficConfig)),
				core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(trafficConfig)),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							simulateConnectionFailureOnClose(w)
						})
					},
				},
				ProductsFg: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							simulateConnectionFailureOnClose(w)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ffOpts := SendRequestOptions{t: t, xEnv: xEnv, isSuccessRequest: &isSuccessRequest,
				customQuery: `{ employees { id products } }`,
			}
			var response string

			// Should trip the base products subgraph
			response = sendRequest(ffOpts, "", SendFailedRequest)
			require.Zero(t, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())
			require.Contains(t, response, "Failed to fetch from Subgraph 'products' at Path 'employees'")

			response = sendRequest(ffOpts, "", SendFailedRequest)
			require.Equal(t, 1, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())
			require.Contains(t, response, "Failed to fetch from Subgraph 'products' at Path 'employees'")

			// Should trip separately for the feature flag, because its a different subgraph
			response = sendRequest(ffOpts, "myff", SendFailedRequest)
			require.Equal(t, 1, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())
			require.Contains(t, response, "Failed to fetch from Subgraph 'products_fg' at Path 'employees'")

			response = sendRequest(ffOpts, "myff", SendFailedRequest)
			require.Equal(t, 2, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())
			require.Contains(t, response, "Failed to fetch from Subgraph 'products_fg' at Path 'employees'")
		})
	})

	t.Run("circuit breaker metrics", func(t *testing.T) {
		t.Parallel()

		t.Run("verify grouped circuit breakers for multiple subgraphs", func(t *testing.T) {
			t.Parallel()

			breaker := getCircuitBreakerWithDefaults()
			breaker.RequestThreshold = 2
			breaker.ErrorThresholdPercentage = 100
			trafficConfig := getTrafficConfigWithTimeout(breaker, 1*time.Second)

			sharedUrl := "http://fakeurl:8089"

			t.Run("for otel", func(t *testing.T) {
				metricReader := metric.NewManualReader()

				testenv.Run(t, &testenv.Config{
					MetricReader: metricReader,
					LogObservation: testenv.LogObservationConfig{
						Enabled:  true,
						LogLevel: zapcore.DebugLevel,
					},
					MetricOptions: testenv.MetricOptions{
						EnableOTLPCircuitBreakerMetrics: true,
					},
					RouterOptions: []core.Option{
						core.WithSubgraphCircuitBreakerOptions(core.NewSubgraphCircuitBreakerOptions(trafficConfig)),
						core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(trafficConfig)),
						core.WithOverrides(config.OverridesConfiguration{
							Subgraphs: map[string]config.SubgraphOverridesConfiguration{
								"availability": {
									RoutingURL: sharedUrl,
								},
								"products": {
									RoutingURL: sharedUrl,
								},
							},
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					ffOpts := SendRequestOptions{t: t, xEnv: xEnv,
						customQuery: `{ employees { id products isAvailable } }`,
					}

					sendRequest(ffOpts, "", SendFailedRequest)
					sendRequest(ffOpts, "", SendFailedRequest)

					rm := metricdata.ResourceMetrics{}
					err := metricReader.Collect(context.Background(), &rm)
					require.NoError(t, err)

					shortCircuitRequestsMetric := metricdata.Metrics{
						Name:        "router.circuit_breaker.short_circuits",
						Description: "Circuit breaker short circuits.",
						Unit:        "",
						Data: metricdata.Sum[int64]{
							Temporality: metricdata.CumulativeTemporality,
							IsMonotonic: true,
							DataPoints: []metricdata.DataPoint[int64]{
								{
									Attributes: attribute.NewSet(
										otel.WgFederatedGraphID.String("graph"),
										otel.WgRouterClusterName.String(""),
										otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
										otel.WgRouterVersion.String("dev"),
									),
									Value: int64(2),
								},
							},
						},
					}

					scopeMetric := GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
					shortCircuitActual := GetMetricByName(scopeMetric, "router.circuit_breaker.short_circuits")

					switch d := shortCircuitActual.Data.(type) {
					case metricdata.Sum[int64]:
						for i, dp := range d.DataPoints {
							attrs, _ := dp.Attributes.Filter(func(attr attribute.KeyValue) bool {
								if attr.Key == otel.WgSubgraphName {
									subgraphs := attr.Value.AsStringSlice()
									sort.Strings(subgraphs)
									require.Equal(t, []string{"availability", "products"}, subgraphs)
								}
								return attr.Key != otel.WgSubgraphName
							})
							d.DataPoints[i].Attributes = attrs
						}
					}

					metricdatatest.AssertEqual(t, shortCircuitRequestsMetric, *shortCircuitActual, metricdatatest.IgnoreTimestamp())
				})
			})

			t.Run("for prometheus", func(t *testing.T) {
				t.Parallel()

				promRegistry := prometheus.NewRegistry()
				metricReader := metric.NewManualReader()

				testenv.Run(t, &testenv.Config{
					MetricReader:       metricReader,
					PrometheusRegistry: promRegistry,
					MetricOptions: testenv.MetricOptions{
						EnablePrometheusCircuitBreakerMetrics: true,
					},
					LogObservation: testenv.LogObservationConfig{
						Enabled:  true,
						LogLevel: zapcore.DebugLevel,
					},
					RouterOptions: []core.Option{
						core.WithSubgraphCircuitBreakerOptions(core.NewSubgraphCircuitBreakerOptions(trafficConfig)),
						core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(trafficConfig)),
						core.WithOverrides(config.OverridesConfiguration{
							Subgraphs: map[string]config.SubgraphOverridesConfiguration{
								"availability": {
									RoutingURL: sharedUrl,
								},
								"products": {
									RoutingURL: sharedUrl,
								},
							},
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					ffOpts := SendRequestOptions{t: t, xEnv: xEnv,
						customQuery: `{ employees { id products isAvailable } }`,
					}

					sendRequest(ffOpts, "", SendFailedRequest)
					sendRequest(ffOpts, "", SendFailedRequest)

					rm := metricdata.ResourceMetrics{}
					require.NoError(t, metricReader.Collect(context.Background(), &rm))

					mf, err := promRegistry.Gather()
					require.NoError(t, err)

					metricFamily := findMetricFamilyByName(mf, "router_circuit_breaker_short_circuits_total")
					metrics := metricFamily.GetMetric()
					require.Len(t, metrics, 1)

					metricDataPoint := metrics[0]

					require.Equal(t, float64(2), *metricDataPoint.Counter.Value)

					expected := []*io_prometheus_client.LabelPair{
						{
							Name:  PointerOf("otel_scope_name"),
							Value: PointerOf("cosmo.router.prometheus"),
						},
						{
							Name:  PointerOf("otel_scope_version"),
							Value: PointerOf("0.0.1"),
						},
						{
							Name:  PointerOf("wg_federated_graph_id"),
							Value: PointerOf("graph"),
						},
						{
							Name:  PointerOf("wg_router_cluster_name"),
							Value: PointerOf(""),
						},
						{
							Name:  PointerOf("wg_router_config_version"),
							Value: PointerOf(xEnv.RouterConfigVersionMain()),
						},
						{
							Name:  PointerOf("wg_router_version"),
							Value: PointerOf("dev"),
						},
					}

					label := metricDataPoint.Label[:len(metricDataPoint.Label)-1]
					require.Equal(t, expected, label)

					subgraphLabel := metricDataPoint.Label[len(metricDataPoint.Label)-1]
					require.True(t, *subgraphLabel.Name == "wg_subgraph_name")
					require.True(t, *subgraphLabel.Value == `["products","availability"]` || *subgraphLabel.Value == `["availability","products"]`)
				})
			})
		})

		t.Run("verify short circuited request metric", func(t *testing.T) {
			t.Parallel()

			breaker := getCircuitBreakerWithDefaults()
			breaker.RequestThreshold = 2
			breaker.ErrorThresholdPercentage = 100
			trafficConfig := getTrafficConfigWithTimeout(breaker, 1*time.Second)

			t.Run("for otel", func(t *testing.T) {
				metricReader := metric.NewManualReader()

				testenv.Run(t, &testenv.Config{
					MetricReader: metricReader,
					LogObservation: testenv.LogObservationConfig{
						Enabled:  true,
						LogLevel: zapcore.DebugLevel,
					},
					MetricOptions: testenv.MetricOptions{
						EnableOTLPCircuitBreakerMetrics: true,
					},
					RouterOptions: []core.Option{
						core.WithSubgraphCircuitBreakerOptions(core.NewSubgraphCircuitBreakerOptions(trafficConfig)),
						core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(trafficConfig)),
					},
					Subgraphs: testenv.SubgraphsConfig{
						Employees: testenv.SubgraphConfig{
							Middleware: func(_ http.Handler) http.Handler {
								return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
									simulateConnectionFailureOnClose(w)
								})
							},
						},
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					opts := SendRequestOptions{t: t, xEnv: xEnv}

					var requestsToSend int64 = 5
					for range requestsToSend {
						sendRequest(opts, "", SendFailedRequest)
					}

					rm := metricdata.ResourceMetrics{}
					err := metricReader.Collect(context.Background(), &rm)
					require.NoError(t, err)

					expectedValue := requestsToSend - breaker.RequestThreshold
					shortCircuitRequestsMetric := metricdata.Metrics{
						Name:        "router.circuit_breaker.short_circuits",
						Description: "Circuit breaker short circuits.",
						Unit:        "",
						Data: metricdata.Sum[int64]{
							Temporality: metricdata.CumulativeTemporality,
							IsMonotonic: true,
							DataPoints: []metricdata.DataPoint[int64]{
								{
									Attributes: attribute.NewSet(
										otel.WgFederatedGraphID.String("graph"),
										otel.WgRouterClusterName.String(""),
										otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
										otel.WgRouterVersion.String("dev"),
										otel.WgSubgraphName.StringSlice([]string{"employees"}),
									),
									Value: expectedValue,
								},
							},
						},
					}

					scopeMetric := GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
					shortCircuitActual := GetMetricByName(scopeMetric, "router.circuit_breaker.short_circuits")
					metricdatatest.AssertEqual(t, shortCircuitRequestsMetric, *shortCircuitActual, metricdatatest.IgnoreTimestamp())
				})
			})

			t.Run("for prometheus", func(t *testing.T) {
				t.Parallel()

				promRegistry := prometheus.NewRegistry()
				metricReader := metric.NewManualReader()

				testenv.Run(t, &testenv.Config{
					MetricReader:       metricReader,
					PrometheusRegistry: promRegistry,
					MetricOptions: testenv.MetricOptions{
						EnablePrometheusCircuitBreakerMetrics: true,
					},
					LogObservation: testenv.LogObservationConfig{
						Enabled:  true,
						LogLevel: zapcore.DebugLevel,
					},
					RouterOptions: []core.Option{
						core.WithSubgraphCircuitBreakerOptions(core.NewSubgraphCircuitBreakerOptions(trafficConfig)),
						core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(trafficConfig)),
					},
					Subgraphs: testenv.SubgraphsConfig{
						Employees: testenv.SubgraphConfig{
							Middleware: func(_ http.Handler) http.Handler {
								return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
									simulateConnectionFailureOnClose(w)
								})
							},
						},
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					opts := SendRequestOptions{t: t, xEnv: xEnv}

					var requestsToSend int64 = 5
					for range requestsToSend {
						sendRequest(opts, "", SendFailedRequest)
					}

					rm := metricdata.ResourceMetrics{}
					require.NoError(t, metricReader.Collect(context.Background(), &rm))

					mf, err := promRegistry.Gather()
					require.NoError(t, err)

					metricFamily := findMetricFamilyByName(mf, "router_circuit_breaker_short_circuits_total")
					metrics := metricFamily.GetMetric()
					require.Len(t, metrics, 1)

					metricDataPoint := metrics[0]

					expectedValue := float64(requestsToSend - breaker.RequestThreshold)
					require.Equal(t, expectedValue, *metricDataPoint.Counter.Value)

					expected := []*io_prometheus_client.LabelPair{
						{
							Name:  PointerOf("otel_scope_name"),
							Value: PointerOf("cosmo.router.prometheus"),
						},
						{
							Name:  PointerOf("otel_scope_version"),
							Value: PointerOf("0.0.1"),
						},
						{
							Name:  PointerOf("wg_federated_graph_id"),
							Value: PointerOf("graph"),
						},
						{
							Name:  PointerOf("wg_router_cluster_name"),
							Value: PointerOf(""),
						},
						{
							Name:  PointerOf("wg_router_config_version"),
							Value: PointerOf(xEnv.RouterConfigVersionMain()),
						},
						{
							Name:  PointerOf("wg_router_version"),
							Value: PointerOf("dev"),
						},
						{
							Name:  PointerOf("wg_subgraph_name"),
							Value: PointerOf(`["employees"]`),
						},
					}
					require.Equal(t, expected, metricDataPoint.Label)
				})
			})

		})

		t.Run("verify circuit breaker status metric", func(t *testing.T) {
			t.Parallel()

			const (
				ShortCircuitClosed = 0
				ShortCircuitOpened = 1
			)

			breaker := getCircuitBreakerWithDefaults()
			breaker.RequestThreshold = 2
			breaker.ErrorThresholdPercentage = 100
			breaker.SleepWindow = 2 * time.Second
			trafficConfig := getTrafficConfigWithTimeout(breaker, 1*time.Second)

			t.Run("for otel", func(t *testing.T) {
				t.Parallel()

				metricReader := metric.NewManualReader()

				var isSuccessRequest atomic.Bool

				testenv.Run(t, &testenv.Config{
					MetricReader: metricReader,
					LogObservation: testenv.LogObservationConfig{
						Enabled:  true,
						LogLevel: zapcore.DebugLevel,
					},
					MetricOptions: testenv.MetricOptions{
						EnableOTLPCircuitBreakerMetrics: true,
					},
					RouterOptions: []core.Option{
						core.WithSubgraphCircuitBreakerOptions(core.NewSubgraphCircuitBreakerOptions(trafficConfig)),
						core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(trafficConfig)),
					},
					Subgraphs: testenv.SubgraphsConfig{
						Employees: testenv.SubgraphConfig{
							Middleware: func(_ http.Handler) http.Handler {
								return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
									if isSuccessRequest.Load() {
										_, err := w.Write([]byte(successSubgraphJSON))
										require.NoError(t, err)
									} else {
										simulateConnectionFailureOnClose(w)
									}
								})
							},
						},
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					opts := SendRequestOptions{t: t, xEnv: xEnv, isSuccessRequest: &isSuccessRequest}

					t.Run("no state exists before the first state change", func(t *testing.T) {
						// Send initial request
						sendRequest(opts, "", SendFailedRequest)

						// Ensure that the metric does not exist still, as it's only recorded when state is changed
						rm := metricdata.ResourceMetrics{}
						require.NoError(t, metricReader.Collect(context.Background(), &rm))
						shortCircuitBeforeStatusChange := GetMetricByName(GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router"), "router.circuit_breaker.state")
						require.Nil(t, shortCircuitBeforeStatusChange)
					})

					t.Run("state is open after failures", func(t *testing.T) {
						// Send requests to trip circuit breaker
						for range breaker.RequestThreshold - 1 {
							sendRequest(opts, "", SendFailedRequest)
						}

						rm := metricdata.ResourceMetrics{}
						require.NoError(t, metricReader.Collect(context.Background(), &rm))
						shortCircuitAfterStatusOpen := GetMetricByName(GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router"), "router.circuit_breaker.state")

						shortCircuitRequestsMetric := metricdata.Metrics{
							Name:        "router.circuit_breaker.state",
							Description: "Circuit breaker state.",
							Unit:        "",
							Data: metricdata.Gauge[int64]{
								DataPoints: []metricdata.DataPoint[int64]{
									{
										Attributes: attribute.NewSet(
											otel.WgFederatedGraphID.String("graph"),
											otel.WgRouterClusterName.String(""),
											otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
											otel.WgRouterVersion.String("dev"),
											otel.WgSubgraphName.StringSlice([]string{"employees"}),
										),
										Value: ShortCircuitOpened,
									},
								},
							},
						}
						metricdatatest.AssertEqual(t, shortCircuitRequestsMetric, *shortCircuitAfterStatusOpen, metricdatatest.IgnoreTimestamp())
					})

					t.Run("state is switched to closed after a successful request", func(t *testing.T) {
						// Wait for the circuit breaker to become half open
						time.Sleep(breaker.SleepWindow + 100*time.Millisecond)

						// Send successful request to close circuit breaker
						sendRequest(opts, "", AttemptSuccessfulRequest)

						rm := metricdata.ResourceMetrics{}
						require.NoError(t, metricReader.Collect(context.Background(), &rm))
						shortCircuitStatusAfterClosedAgain := GetMetricByName(GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router"), "router.circuit_breaker.state")

						shortCircuitRequestsMetric := metricdata.Metrics{
							Name:        "router.circuit_breaker.state",
							Description: "Circuit breaker state.",
							Unit:        "",
							Data: metricdata.Gauge[int64]{
								DataPoints: []metricdata.DataPoint[int64]{
									{
										Attributes: attribute.NewSet(
											otel.WgFederatedGraphID.String("graph"),
											otel.WgRouterClusterName.String(""),
											otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
											otel.WgRouterVersion.String("dev"),
											otel.WgSubgraphName.StringSlice([]string{"employees"}),
										),
										Value: ShortCircuitClosed,
									},
								},
							},
						}
						metricdatatest.AssertEqual(t, shortCircuitRequestsMetric, *shortCircuitStatusAfterClosedAgain, metricdatatest.IgnoreTimestamp())
					})
				})
			})

			t.Run("for prometheus", func(t *testing.T) {
				t.Parallel()

				promRegistry := prometheus.NewRegistry()
				metricReader := metric.NewManualReader()

				var isSuccessRequest atomic.Bool

				testenv.Run(t, &testenv.Config{
					MetricReader:       metricReader,
					PrometheusRegistry: promRegistry,
					MetricOptions: testenv.MetricOptions{
						EnablePrometheusCircuitBreakerMetrics: true,
					},
					LogObservation: testenv.LogObservationConfig{
						Enabled:  true,
						LogLevel: zapcore.DebugLevel,
					},
					RouterOptions: []core.Option{
						core.WithSubgraphCircuitBreakerOptions(core.NewSubgraphCircuitBreakerOptions(trafficConfig)),
						core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(trafficConfig)),
					},
					Subgraphs: testenv.SubgraphsConfig{
						Employees: testenv.SubgraphConfig{
							Middleware: func(_ http.Handler) http.Handler {
								return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
									if isSuccessRequest.Load() {
										_, err := w.Write([]byte(successSubgraphJSON))
										require.NoError(t, err)
									} else {
										simulateConnectionFailureOnClose(w)
									}
								})
							},
						},
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					opts := SendRequestOptions{t: t, xEnv: xEnv, isSuccessRequest: &isSuccessRequest}

					t.Run("no state exists before the first state change", func(t *testing.T) {
						sendRequest(opts, "", SendFailedRequest)

						// Ensure that the metric does not exist still, as it's only recorded when state is changed
						rm := metricdata.ResourceMetrics{}
						require.NoError(t, metricReader.Collect(context.Background(), &rm))
						mf, err := promRegistry.Gather()
						require.NoError(t, err)

						// Verify that the state does not exist as no state changed
						metricFamily := findMetricFamilyByName(mf, "router_circuit_breaker_state")
						metrics := metricFamily.GetMetric()
						require.Len(t, metrics, 0)
					})

					t.Run("state is open after failures", func(t *testing.T) {
						for range breaker.RequestThreshold - 1 {
							sendRequest(opts, "", SendFailedRequest)
						}

						rm := metricdata.ResourceMetrics{}
						require.NoError(t, metricReader.Collect(context.Background(), &rm))
						mf, err := promRegistry.Gather()
						require.NoError(t, err)

						metricFamily := findMetricFamilyByName(mf, "router_circuit_breaker_state")
						metrics := metricFamily.GetMetric()

						require.Len(t, metrics, 1)
						metricDataPoint := metrics[0]
						require.Equal(t, float64(ShortCircuitOpened), *metricDataPoint.Gauge.Value)

						expectedOpened := []*io_prometheus_client.LabelPair{
							{Name: PointerOf("otel_scope_name"), Value: PointerOf("cosmo.router.prometheus")},
							{Name: PointerOf("otel_scope_version"), Value: PointerOf("0.0.1")},
							{Name: PointerOf("wg_federated_graph_id"), Value: PointerOf("graph")},
							{Name: PointerOf("wg_router_cluster_name"), Value: PointerOf("")},
							{Name: PointerOf("wg_router_config_version"), Value: PointerOf(xEnv.RouterConfigVersionMain())},
							{Name: PointerOf("wg_router_version"), Value: PointerOf("dev")},
							{Name: PointerOf("wg_subgraph_name"), Value: PointerOf(`["employees"]`)},
						}
						require.Equal(t, expectedOpened, metricDataPoint.Label)
					})

					t.Run("state is switched to closed after a successful request", func(t *testing.T) {
						// Wait for the circuit breaker to become half open
						time.Sleep(breaker.SleepWindow + 100*time.Millisecond)

						// Send successful request to close circuit breaker
						sendRequest(opts, "", AttemptSuccessfulRequest)

						rm := metricdata.ResourceMetrics{}
						require.NoError(t, metricReader.Collect(context.Background(), &rm))

						mf, err := promRegistry.Gather()
						require.NoError(t, err)

						metricFamily := findMetricFamilyByName(mf, "router_circuit_breaker_state")
						metrics := metricFamily.GetMetric()
						require.Len(t, metrics, 1)

						// Verify the state and that the attributes are the same
						closedDataPoint := metrics[0]
						require.Equal(t, float64(ShortCircuitClosed), *closedDataPoint.Gauge.Value)
						expectedClosed := []*io_prometheus_client.LabelPair{
							{Name: PointerOf("otel_scope_name"), Value: PointerOf("cosmo.router.prometheus")},
							{Name: PointerOf("otel_scope_version"), Value: PointerOf("0.0.1")},
							{Name: PointerOf("wg_federated_graph_id"), Value: PointerOf("graph")},
							{Name: PointerOf("wg_router_cluster_name"), Value: PointerOf("")},
							{Name: PointerOf("wg_router_config_version"), Value: PointerOf(xEnv.RouterConfigVersionMain())},
							{Name: PointerOf("wg_router_version"), Value: PointerOf("dev")},
							{Name: PointerOf("wg_subgraph_name"), Value: PointerOf(`["employees"]`)},
						}
						require.Equal(t, expectedClosed, closedDataPoint.Label)
					})
				})
			})

		})
	})
}

// simulateConnectionFailureOnClose is used to simulate a failure
// in case the connection cannot be hijacked default to panic
func simulateConnectionFailureOnClose(w http.ResponseWriter) {
	hj, ok := w.(http.Hijacker)
	if !ok {
		// If the hijacker is not available, we switch to panic
		// to simulate a failure
		panic("service failure")
	}
	conn, _, err := hj.Hijack()
	if err != nil {
		// Hijacking failed, switch to panic
		// to simulate a failure
		panic(err)
	}
	_ = conn.Close()
}

func sendRequest(opts SendRequestOptions, featureFlag string, isSuccess bool) string {
	if opts.isSuccessRequest != nil {
		opts.isSuccessRequest.Store(isSuccess)
	}
	time.Sleep(5 * time.Millisecond)

	baseQuery := opts.customQuery
	if baseQuery == "" {
		baseQuery = `query employees { employees { id } }`
	}

	request := testenv.GraphQLRequest{Query: baseQuery}

	if featureFlag != "" {
		request.Header = map[string][]string{
			"X-Feature-Flag": {featureFlag},
		}
	}

	res, err := opts.xEnv.MakeGraphQLRequest(request)
	require.NoError(opts.t, err)

	if opts.customQuery != "" {
		return res.Body
	}

	check := isSuccess
	if opts.invertCheck {
		check = !check
	}

	// Note that even if check is true (when not inverted), if the circuit is triggered this will be unsuccessful
	if check {
		require.JSONEq(opts.t, successSubgraphJSON, res.Body)
	} else {
		require.JSONEq(opts.t, subgraphErrorJSON, res.Body)
	}

	return ""
}

func getCircuitBreakerWithDefaults() config.CircuitBreaker {
	return config.CircuitBreaker{
		// The default is false, but for testing we use true
		Enabled:                  true,
		ErrorThresholdPercentage: 50,
		// The default is 20, but for testing purposes we set it to 1 so that
		RequestThreshold:           1,
		SleepWindow:                5 * time.Second,
		HalfOpenAttempts:           1,
		RequiredSuccessfulAttempts: 1,
		RollingDuration:            10 * time.Second,
		NumBuckets:                 10,
		ExecutionTimeout:           1 * time.Second,
		MaxConcurrentRequests:      -1,
	}
}

func getTrafficConfigWithTimeout(breaker config.CircuitBreaker, timeout time.Duration) config.TrafficShapingRules {
	trafficConfig := config.TrafficShapingRules{
		All: config.GlobalSubgraphRequestRule{
			BackoffJitterRetry: config.BackoffJitterRetry{
				Enabled: false,
			},
			CircuitBreaker:         breaker,
			RequestTimeout:         PointerOf(timeout),
			DialTimeout:            PointerOf(timeout),
			ResponseHeaderTimeout:  PointerOf(timeout),
			ExpectContinueTimeout:  PointerOf(timeout),
			TLSHandshakeTimeout:    PointerOf(timeout),
			KeepAliveIdleTimeout:   PointerOf(timeout),
			KeepAliveProbeInterval: PointerOf(10 * time.Second),
			MaxConnsPerHost:        PointerOf(20),
			MaxIdleConns:           PointerOf(20),
			MaxIdleConnsPerHost:    PointerOf(20),
		},
	}
	return trafficConfig
}
