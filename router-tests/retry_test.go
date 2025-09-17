package integration

import (
	"github.com/gorilla/websocket"
	"net/http"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func CreateRetryCounterFunc(counter *atomic.Int32, duration *atomic.Int64) func(count int, req *http.Request, resp *http.Response, sleepDuration time.Duration, err error) {
	return func(count int, req *http.Request, resp *http.Response, sleepDuration time.Duration, err error) {
		counter.Add(1)
		if duration != nil {
			duration.Store(int64(sleepDuration))
		}
	}
}

func TestRetry(t *testing.T) {
	t.Parallel()

	t.Run("verify mutations are not retried", func(t *testing.T) {
		t.Parallel()

		onRetryCounter := atomic.Int32{}
		serviceCallsCounter := atomic.Int32{}
		retryCounterFunc := CreateRetryCounterFunc(&onRetryCounter, nil)

		maxRetryCount := 3
		expression := "true"

		opts := core.NewSubgraphRetryOptions(config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				BackoffJitterRetry: config.BackoffJitterRetry{
					Enabled:     true,
					MaxAttempts: maxRetryCount,
					MaxDuration: 10 * time.Second,
					Interval:    200 * time.Millisecond,
					Expression:  expression,
				},
			},
		})
		opts.OnRetryFunc = retryCounterFunc
		options := core.WithSubgraphRetryOptions(opts)

		testenv.Run(t, &testenv.Config{
			NoRetryClient:   true,
			AccessLogFields: []config.CustomAttribute{},
			RouterOptions: []core.Option{
				options,
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							w.WriteHeader(http.StatusBadGateway)
							serviceCallsCounter.Add(1)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `mutation updateEmployeeTag { updateEmployeeTag(id: 10, tag: "dd") { id } }`,
			})

			require.Equal(t, 0, int(onRetryCounter.Load()))
			require.Equal(t, 1, int(serviceCallsCounter.Load()))

			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees', Reason: empty response.","extensions":{"statusCode":502}}],"data":{"updateEmployeeTag":null}}`, res.Body)
		})

	})

	t.Run("verify no retries when expression and default check is not met", func(t *testing.T) {
		t.Parallel()

		onRetryCounter := atomic.Int32{}
		serviceCallsCounter := atomic.Int32{}
		retryCounterFunc := CreateRetryCounterFunc(&onRetryCounter, nil)

		maxRetryCount := 3
		expression := "false"

		opts := core.NewSubgraphRetryOptions(config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				BackoffJitterRetry: config.BackoffJitterRetry{
					Enabled:     true,
					MaxAttempts: maxRetryCount,
					MaxDuration: 10 * time.Second,
					Interval:    200 * time.Millisecond,
					Expression:  expression,
				},
			},
		})
		opts.OnRetryFunc = retryCounterFunc
		options := core.WithSubgraphRetryOptions(opts)

		testenv.Run(t, &testenv.Config{
			NoRetryClient:   true,
			AccessLogFields: []config.CustomAttribute{},
			RouterOptions: []core.Option{
				options,
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							w.WriteHeader(http.StatusBadGateway)
							serviceCallsCounter.Add(1)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query employees { employees { id } }`,
			})

			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees', Reason: empty response.","extensions":{"statusCode":502}}],"data":{"employees":null}}`, res.Body)

			require.Equal(t, 0, int(onRetryCounter.Load()))
			require.Equal(t, 1, int(serviceCallsCounter.Load()))
		})
	})

	t.Run("verify retries when every retry results in a failure", func(t *testing.T) {
		t.Parallel()

		onRetryCounter := atomic.Int32{}
		serviceCallsCounter := atomic.Int32{}
		retryCounterFunc := CreateRetryCounterFunc(&onRetryCounter, nil)

		maxRetryCount := 3
		expression := "true"

		opts := core.NewSubgraphRetryOptions(config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				BackoffJitterRetry: config.BackoffJitterRetry{
					Enabled:     true,
					MaxAttempts: maxRetryCount,
					MaxDuration: 10 * time.Second,
					Interval:    200 * time.Millisecond,
					Expression:  expression,
				},
			},
		})
		opts.OnRetryFunc = retryCounterFunc
		options := core.WithSubgraphRetryOptions(opts)

		testenv.Run(t, &testenv.Config{
			NoRetryClient:   true,
			AccessLogFields: []config.CustomAttribute{},
			RouterOptions: []core.Option{
				options,
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							w.WriteHeader(http.StatusBadGateway)
							serviceCallsCounter.Add(1)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query employees { employees { id } }`,
			})

			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees', Reason: empty response.","extensions":{"statusCode":502}}],"data":{"employees":null}}`, res.Body)

			require.Equal(t, maxRetryCount, int(onRetryCounter.Load()))
			require.Equal(t, maxRetryCount+1, int(serviceCallsCounter.Load()))
		})
	})

	t.Run("verify retries when only first n retries results in a failure", func(t *testing.T) {
		t.Parallel()

		onRetryCounter := atomic.Int32{}
		serviceCallsCounter := atomic.Int32{}
		retryCounterFunc := CreateRetryCounterFunc(&onRetryCounter, nil)

		maxRetryCount := 5
		maxAttemptsBeforeServiceSucceeds := 2
		expression := "true"

		opts := core.NewSubgraphRetryOptions(config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				BackoffJitterRetry: config.BackoffJitterRetry{
					Enabled:     true,
					MaxAttempts: maxRetryCount,
					MaxDuration: 10 * time.Second,
					Interval:    200 * time.Millisecond,
					Expression:  expression,
				},
			},
		})
		opts.OnRetryFunc = retryCounterFunc
		options := core.WithSubgraphRetryOptions(opts)

		testenv.Run(t, &testenv.Config{
			NoRetryClient:   true,
			AccessLogFields: []config.CustomAttribute{},
			RouterOptions: []core.Option{
				options,
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							// When the Nth retry is executed only we want to run the request successfully
							if onRetryCounter.Load() == int32(maxAttemptsBeforeServiceSucceeds) {
								w.WriteHeader(http.StatusOK)
								_, _ = w.Write([]byte(`{"data":{"employees":[{"id":1},{"id":2}]}}`))
							} else {
								w.WriteHeader(http.StatusBadGateway)
							}
							serviceCallsCounter.Add(1)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query employees { employees { id } }`,
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2}]}}`, res.Body)

			require.Equal(t, maxAttemptsBeforeServiceSucceeds, int(onRetryCounter.Load()))
			require.Equal(t, maxAttemptsBeforeServiceSucceeds+1, int(serviceCallsCounter.Load()))
		})
	})

	t.Run("verify retry interval for 429 when a nonzero Retry-After is set", func(t *testing.T) {
		t.Parallel()

		onRetryCounter := atomic.Int32{}
		serviceCallsCounter := atomic.Int32{}
		sleepDuration := atomic.Int64{}

		retryCounterFunc := CreateRetryCounterFunc(&onRetryCounter, &sleepDuration)

		maxRetryCount := 3
		expression := "statusCode == 429"
		headerRetryIntervalInSeconds := 1

		opts := core.NewSubgraphRetryOptions(config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				BackoffJitterRetry: config.BackoffJitterRetry{
					Enabled:     true,
					MaxAttempts: maxRetryCount,
					MaxDuration: 2000 * time.Second,
					Interval:    100 * time.Millisecond,
					Expression:  expression,
				},
			},
		})
		opts.OnRetryFunc = retryCounterFunc
		options := core.WithSubgraphRetryOptions(opts)

		testenv.Run(t, &testenv.Config{
			NoRetryClient:   true,
			AccessLogFields: []config.CustomAttribute{},
			RouterOptions: []core.Option{
				options,
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							w.Header().Set("Retry-After", strconv.Itoa(headerRetryIntervalInSeconds))
							w.WriteHeader(http.StatusTooManyRequests)
							serviceCallsCounter.Add(1)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query employees { employees { id } }`,
			})

			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees', Reason: empty response.","extensions":{"statusCode":429}}],"data":{"employees":null}}`, res.Body)

			// The service will get one extra call, in addition to the first request
			require.Equal(t, maxRetryCount, int(onRetryCounter.Load()))
			require.Equal(t, maxRetryCount+1, int(serviceCallsCounter.Load()))

			secondsDuration := time.Duration(headerRetryIntervalInSeconds) * time.Second
			require.Equal(t, int64(secondsDuration), sleepDuration.Load())
		})
	})

}

func TestFlakyRetry(t *testing.T) {
	t.Parallel()

	t.Run("verify max duration is not exceeded on intervals", func(t *testing.T) {
		t.Parallel()

		onRetryCounter := atomic.Int32{}
		retryCounterFunc := CreateRetryCounterFunc(&onRetryCounter, nil)

		maxRetryCount := 3
		retryInterval := 300 * time.Millisecond
		maxDuration := 100 * time.Millisecond
		expression := "true"

		opts := core.NewSubgraphRetryOptions(config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				BackoffJitterRetry: config.BackoffJitterRetry{
					Enabled:     true,
					MaxAttempts: maxRetryCount,
					MaxDuration: maxDuration,
					Interval:    retryInterval,
					Expression:  expression,
				},
			},
		})
		opts.OnRetryFunc = retryCounterFunc
		options := core.WithSubgraphRetryOptions(opts)

		testenv.Run(t, &testenv.Config{
			NoRetryClient:   true,
			AccessLogFields: []config.CustomAttribute{},
			RouterOptions: []core.Option{
				options,
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							w.WriteHeader(http.StatusBadGateway)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			startTime := time.Now()
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query employees { employees { id } }`,
			})
			doneTime := time.Now()

			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees', Reason: empty response.","extensions":{"statusCode":502}}],"data":{"employees":null}}`, res.Body)

			// We subtract one from the retry count as we only care about the interval counts
			requestDuration := doneTime.Sub(startTime)

			shouldBeLessThanDuration := (time.Duration(maxRetryCount-1) * retryInterval) - (20 * time.Millisecond)
			require.Less(t, requestDuration, shouldBeLessThanDuration)

			// We reduce by 100 for any jitter
			expectedMinDuration := (time.Duration(maxRetryCount-1) * maxDuration) - (100 * time.Millisecond)
			require.GreaterOrEqual(t, requestDuration, expectedMinDuration)
		})
	})

	t.Run("Verify retry interval for 429", func(t *testing.T) {
		t.Parallel()

		t.Run("when no Retry-After is set", func(t *testing.T) {
			t.Parallel()

			onRetryCounter := atomic.Int32{}
			serviceCallsCounter := atomic.Int32{}
			sleepDuration := atomic.Int64{}

			retryCounterFunc := CreateRetryCounterFunc(&onRetryCounter, &sleepDuration)

			retryInterval := 300 * time.Millisecond
			maxRetryCount := 3
			expression := "statusCode == 429"

			opts := core.NewSubgraphRetryOptions(config.TrafficShapingRules{
				All: config.GlobalSubgraphRequestRule{
					BackoffJitterRetry: config.BackoffJitterRetry{
						Enabled:     true,
						MaxAttempts: maxRetryCount,
						MaxDuration: 1000 * time.Millisecond,
						Interval:    retryInterval,
						Expression:  expression,
					},
				},
			})
			opts.OnRetryFunc = retryCounterFunc
			options := core.WithSubgraphRetryOptions(opts)

			testenv.Run(t, &testenv.Config{
				NoRetryClient:   true,
				AccessLogFields: []config.CustomAttribute{},
				RouterOptions: []core.Option{
					options,
				},
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(_ http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
								w.WriteHeader(http.StatusTooManyRequests)
								serviceCallsCounter.Add(1)
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `query employees { employees { id } }`,
				})

				require.NoError(t, err)
				require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees', Reason: empty response.","extensions":{"statusCode":429}}],"data":{"employees":null}}`, res.Body)

				// The service will get one extra call, in addition to the first request
				require.Equal(t, maxRetryCount, int(onRetryCounter.Load()))
				require.Equal(t, maxRetryCount+1, int(serviceCallsCounter.Load()))

				require.NotEqual(t, sleepDuration.Load(), int64(retryInterval))
			})
		})

		t.Run("when zero Retry-After is set", func(t *testing.T) {
			t.Parallel()

			onRetryCounter := atomic.Int32{}
			serviceCallsCounter := atomic.Int32{}
			sleepDuration := atomic.Int64{}

			retryCounterFunc := CreateRetryCounterFunc(&onRetryCounter, &sleepDuration)

			maxRetryCount := 3
			expression := "statusCode == 429"
			emptyRetryInterval := 0
			retryInterval := 300 * time.Millisecond

			opts := core.NewSubgraphRetryOptions(config.TrafficShapingRules{
				All: config.GlobalSubgraphRequestRule{
					BackoffJitterRetry: config.BackoffJitterRetry{
						Enabled:     true,
						MaxAttempts: maxRetryCount,
						MaxDuration: 1000 * time.Millisecond,
						Interval:    retryInterval,
						Expression:  expression,
					},
				},
			})
			opts.OnRetryFunc = retryCounterFunc
			options := core.WithSubgraphRetryOptions(opts)

			testenv.Run(t, &testenv.Config{
				NoRetryClient:   true,
				AccessLogFields: []config.CustomAttribute{},
				RouterOptions: []core.Option{
					options,
				},
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(_ http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
								w.Header().Set("Retry-After", strconv.Itoa(emptyRetryInterval))
								w.WriteHeader(http.StatusTooManyRequests)
								serviceCallsCounter.Add(1)
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `query employees { employees { id } }`,
				})

				require.NoError(t, err)
				require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees', Reason: empty response.","extensions":{"statusCode":429}}],"data":{"employees":null}}`, res.Body)

				// The service will get one extra call, in addition to the first request
				require.Equal(t, maxRetryCount, int(onRetryCounter.Load()))
				require.Equal(t, maxRetryCount+1, int(serviceCallsCounter.Load()))

				require.NotEqual(t, sleepDuration.Load(), int64(retryInterval))
			})
		})
	})
}

func TestRetryPerSubgraph(t *testing.T) {
	t.Parallel()

	t.Run("verify invalid algorithm is detected for base", func(t *testing.T) {
		t.Parallel()

		// Configure per-subgraph retry: employees gets 3 retries, test1 gets 1 retry
		opts := core.NewSubgraphRetryOptions(config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				BackoffJitterRetry: config.BackoffJitterRetry{
					Enabled:     true,
					Algorithm:   "invalid_algorithm",
					MaxAttempts: 2,
					MaxDuration: 2 * time.Second,
					Interval:    10 * time.Millisecond,
					Expression:  "true",
				},
			},
		})
		options := core.WithSubgraphRetryOptions(opts)

		err := testenv.RunWithError(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: []core.Option{
				options,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			require.Fail(t, "expected initialization to fail due to invalid algorithm")
		})

		require.ErrorContains(t, err, "unsupported retry algorithm")
	})

	t.Run("invalid algorithm is ignored when retries are disabled (base)", func(t *testing.T) {
		t.Parallel()

		opts := core.NewSubgraphRetryOptions(config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				BackoffJitterRetry: config.BackoffJitterRetry{
					Enabled:     false,
					Algorithm:   "invalid_algorithm",
					MaxAttempts: 2,
					MaxDuration: 2 * time.Second,
					Interval:    10 * time.Millisecond,
					Expression:  "true",
				},
			},
		})
		options := core.WithSubgraphRetryOptions(opts)

		err := testenv.RunWithError(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: []core.Option{
				options,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {})

		require.NoError(t, err)
	})

	t.Run("invalid algorithm is ignored when retries are disabled (per subgraph)", func(t *testing.T) {
		t.Parallel()

		opts := core.NewSubgraphRetryOptions(config.TrafficShapingRules{
			Subgraphs: map[string]config.GlobalSubgraphRequestRule{
				"employees": {
					BackoffJitterRetry: config.BackoffJitterRetry{
						Enabled:     false,
						Algorithm:   "invalid_algorithm",
						MaxAttempts: 2,
						MaxDuration: 2 * time.Second,
						Interval:    10 * time.Millisecond,
						Expression:  "true",
					},
				},
			},
		})
		options := core.WithSubgraphRetryOptions(opts)

		err := testenv.RunWithError(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: []core.Option{
				options,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {})

		require.NoError(t, err)
	})

	t.Run("verify invalid algorithm is detected for per subgraphs", func(t *testing.T) {
		t.Parallel()

		opts := core.NewSubgraphRetryOptions(config.TrafficShapingRules{
			Subgraphs: map[string]config.GlobalSubgraphRequestRule{
				"employees": {
					BackoffJitterRetry: config.BackoffJitterRetry{
						Enabled:     true,
						Algorithm:   "invalid_algorithm",
						MaxAttempts: 2,
						MaxDuration: 2 * time.Second,
						Interval:    10 * time.Millisecond,
						Expression:  "true",
					},
				},
			},
		})
		options := core.WithSubgraphRetryOptions(opts)

		err := testenv.RunWithError(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: []core.Option{
				options,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			require.Fail(t, "expected initialization to fail due to invalid algorithm")
		})

		require.ErrorContains(t, err, "unsupported retry algorithm")
	})

	t.Run("verify invalid expression is detected for base", func(t *testing.T) {
		t.Parallel()

		opts := core.NewSubgraphRetryOptions(config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				BackoffJitterRetry: config.BackoffJitterRetry{
					Enabled:     true,
					MaxAttempts: 2,
					MaxDuration: 2 * time.Second,
					Interval:    10 * time.Millisecond,
					Expression:  "truethere",
				},
			},
		})
		options := core.WithSubgraphRetryOptions(opts)

		err := testenv.RunWithError(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: []core.Option{
				options,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			require.Fail(t, "expected initialization to fail due to invalid algorithm")
		})

		require.ErrorContains(t, err, "failed to add base retry expression: failed to compile retry expression: line 1, column 0: unknown name truethere")
	})

	t.Run("verify invalid expression is detected per subgraphs", func(t *testing.T) {
		t.Parallel()

		opts := core.NewSubgraphRetryOptions(config.TrafficShapingRules{
			Subgraphs: map[string]config.GlobalSubgraphRequestRule{
				"employees": {
					BackoffJitterRetry: config.BackoffJitterRetry{
						Enabled:     true,
						MaxAttempts: 2,
						MaxDuration: 2 * time.Second,
						Interval:    10 * time.Millisecond,
						Expression:  "truethere",
					},
				},
			},
		})
		options := core.WithSubgraphRetryOptions(opts)

		err := testenv.RunWithError(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: []core.Option{
				options,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			require.Fail(t, "expected initialization to fail due to invalid algorithm")
		})

		require.ErrorContains(t, err, "failed to add retry expression for subgraph employees: failed to compile retry expression: line 1, column 0: unknown name truethere")
	})

	t.Run("verify valid expression and algorithm", func(t *testing.T) {
		t.Parallel()

		opts := core.NewSubgraphRetryOptions(config.TrafficShapingRules{
			Subgraphs: map[string]config.GlobalSubgraphRequestRule{
				"employees": {
					BackoffJitterRetry: config.BackoffJitterRetry{
						Enabled:     true,
						Algorithm:   "backoff_jitter",
						MaxAttempts: 2,
						MaxDuration: 2 * time.Second,
						Interval:    10 * time.Millisecond,
						Expression:  "true",
					},
				},
			},
		})
		options := core.WithSubgraphRetryOptions(opts)

		err := testenv.RunWithError(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: []core.Option{
				options,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
		})

		require.NoError(t, err)
	})

	t.Run("verify retries are applied per subgraph", func(t *testing.T) {
		t.Parallel()

		employeesCalls := atomic.Int32{}
		test1Calls := atomic.Int32{}

		// Configure per-subgraph retry: employees gets 3 retries, test1 gets 1 retry
		employeesMax := 3
		test1Max := 1
		opts := core.NewSubgraphRetryOptions(config.TrafficShapingRules{
			Subgraphs: map[string]config.GlobalSubgraphRequestRule{
				"employees": {
					BackoffJitterRetry: config.BackoffJitterRetry{
						Enabled:     true,
						MaxAttempts: employeesMax,
						MaxDuration: 2 * time.Second,
						Interval:    10 * time.Millisecond,
						Expression:  "true",
					},
				},
				"test1": {
					BackoffJitterRetry: config.BackoffJitterRetry{
						Enabled:     true,
						MaxAttempts: test1Max,
						MaxDuration: 2 * time.Second,
						Interval:    10 * time.Millisecond,
						Expression:  "true",
					},
				},
			},
		})
		options := core.WithSubgraphRetryOptions(opts)

		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: []core.Option{
				options,
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							w.WriteHeader(http.StatusBadGateway)
							employeesCalls.Add(1)
						})
					},
				},
				Test1: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusBadGateway)
							test1Calls.Add(1)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// 1) Call employees-only query; expect employees subgraph to be retried employeesMax times (attempts = retries + 1)
			resEmp, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query employees { employees { id } }`,
			})
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees', Reason: empty response.","extensions":{"statusCode":502}}],"data":{"employees":null}}`, resEmp.Body)
			require.Equal(t, int32(employeesMax+1), employeesCalls.Load())
			require.Equal(t, int32(0), test1Calls.Load())

			// 2) Call test1-only query; expect test subgraph to be retried test1Max times (attempts = retries + 1)
			resTest1, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { floatField(arg: 1.5) }`,
			})

			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'test1', Reason: empty response.","extensions":{"statusCode":502}}],"data":{"floatField":null}}`, resTest1.Body)
			require.Equal(t, int32(employeesMax+1), employeesCalls.Load())
			require.Equal(t, int32(test1Max+1), test1Calls.Load())
		})
	})

	t.Run("verify retries are applied per subgraph when mixed configurations", func(t *testing.T) {
		t.Parallel()

		employeesCalls := atomic.Int32{}
		test1Calls := atomic.Int32{}

		// Configure per-subgraph retry: employees gets 3 retries, test1 gets 1 retry
		employeesMax := 3
		test1Max := 1
		opts := core.NewSubgraphRetryOptions(config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				BackoffJitterRetry: config.BackoffJitterRetry{
					Enabled:     true,
					MaxAttempts: employeesMax,
					MaxDuration: 2 * time.Second,
					Interval:    10 * time.Millisecond,
					Expression:  "true",
				},
			},
			Subgraphs: map[string]config.GlobalSubgraphRequestRule{
				"test1": {
					BackoffJitterRetry: config.BackoffJitterRetry{
						Enabled:     true,
						MaxAttempts: test1Max,
						MaxDuration: 2 * time.Second,
						Interval:    10 * time.Millisecond,
						Expression:  "true",
					},
				},
			},
		})
		options := core.WithSubgraphRetryOptions(opts)

		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: []core.Option{
				options,
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							w.WriteHeader(http.StatusBadGateway)
							employeesCalls.Add(1)
						})
					},
				},
				Test1: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusBadGateway)
							test1Calls.Add(1)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// 1) Call employees-only query; expect employees subgraph to be retried employeesMax times (attempts = retries + 1)
			resEmp, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query employees { employees { id } }`,
			})
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees', Reason: empty response.","extensions":{"statusCode":502}}],"data":{"employees":null}}`, resEmp.Body)
			require.Equal(t, int32(employeesMax+1), employeesCalls.Load())
			require.Equal(t, int32(0), test1Calls.Load())

			// 2) Call test1-only query; expect test subgraph to be retried test1Max times (attempts = retries + 1)
			resTest1, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { floatField(arg: 1.5) }`,
			})

			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'test1', Reason: empty response.","extensions":{"statusCode":502}}],"data":{"floatField":null}}`, resTest1.Body)
			require.Equal(t, int32(employeesMax+1), employeesCalls.Load())
			require.Equal(t, int32(test1Max+1), test1Calls.Load())
		})
	})

	t.Run("verify retries are applied when only all and no subgraph specific overrides are present", func(t *testing.T) {
		t.Parallel()

		employeesCalls := atomic.Int32{}
		test1Calls := atomic.Int32{}

		// Configure per-subgraph retry: employees gets 3 retries, test1 gets 1 retry
		generalMax := 3
		opts := core.NewSubgraphRetryOptions(config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				BackoffJitterRetry: config.BackoffJitterRetry{
					Enabled:     true,
					MaxAttempts: generalMax,
					MaxDuration: 2 * time.Second,
					Interval:    10 * time.Millisecond,
					Expression:  "true",
				},
			},
		})
		options := core.WithSubgraphRetryOptions(opts)

		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: []core.Option{
				options,
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							w.WriteHeader(http.StatusBadGateway)
							employeesCalls.Add(1)
						})
					},
				},
				Test1: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusBadGateway)
							test1Calls.Add(1)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// 1) Call employees-only query; expect employees subgraph to be retried generalMax times (attempts = retries + 1)
			resEmp, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query employees { employees { id } }`,
			})
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees', Reason: empty response.","extensions":{"statusCode":502}}],"data":{"employees":null}}`, resEmp.Body)
			require.Equal(t, int32(generalMax+1), employeesCalls.Load())
			require.Equal(t, int32(0), test1Calls.Load())

			// 2) Call test1-only query; expect test subgraph to be retried test1Max times (attempts = retries + 1)
			resTest1, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { floatField(arg: 1.5) }`,
			})

			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'test1', Reason: empty response.","extensions":{"statusCode":502}}],"data":{"floatField":null}}`, resTest1.Body)
			require.Equal(t, int32(generalMax+1), employeesCalls.Load())
			require.Equal(t, int32(generalMax+1), test1Calls.Load())
		})
	})

	t.Run("verify retries are applied when only all and no subgraph specific overrides are present", func(t *testing.T) {
		t.Parallel()

		calls := atomic.Int32{}

		// Configure per-subgraph retry: employees gets 3 retries, test1 gets 1 retry
		generalMax := 5
		opts := core.NewSubgraphRetryOptions(config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				BackoffJitterRetry: config.BackoffJitterRetry{
					Enabled:     true,
					MaxAttempts: generalMax,
					MaxDuration: 2 * time.Second,
					Interval:    10 * time.Millisecond,
					Expression:  "true",
				},
			},
		})
		options := core.WithSubgraphRetryOptions(opts)

		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: []core.Option{
				options,
			},
			Subgraphs: testenv.SubgraphsConfig{
				ProductsFg: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							w.WriteHeader(http.StatusBadGateway)
							calls.Add(1)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employees { id products } }`,
				Header: map[string][]string{
					"X-Feature-Flag": {"myff"},
				},
			})
			require.NoError(t, err)
			require.Equal(t, res.Response.Header.Get("X-Feature-Flag"), "myff")
			require.Contains(t, res.Body, `{"message":"Failed to fetch from Subgraph 'products_fg' at Path 'employees', Reason: empty response.","extensions":{"statusCode":502}}`)
			require.Equal(t, int32(generalMax+1), calls.Load())
		})
	})

	t.Run("verify retry on upgrade requests", func(t *testing.T) {
		t.Parallel()

		const failedTries int64 = 2

		const timestampMessage = `{"type":"next","id":"1","payload":{"data":{"currentTime":{"unixTime":1,"timeStamp":"2021-09-01T12:00:00Z"}}}}`
		const completeMessage = `{"type":"complete","id":"1"}`

		employeesCalls := atomic.Int64{}

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketClientReadTimeout = time.Millisecond * 2000
			},

			RouterOptions: []core.Option{
				core.WithSubgraphRetryOptions(core.NewSubgraphRetryOptions(config.TrafficShapingRules{
					All: config.GlobalSubgraphRequestRule{
						BackoffJitterRetry: config.BackoffJitterRetry{
							Enabled:     true,
							MaxAttempts: 5,
							MaxDuration: 10 * time.Second,
							Interval:    200 * time.Millisecond,
							Expression:  "IsRetryableStatusCode() || IsConnectionError() || IsTimeout()",
						},
					},
				})),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							employeesCalls.Add(1)
							if employeesCalls.Load() <= failedTries {
								w.WriteHeader(http.StatusBadGateway)
								return
							}

							upgrader := websocket.Upgrader{
								CheckOrigin: func(r *http.Request) bool {
									return true
								},
								Subprotocols: []string{"graphql-transport-ws"},
							}
							conn, err := upgrader.Upgrade(w, r, nil)
							require.NoError(t, err)
							defer func() {
								_ = conn.Close()
							}()

							_, _, err = testenv.WSReadMessage(t, conn)
							require.NoError(t, err)

							err = testenv.WSWriteMessage(t, conn, websocket.TextMessage, []byte(`{"type":"connection_ack"}`))
							require.NoError(t, err)

							err = testenv.WSWriteMessage(t, conn, websocket.TextMessage, []byte(timestampMessage))
							require.NoError(t, err)

							err = testenv.WSWriteMessage(t, conn, websocket.TextMessage, []byte(completeMessage))
							require.NoError(t, err)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
			})
			require.NoError(t, err)

			// Read a result and store its timestamp, next result should be 1 second later
			_, messageBytes, err := testenv.WSReadMessage(t, conn)
			require.NoError(t, err)

			require.Equal(t, failedTries+1, employeesCalls.Load())

			// ====
			// Verify the messages are correct from here onwards
			// ====
			require.JSONEq(t, timestampMessage, string(messageBytes))

			// Sending a complete must stop the subscription
			err = testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{ID: "1", Type: "complete"})
			require.NoError(t, err)

			err = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
			require.NoError(t, err)

			_, actualCompleteMessage, err := testenv.WSReadMessage(t, conn)
			require.NoError(t, err)
			require.JSONEq(t, completeMessage, string(actualCompleteMessage))

			require.NoError(t, conn.Close())
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})
}
