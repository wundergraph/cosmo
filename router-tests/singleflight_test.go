package integration_test

import (
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestSingleFlight(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			GlobalDelay: time.Millisecond * 100,
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		var (
			numOfOperations = 10
			wg              sync.WaitGroup
		)
		wg.Add(numOfOperations)
		trigger := make(chan struct{})
		for i := 0; i < numOfOperations; i++ {
			go func() {
				defer wg.Done()
				<-trigger
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
				})
				require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
			}()
		}
		close(trigger)
		wg.Wait()
		// We expect that the number of requests is less than the number of operations
		require.NotEqual(t, int64(numOfOperations), xEnv.SubgraphRequestCount.Global.Load())
	})
}

func TestSingleFlightWithMaxConcurrency(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			GlobalDelay: time.Millisecond * 100,
		},
		RouterOptions: []core.Option{
			core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
				EnableSingleFlight:     true,
				MaxConcurrentResolvers: 1,
			}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		var (
			numOfOperations = 3
			wg              sync.WaitGroup
		)
		wg.Add(numOfOperations)
		trigger := make(chan struct{})
		for i := 0; i < numOfOperations; i++ {
			go func() {
				defer wg.Done()
				<-trigger
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
				})
				require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
			}()
		}
		close(trigger)
		wg.Wait()
		// As we've limited concurrency to 1, we expect that the number of requests is equal to the number of operations
		// even though we've enabled single flight
		require.Equal(t, int64(numOfOperations), xEnv.SubgraphRequestCount.Global.Load())
	})
}

func TestSingleFlightWithMaxConcurrencyHigh(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			GlobalDelay: time.Millisecond * 100,
		},
		RouterOptions: []core.Option{
			core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
				EnableSingleFlight:     true,
				MaxConcurrentResolvers: 1024,
			}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		var (
			numOfOperations = 3
			wg              sync.WaitGroup
		)
		wg.Add(numOfOperations)
		trigger := make(chan struct{})
		for i := 0; i < numOfOperations; i++ {
			go func() {
				defer wg.Done()
				<-trigger
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
				})
				require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
			}()
		}
		close(trigger)
		wg.Wait()
		// In this case, we increased the concurrency to 1024,
		// so we expect that the number of requests is less than the number of operations
		require.NotEqual(t, int64(numOfOperations), xEnv.SubgraphRequestCount.Global.Load())
	})
}

func TestSingleFlightWithMaxConcurrencyZero(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			GlobalDelay: time.Millisecond * 100,
		},
		RouterOptions: []core.Option{
			core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
				EnableSingleFlight:     true,
				MaxConcurrentResolvers: 0,
			}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		var (
			numOfOperations = 3
			wg              sync.WaitGroup
		)
		wg.Add(numOfOperations)
		trigger := make(chan struct{})
		for i := 0; i < numOfOperations; i++ {
			go func() {
				defer wg.Done()
				<-trigger
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
				})
				require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
			}()
		}
		close(trigger)
		wg.Wait()
		// In this case, we disabled limiting concurrency
		// so we expect that the number of requests is less than the number of operations
		require.NotEqual(t, int64(numOfOperations), xEnv.SubgraphRequestCount.Global.Load())
	})
}

func TestSingleFlightMutations(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			GlobalDelay: time.Millisecond * 100,
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		var (
			numOfOperations = 10
			wg              sync.WaitGroup
		)
		wg.Add(numOfOperations)
		trigger := make(chan struct{})
		for i := 0; i < numOfOperations; i++ {
			go func() {
				defer wg.Done()
				<-trigger
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
				})
				require.Equal(t, `{"data":{"updateEmployeeTag":{"id":1,"tag":"test"}}}`, res.Body)
			}()
		}
		close(trigger)
		wg.Wait()
		// We expect that the number of requests is less than the number of operations
		require.Equal(t, int64(numOfOperations), xEnv.SubgraphRequestCount.Global.Load())
	})
}

func TestSingleFlightDifferentHeaders(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			GlobalDelay: time.Millisecond * 100,
		},
		RouterOptions: []core.Option{
			core.WithHeaderRules(config.HeaderRules{
				All: config.GlobalHeaderRule{
					Request: []config.RequestHeaderRule{
						{
							Named:     "Authorization",
							Operation: config.HeaderRuleOperationPropagate,
						},
					},
				},
			}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		var (
			numOfOperations = 10
			wg              sync.WaitGroup
		)
		wg.Add(numOfOperations)
		trigger := make(chan struct{})
		for i := 0; i < numOfOperations; i++ {
			i := i
			go func(num int) {
				defer wg.Done()
				<-trigger
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
					Header: http.Header{
						"Authorization": []string{fmt.Sprintf("Bearer test-%d", i)},
					},
				})
				require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
			}(i)
		}
		close(trigger)
		wg.Wait()
		// We expect that the number of requests is less than the number of operations
		require.Equal(t, int64(numOfOperations), xEnv.SubgraphRequestCount.Global.Load())
	})
}

func TestSingleFlightSameHeaders(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			GlobalDelay: time.Millisecond * 100,
		},
		RouterOptions: []core.Option{
			core.WithHeaderRules(config.HeaderRules{
				All: config.GlobalHeaderRule{
					Request: []config.RequestHeaderRule{
						{
							Named:     "Authorization",
							Operation: config.HeaderRuleOperationPropagate,
						},
					},
				},
			}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		var (
			numOfOperations = 10
			wg              sync.WaitGroup
		)
		wg.Add(numOfOperations)
		trigger := make(chan struct{})
		for i := 0; i < numOfOperations; i++ {
			go func() {
				defer wg.Done()
				<-trigger
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employees { id } }`,
					Header: http.Header{
						"Authorization": []string{"Bearer test"},
					},
				})
				require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
			}()
		}
		close(trigger)
		wg.Wait()
		require.NotEqual(t, int64(numOfOperations), xEnv.SubgraphRequestCount.Global.Load())
	})
}
