package integration

import (
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"io"
	"net/http"
	"strconv"
	"sync/atomic"
	"testing"
	"time"
)

func CreateRetryCounterFunc(counter *atomic.Int32) func(count int, req *http.Request, resp *http.Response, err error) {
	return func(count int, req *http.Request, resp *http.Response, err error) {
		counter.Add(1)
	}
}

func TestRetry(t *testing.T) {
	t.Parallel()

	t.Run("verify retries when every retry results in a failure", func(t *testing.T) {
		t.Parallel()

		onRetryCounter := atomic.Int32{}
		serviceCallsCounter := atomic.Int32{}
		retryCounterFunc := CreateRetryCounterFunc(&onRetryCounter)

		maxRetryCount := 3
		retryInterval := 200 * time.Millisecond
		maxDuration := 10 * time.Second
		expression := "true"

		options := core.WithSubgraphRetryOptions(true, maxRetryCount, maxDuration, retryInterval, expression, retryCounterFunc, nil)

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
			startTime := time.Now()
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query employees { employees { id } }`,
			})
			doneTime := time.Now()

			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees', Reason: empty response.","extensions":{"statusCode":502}}],"data":{"employees":null}}`, res.Body)

			// We subtract one from the retry count as we only care about the interval counts
			requestDuration := doneTime.Sub(startTime)
			expectedDuration := time.Duration(maxRetryCount-1) * retryInterval
			require.GreaterOrEqual(t, requestDuration, expectedDuration)

			// The service will get one extra call, in addition to the first request
			require.Equal(t, maxRetryCount, int(onRetryCounter.Load()))
			require.Equal(t, maxRetryCount+1, int(serviceCallsCounter.Load()))
		})
	})

	t.Run("verify retries when only first n retries results in a failure", func(t *testing.T) {
		t.Parallel()

		onRetryCounter := atomic.Int32{}
		serviceCallsCounter := atomic.Int32{}
		retryCounterFunc := CreateRetryCounterFunc(&onRetryCounter)

		maxRetryCount := 5
		maxAttemptsBeforeServiceSucceeds := 2
		retryInterval := 200 * time.Millisecond
		maxDuration := 10 * time.Second
		expression := "true"

		options := core.WithSubgraphRetryOptions(true, maxRetryCount, maxDuration, retryInterval, expression, retryCounterFunc, nil)

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
			startTime := time.Now()
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query employees { employees { id } }`,
			})
			doneTime := time.Now()
			require.NoError(t, err)
			require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2}]}}`, res.Body)

			// We subtract one from the retry count as we only care about the interval counts
			requestDuration := doneTime.Sub(startTime)
			expectedDuration := time.Duration(maxAttemptsBeforeServiceSucceeds-1) * retryInterval
			require.GreaterOrEqual(t, requestDuration, expectedDuration)

			// The service will get one extra call, in addition to the first request
			require.Equal(t, maxAttemptsBeforeServiceSucceeds, int(onRetryCounter.Load()))
			require.Equal(t, maxAttemptsBeforeServiceSucceeds+1, int(serviceCallsCounter.Load()))
		})
	})

	t.Run("verify max duration is not exceeded on intervals", func(t *testing.T) {
		t.Parallel()

		onRetryCounter := atomic.Int32{}
		retryCounterFunc := CreateRetryCounterFunc(&onRetryCounter)

		maxRetryCount := 3
		retryInterval := 300 * time.Millisecond
		maxDuration := 100 * time.Millisecond
		expression := "true"

		options := core.WithSubgraphRetryOptions(true, maxRetryCount, maxDuration, retryInterval, expression, retryCounterFunc, nil)

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

			// We reduce by 50 for any timing flakiness
			expectedMinDuration := (time.Duration(maxRetryCount-1) * maxDuration) - (50 * time.Millisecond)
			require.GreaterOrEqual(t, requestDuration, expectedMinDuration)
		})
	})

	t.Run("verify default failure still causes retries ignoring expression", func(t *testing.T) {
		t.Parallel()

		onRetryCounter := atomic.Int32{}
		serviceCallsCounter := atomic.Int32{}
		retryCounterFunc := CreateRetryCounterFunc(&onRetryCounter)

		maxRetryCount := 3
		expression := "false"

		var rtWrapper RoundTripWrapper = func(request *http.Request) (*http.Response, error) {
			serviceCallsCounter.Add(1)
			return nil, io.ErrUnexpectedEOF
		}

		options := core.WithSubgraphRetryOptions(true, maxRetryCount, 10*time.Second, 200*time.Millisecond, expression, retryCounterFunc, rtWrapper)

		testenv.Run(t, &testenv.Config{
			NoRetryClient:   true,
			AccessLogFields: []config.CustomAttribute{},
			RouterOptions: []core.Option{
				options,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query employees { employees { id } }`,
			})
			require.NoError(t, err)

			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'."}],"data":{"employees":null}}`, res.Body)

			require.Equal(t, maxRetryCount, int(onRetryCounter.Load()))
			require.Equal(t, maxRetryCount+1, int(serviceCallsCounter.Load()))
		})
	})

	t.Run("Verify retry interval for 429", func(t *testing.T) {
		t.Parallel()

		t.Run("when no Retry-After is set", func(t *testing.T) {
			t.Parallel()

			onRetryCounter := atomic.Int32{}
			serviceCallsCounter := atomic.Int32{}
			retryCounterFunc := CreateRetryCounterFunc(&onRetryCounter)

			maxRetryCount := 3
			expression := "statusCode == 429"
			retryInterval := 300 * time.Millisecond

			options := core.WithSubgraphRetryOptions(true, maxRetryCount, 1000*time.Millisecond, retryInterval, expression, retryCounterFunc, nil)

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
				startTime := time.Now()
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Header: map[string][]string{
						"service-name": {"service-name"},
					},
					Query: `query employees { employees { id } }`,
				})
				doneTime := time.Now()

				require.NoError(t, err)
				require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees', Reason: empty response.","extensions":{"statusCode":429}}],"data":{"employees":null}}`, res.Body)

				// We subtract one from the retry count as we only care about the interval counts
				requestDuration := doneTime.Sub(startTime)
				expectedDuration := time.Duration(maxRetryCount-1) * retryInterval
				require.GreaterOrEqual(t, requestDuration, expectedDuration)

				// The service will get one extra call, in addition to the first request
				require.Equal(t, maxRetryCount, int(onRetryCounter.Load()))
				require.Equal(t, maxRetryCount+1, int(serviceCallsCounter.Load()))
			})
		})

		t.Run("when zero Retry-After is set", func(t *testing.T) {
			t.Parallel()

			onRetryCounter := atomic.Int32{}
			serviceCallsCounter := atomic.Int32{}
			retryCounterFunc := CreateRetryCounterFunc(&onRetryCounter)

			maxRetryCount := 3
			expression := "statusCode == 429"
			emptyRetryInterval := 0
			retryInterval := 300 * time.Millisecond

			options := core.WithSubgraphRetryOptions(true, maxRetryCount, 1000*time.Millisecond, retryInterval, expression, retryCounterFunc, nil)

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
				startTime := time.Now()
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Header: map[string][]string{
						"Retry-After": {
							strconv.Itoa(emptyRetryInterval),
						},
					},
					Query: `query employees { employees { id } }`,
				})
				doneTime := time.Now()

				require.NoError(t, err)
				require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees', Reason: empty response.","extensions":{"statusCode":429}}],"data":{"employees":null}}`, res.Body)

				// We subtract one from the retry count as we only care about the interval counts
				requestDuration := doneTime.Sub(startTime)
				expectedDuration := time.Duration(maxRetryCount-1) * retryInterval
				require.GreaterOrEqual(t, requestDuration, expectedDuration)

				// The service will get one extra call, in addition to the first request
				require.Equal(t, maxRetryCount, int(onRetryCounter.Load()))
				require.Equal(t, maxRetryCount+1, int(serviceCallsCounter.Load()))
			})
		})

		t.Run("when a nonzero Retry-After is set", func(t *testing.T) {
			t.Parallel()

			onRetryCounter := atomic.Int32{}
			serviceCallsCounter := atomic.Int32{}
			retryCounterFunc := CreateRetryCounterFunc(&onRetryCounter)

			maxRetryCount := 3
			expression := "statusCode == 429"
			actualRetryInterval := int(100 * time.Millisecond)

			options := core.WithSubgraphRetryOptions(true, maxRetryCount, 1000*time.Millisecond, 100*time.Millisecond, expression, retryCounterFunc, nil)

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
				startTime := time.Now()
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Header: map[string][]string{
						"Retry-After": {
							strconv.Itoa(actualRetryInterval),
						},
					},
					Query: `query employees { employees { id } }`,
				})
				doneTime := time.Now()

				require.NoError(t, err)
				require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees', Reason: empty response.","extensions":{"statusCode":429}}],"data":{"employees":null}}`, res.Body)

				// We subtract one from the retry count as we only care about the interval counts
				requestDuration := doneTime.Sub(startTime)
				expectedDuration := time.Duration(maxRetryCount - 1*actualRetryInterval)
				require.GreaterOrEqual(t, requestDuration, expectedDuration)

				// The service will get one extra call, in addition to the first request
				require.Equal(t, maxRetryCount, int(onRetryCounter.Load()))
				require.Equal(t, maxRetryCount+1, int(serviceCallsCounter.Load()))
			})
		})
	})

}

type RoundTripWrapper func(*http.Request) (*http.Response, error)

func (rw RoundTripWrapper) RoundTrip(req *http.Request) (*http.Response, error) {
	return rw(req)
}
