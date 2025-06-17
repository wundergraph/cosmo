package integration

import (
	"github.com/caarlos0/env/v11"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap/zapcore"
	"net/http"
	"sync/atomic"
	"testing"

	"time"
)

const successSubgraphJson = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`
const subgraphErrorJson = `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'."}],"data":{"employees":null}}`

func TestCircuitBreaker(t *testing.T) {

	t.Run("verify tripping based on request threshold", func(t *testing.T) {
		t.Parallel()

		var requestThreshold int64 = 2

		// Use defaults, but override required
		breaker := getCircuitBreakerConfigsWithDefaults()
		breaker.RequestThreshold = requestThreshold

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
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							// Timeout to simulate an error for the circuit breaker due to network timeout
							time.Sleep(5 * time.Second)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// The circuit is internally marked as tripped post-request
			// thus even though N requests are executed we only care about when the status changed to tripped
			requestsRequiredToTrip := requestThreshold - 1

			// PRE TRIP REQUESTS
			for range requestsRequiredToTrip {
				sendRequest(t, xEnv, nil, "", false)
			}

			// Verify that the circuit breaker status has not changed yet
			preCircuitBreak := xEnv.Observer().FilterMessage("Circuit breaker status changed")
			require.Zero(t, preCircuitBreak.Len())

			// TRIP REQUEST: This is the request that will trip the circuit breaker
			sendRequest(t, xEnv, nil, "", false)

			// Verify that the circuit breaker status changed, but it was not already open
			require.Equal(t, 1, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())
			require.Zero(t, xEnv.Observer().FilterMessage("Circuit breaker open, request callback did not execute").Len())

			// DENIED REQUEST: This is the request that will be denied due to the circuit breaker being already open
			sendRequest(t, xEnv, nil, "", false)

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
		var errorThresholdPercentage int64 = 70

		// Use defaults, but override required
		breaker := getCircuitBreakerConfigsWithDefaults()
		breaker.ErrorThresholdPercentage = errorThresholdPercentage

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
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							if isSuccessRequest.Load() {
								_, err := w.Write([]byte(successSubgraphJson))
								require.NoError(t, err)
							} else {
								time.Sleep(5 * time.Second)
							}
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// PRE TRIP requests
			for range successRequests {
				sendRequest(t, xEnv, &isSuccessRequest, "", true)
			}
			for range failureRequests - 1 {
				sendRequest(t, xEnv, &isSuccessRequest, "", false)
			}

			// Verify that the circuit breaker status has not changed yet
			preCircuitBreak := xEnv.Observer().FilterMessage("Circuit breaker status changed")
			require.Zero(t, preCircuitBreak.Len())

			// TRIP REQUEST: This is the request that will trip the circuit breaker
			sendRequest(t, xEnv, &isSuccessRequest, "", false)

			// Verify that the circuit breaker status changed, but it was not already open
			require.Equal(t, 1, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())
			require.Zero(t, xEnv.Observer().FilterMessage("Circuit breaker open, request callback did not execute").Len())

			// DENIED REQUEST: This is the request that will be denied due to the circuit breaker being already open
			sendRequest(t, xEnv, &isSuccessRequest, "", false)

			// Verify that the callback did not run
			postDeniedRequest := xEnv.Observer().FilterMessage("Circuit breaker open, request callback did not execute")
			require.Equal(t, 1, postDeniedRequest.Len())
		})
	})

	t.Run("verify circuit breaker becoming half open after sleep window", func(t *testing.T) {
		t.Parallel()

		var requestsToSucceed = 3
		var requestsToFail = 9
		var errorThresholdPercentage int64 = 70
		var sleepDuration = 2 * time.Second

		// Use defaults, but override required
		breaker := getCircuitBreakerConfigsWithDefaults()
		breaker.HalfOpenAttempts = 2
		breaker.SleepWindow = sleepDuration
		breaker.ErrorThresholdPercentage = errorThresholdPercentage

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
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							if isSuccessRequest.Load() {
								_, err := w.Write([]byte(successSubgraphJson))
								require.NoError(t, err)
							} else {
								time.Sleep(5 * time.Second)
							}
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			for range requestsToSucceed {
				sendRequest(t, xEnv, &isSuccessRequest, "", true)
			}
			for range requestsToFail {
				sendRequest(t, xEnv, &isSuccessRequest, "", false)
			}

			// Baseline verification
			require.Equal(t, 1, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())
			require.Equal(t, 2, xEnv.Observer().FilterMessage("Circuit breaker open, request callback did not execute").Len())

			// Wait for the circuit breaker to become half open
			time.Sleep(sleepDuration + 100*time.Millisecond)

			// We try to send a call when its half open but it fails, making it fully open again
			// Half Open Attempt 1 and 2: Failure
			sendRequest(t, xEnv, &isSuccessRequest, "", false)
			sendRequest(t, xEnv, &isSuccessRequest, "", false)
			// Since the closing attempts failed we should still have the same length as before
			require.Equal(t, 1, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())

			// Wait for the circuit breaker to become half open for the second time
			time.Sleep(sleepDuration + 100*time.Millisecond)

			sendRequest(t, xEnv, &isSuccessRequest, "", true)

			message := xEnv.Observer().FilterMessage("Circuit breaker status changed")
			require.Equal(t, 2, message.Len())

			contextMap := message.All()[1].ContextMap()
			require.False(t, contextMap["isOpen"].(bool))
		})
	})

	t.Run("verify circuit breaker rolling window", func(t *testing.T) {
		t.Parallel()

		var errorThresholdPercentage int64 = 90

		breaker := getCircuitBreakerConfigsWithDefaults()
		breaker.NumBuckets = 5
		breaker.RequestThreshold = 5
		breaker.RollingDuration = 2500 * time.Millisecond
		breaker.ErrorThresholdPercentage = errorThresholdPercentage

		durationPerBucket := breaker.RollingDuration / time.Duration(breaker.NumBuckets)
		_ = durationPerBucket

		trafficConfig := getTrafficConfigWithTimeout(breaker, 10*time.Millisecond)

		// We use this variable to communicate between the subgraph
		// what it should do, this is possible since we run requests one by one serially
		var isSuccessRequest atomic.Bool

		middleware := func(handler http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if isSuccessRequest.Load() {
					_, err := w.Write([]byte(successSubgraphJson))
					require.NoError(t, err)
				} else {
					time.Sleep(5 * time.Second)
				}
			})
		}

		t.Run("with one request per bucket", func(t *testing.T) {
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
						Middleware: middleware,
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				t.Log("Bucket 1")
				time.Sleep(durationPerBucket)
				sendRequest(t, xEnv, &isSuccessRequest, "", false)

				t.Log("Bucket 2")
				time.Sleep(durationPerBucket)
				sendRequest(t, xEnv, &isSuccessRequest, "", false)

				t.Log("Bucket 3")
				time.Sleep(durationPerBucket)
				sendRequest(t, xEnv, &isSuccessRequest, "", true)

				t.Log("Bucket 4")
				time.Sleep(durationPerBucket)
				sendRequest(t, xEnv, &isSuccessRequest, "", false)

				t.Log("Bucket 5")
				time.Sleep(durationPerBucket)
				sendRequest(t, xEnv, &isSuccessRequest, "", false)

				// Circuit breaker should not have triggered as bucket 3 has not been evicted to meet 90% err rate
				message := xEnv.Observer().FilterMessage("Circuit breaker status changed")
				require.Zero(t, message.Len())

				t.Log("Bucket 6: evict bucket 1")
				time.Sleep(durationPerBucket)
				sendRequest(t, xEnv, &isSuccessRequest, "", false)

				t.Log("Bucket 7: evict bucket 2")
				time.Sleep(durationPerBucket)
				sendRequest(t, xEnv, &isSuccessRequest, "", false)

				// Circuit breaker should not have triggered as bucket 3 has not been evicted to meet 90% err rate
				message = xEnv.Observer().FilterMessage("Circuit breaker status changed")
				require.Zero(t, message.Len())

				t.Log("Bucket 8: evict bucket 3")
				time.Sleep(durationPerBucket)
				sendRequest(t, xEnv, &isSuccessRequest, "", false)

				// Evict bucket 3 with true causing a 100% error rate
				message = xEnv.Observer().FilterMessage("Circuit breaker status changed")
				require.Equal(t, 1, message.Len())
			})
		})

		t.Run("with multiple requests per bucket", func(t *testing.T) {
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
						Middleware: middleware,
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				t.Log("Bucket 1")
				time.Sleep(durationPerBucket)
				sendRequest(t, xEnv, &isSuccessRequest, "", false)
				sendRequest(t, xEnv, &isSuccessRequest, "", false)
				require.Zero(t, 0, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())

				t.Log("Bucket 2")
				time.Sleep(durationPerBucket)
				sendRequest(t, xEnv, &isSuccessRequest, "", false)
				sendRequest(t, xEnv, &isSuccessRequest, "", false)
				require.Zero(t, 0, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())

				t.Log("Bucket 3")
				time.Sleep(durationPerBucket)
				sendRequest(t, xEnv, &isSuccessRequest, "", true)
				sendRequest(t, xEnv, &isSuccessRequest, "", false)
				sendRequest(t, xEnv, &isSuccessRequest, "", false)
				sendRequest(t, xEnv, &isSuccessRequest, "", false)
				require.Zero(t, 0, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())

				// 1/9 successful requests
				t.Log("Bucket 4")
				time.Sleep(durationPerBucket)
				sendRequest(t, xEnv, &isSuccessRequest, "", false)
				require.Zero(t, 0, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())

				t.Log("Bucket 5")
				time.Sleep(durationPerBucket)

				// 1/8 successful requests
				t.Log("Bucket 6: evict bucket 1")
				time.Sleep(durationPerBucket)
				sendRequest(t, xEnv, &isSuccessRequest, "", false)
				require.Zero(t, 0, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())

				// 1/8 successful requests
				t.Log("Bucket 7: evict bucket 2")
				time.Sleep(durationPerBucket)
				sendRequest(t, xEnv, &isSuccessRequest, "", false)
				sendRequest(t, xEnv, &isSuccessRequest, "", false)
				require.Zero(t, 0, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())

				t.Log("Bucket 8: evict bucket 3")
				time.Sleep(durationPerBucket)
				// We have 0/4 successful requests right now, this means 100% error rate
				// but we are under the threshold of 5 requests to trigger the circuit
				require.Zero(t, 0, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())

				sendRequest(t, xEnv, &isSuccessRequest, "", false)

				// 0/5 successful requests, which means err percentage is over 90% (100%) and 5 requests
				require.Equal(t, 1, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())
			})
		})
	})

	t.Run("verify circuit breaker trips separately for feature flag", func(t *testing.T) {
		t.Parallel()

		// Use defaults, but override required
		breaker := getCircuitBreakerConfigsWithDefaults()
		breaker.RequestThreshold = 2
		breaker.ErrorThresholdPercentage = 100

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
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							if isSuccessRequest.Load() {
								_, err := w.Write([]byte(successSubgraphJson))
								require.NoError(t, err)
							} else {
								time.Sleep(5 * time.Second)
							}
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Trip the base
			sendRequest(t, xEnv, &isSuccessRequest, "", false)
			require.Zero(t, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())
			sendRequest(t, xEnv, &isSuccessRequest, "", false)
			require.Equal(t, 1, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())

			// Trip the feature flag
			sendRequest(t, xEnv, &isSuccessRequest, "myff", false)
			require.Equal(t, 1, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())
			sendRequest(t, xEnv, &isSuccessRequest, "myff", false)
			require.Equal(t, 2, xEnv.Observer().FilterMessage("Circuit breaker status changed").Len())
		})
	})
}

func sendRequest(t *testing.T, xEnv *testenv.Environment, isSuccessRequest *atomic.Bool, featureFlag string, isSuccess bool) {
	if isSuccessRequest != nil {
		isSuccessRequest.Store(isSuccess)
	}
	time.Sleep(5 * time.Millisecond)
	request := testenv.GraphQLRequest{Query: `query employees { employees { id } }`}

	if featureFlag != "" {
		request.Header = map[string][]string{
			"X-Feature-Flag": {featureFlag},
		}
	}

	res, err := xEnv.MakeGraphQLRequest(request)
	require.NoError(t, err)
	// Note that even if isSuccess is true, if the circuit is triggered this will be unsuccessful
	if isSuccess {
		require.JSONEq(t, successSubgraphJson, res.Body)
	} else {
		require.JSONEq(t, subgraphErrorJson, res.Body)
	}
}

func getCircuitBreakerConfigsWithDefaults() config.CircuitBreaker {
	breaker := config.CircuitBreaker{}
	env.Parse(&breaker)
	breaker.Enabled = true
	// The default is 20, but for testing purposes we set it to 1 so that
	// the test case can make it explicit
	breaker.RequestThreshold = 1
	return breaker
}

func getTrafficConfigWithTimeout(breaker config.CircuitBreaker, timeout time.Duration) config.TrafficShapingRules {
	trafficConfig := config.TrafficShapingRules{
		All: config.GlobalSubgraphRequestRule{
			BackoffJitterRetry: config.BackoffJitterRetry{
				Enabled: false,
			},
			CircuitBreaker:         breaker,
			RequestTimeout:         ToPtr(timeout),
			DialTimeout:            ToPtr(timeout),
			ResponseHeaderTimeout:  ToPtr(timeout),
			ExpectContinueTimeout:  ToPtr(timeout),
			TLSHandshakeTimeout:    ToPtr(timeout),
			KeepAliveIdleTimeout:   ToPtr(timeout),
			KeepAliveProbeInterval: ToPtr(timeout),
			MaxConnsPerHost:        ToPtr(20),
			MaxIdleConns:           ToPtr(20),
			MaxIdleConnsPerHost:    ToPtr(20),
		},
	}
	return trafficConfig
}
