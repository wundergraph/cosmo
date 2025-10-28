package integration

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
	t.Run("disabled", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: time.Millisecond * 100,
			},
			RouterOptions: []core.Option{
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableSingleFlight:      false,
					ForceEnableSingleFlight: false,
					MaxConcurrentResolvers:  0,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var (
				numOfOperations = int64(10)
				ready, done     sync.WaitGroup
			)
			ready.Add(int(numOfOperations))
			done.Add(int(numOfOperations))
			trigger := make(chan struct{})
			for i := int64(0); i < numOfOperations; i++ {
				go func() {
					ready.Done()
					defer done.Done()
					<-trigger
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `{ employees { id } }`,
					})
					require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
				}()
			}
			ready.Wait()
			close(trigger)
			done.Wait()
			// We expect no request de-duplication because single flight is disabled
			require.Equal(t, xEnv.SubgraphRequestCount.Global.Load(), numOfOperations)
		})
	})
	t.Run("enabled", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: time.Millisecond * 100,
			},
			RouterOptions: []core.Option{
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableSingleFlight:      true,
					ForceEnableSingleFlight: false,
					MaxConcurrentResolvers:  0,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var (
				numOfOperations = int64(10)
				ready, done     sync.WaitGroup
			)
			ready.Add(int(numOfOperations))
			done.Add(int(numOfOperations))
			trigger := make(chan struct{})
			for i := int64(0); i < numOfOperations; i++ {
				go func() {
					ready.Done()
					defer done.Done()
					<-trigger
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `{ employees { id } }`,
					})
					require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
				}()
			}
			ready.Wait()
			close(trigger)
			done.Wait()
			// We expect request de-duplication because single flight is enabled
			require.Less(t, xEnv.SubgraphRequestCount.Global.Load(), numOfOperations)
		})
	})
	t.Run("force-enabled", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: time.Millisecond * 100,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var (
				numOfOperations = int64(10)
				ready, done     sync.WaitGroup
			)
			ready.Add(int(numOfOperations))
			done.Add(int(numOfOperations))
			trigger := make(chan struct{})
			for i := int64(0); i < numOfOperations; i++ {
				go func() {
					ready.Done()
					defer done.Done()
					<-trigger
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `{ employees { id } }`,
					})
					require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
				}()
			}
			ready.Wait()
			close(trigger)
			done.Wait()
			// We expect request de-duplication because single flight is enabled
			require.Less(t, xEnv.SubgraphRequestCount.Global.Load(), numOfOperations)
		})
	})
	t.Run("mutations no deduplication", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: time.Millisecond * 100,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var (
				numOfOperations = int64(10)
				ready, done     sync.WaitGroup
			)
			ready.Add(int(numOfOperations))
			done.Add(int(numOfOperations))
			trigger := make(chan struct{})
			for i := int64(0); i < numOfOperations; i++ {
				go func() {
					ready.Done()
					defer done.Done()
					<-trigger
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
					})
					require.Equal(t, `{"data":{"updateEmployeeTag":{"id":1,"tag":"test"}}}`, res.Body)
				}()
			}
			ready.Wait()
			close(trigger)
			done.Wait()
			// We expect no request de-duplication because mutations must not be de-duplicated
			require.Equal(t, xEnv.SubgraphRequestCount.Global.Load(), numOfOperations)
		})
	})
	t.Run("different headers no deduplication", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: time.Millisecond * 100,
			},
			RouterOptions: []core.Option{
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableSingleFlight:      true,
					ForceEnableSingleFlight: false,
					MaxConcurrentResolvers:  0,
				}),
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
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
				numOfOperations = int64(10)
				ready, done     sync.WaitGroup
			)
			ready.Add(int(numOfOperations))
			done.Add(int(numOfOperations))
			trigger := make(chan struct{})
			for i := int64(0); i < numOfOperations; i++ {
				go func() {
					ready.Done()
					defer done.Done()
					<-trigger
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `{ employees { id } }`,
						Header: http.Header{
							"Authorization": []string{fmt.Sprintf("Bearer test-%d", i)},
						},
					})
					require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
				}()
			}
			ready.Wait()
			close(trigger)
			done.Wait()
			// We expect no request de-duplication because different headers must not be de-duplicated
			require.Equal(t, xEnv.SubgraphRequestCount.Global.Load(), numOfOperations)
		})
	})
	t.Run("same headers should be deduplicated", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: time.Millisecond * 100,
			},
			RouterOptions: []core.Option{
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableSingleFlight:      true,
					ForceEnableSingleFlight: false,
					MaxConcurrentResolvers:  0,
				}),
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
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
				numOfOperations = int64(10)
				ready, done     sync.WaitGroup
			)
			ready.Add(int(numOfOperations))
			done.Add(int(numOfOperations))
			trigger := make(chan struct{})
			for i := int64(0); i < numOfOperations; i++ {
				go func() {
					ready.Done()
					defer done.Done()
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
			ready.Wait()
			close(trigger)
			done.Wait()
			// We expect request de-duplication because same headers should be de-duplicated
			require.Less(t, xEnv.SubgraphRequestCount.Global.Load(), numOfOperations)
		})
	})
	t.Run("subscription deduplication with multiple subgraphs", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: time.Millisecond * 100,
			},
			RouterOptions: []core.Option{
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableSingleFlight:      true,
					ForceEnableSingleFlight: false,
					MaxConcurrentResolvers:  0,
					Debug: config.EngineDebugConfiguration{
						ReportWebSocketConnections: true,
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var (
				numOfOperations = int64(10)
				done            sync.WaitGroup
			)
			done.Add(int(numOfOperations))

			// Wait for all subscriptions to be established before triggering
			go func() {
				xEnv.WaitForSubscriptionCount(uint64(numOfOperations), time.Second*5)
				// Trigger the subscription via NATS to get updates for all subscriptions
				err := xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename": "Employee"}`))
				require.NoError(t, err)
				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)
			}()

			for i := int64(0); i < numOfOperations; i++ {
				go func() {
					defer done.Done()

					conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
					defer conn.Close()

					err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
						ID:      "1",
						Type:    "subscribe",
						Payload: []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } } }"}`),
					})
					require.NoError(t, err)

					// Read one message to ensure subscription is working
					var msg testenv.WebSocketMessage
					err = testenv.WSReadJSON(t, conn, &msg)
					require.NoError(t, err)
					require.Equal(t, "next", msg.Type)
					require.Equal(t, "1", msg.ID)

					// Complete the subscription
					err = testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
						ID:   "1",
						Type: "complete",
					})
					require.NoError(t, err)

					// Read the complete message
					var complete testenv.WebSocketMessage
					err = conn.SetReadDeadline(time.Now().Add(1 * time.Second))
					require.NoError(t, err)
					err = testenv.WSReadJSON(t, conn, &complete)
					require.NoError(t, err)
					require.Equal(t, "complete", complete.Type)
					require.Equal(t, "1", complete.ID)
				}()
			}
			done.Wait()
			xEnv.WaitForSubscriptionCount(0, time.Second*5)

			// We expect request de-duplication because same subscription queries should be de-duplicated
			// This subscription involves multiple subgraphs:
			// - employees subgraph: provides the subscription root and id field
			// - family subgraph: provides details.forename and details.surname fields
			actualSubgraphRequests := xEnv.SubgraphRequestCount.Global.Load()
			require.Less(t, actualSubgraphRequests, numOfOperations)
		})
	})
	t.Run("subscription deduplication with multiple subgraphs - single flight disabled", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: time.Millisecond * 100,
			},
			RouterOptions: []core.Option{
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableSingleFlight:      false,
					ForceEnableSingleFlight: false,
					MaxConcurrentResolvers:  0,
					Debug: config.EngineDebugConfiguration{
						ReportWebSocketConnections: true,
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var (
				numOfOperations = int64(10)
				done            sync.WaitGroup
			)
			done.Add(int(numOfOperations))

			// Wait for all subscriptions to be established before triggering
			go func() {
				xEnv.WaitForSubscriptionCount(uint64(numOfOperations), time.Second*5)
				// Trigger the subscription via NATS to get updates for all subscriptions
				err := xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename": "Employee"}`))
				require.NoError(t, err)
				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)
			}()

			for i := int64(0); i < numOfOperations; i++ {
				go func() {
					defer done.Done()

					conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
					defer conn.Close()

					err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
						ID:      "1",
						Type:    "subscribe",
						Payload: []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } } }"}`),
					})
					require.NoError(t, err)

					// Read one message to ensure subscription is working
					var msg testenv.WebSocketMessage
					err = testenv.WSReadJSON(t, conn, &msg)
					require.NoError(t, err)
					require.Equal(t, "next", msg.Type)
					require.Equal(t, "1", msg.ID)

					// Complete the subscription
					err = testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
						ID:   "1",
						Type: "complete",
					})
					require.NoError(t, err)

					// Read the complete message
					var complete testenv.WebSocketMessage
					err = conn.SetReadDeadline(time.Now().Add(1 * time.Second))
					require.NoError(t, err)
					err = testenv.WSReadJSON(t, conn, &complete)
					require.NoError(t, err)
					require.Equal(t, "complete", complete.Type)
					require.Equal(t, "1", complete.ID)
				}()
			}
			done.Wait()
			xEnv.WaitForSubscriptionCount(0, time.Second*5)

			// We expect no request de-duplication because single flight is disabled
			// This subscription involves multiple subgraphs:
			// - employees subgraph: provides the subscription root and id field
			// - family subgraph: provides details.forename and details.surname fields
			actualSubgraphRequests := xEnv.SubgraphRequestCount.Global.Load()
			require.Equal(t, numOfOperations, actualSubgraphRequests)
		})
	})
	t.Run("subscription deduplication with multiple subgraphs - same headers", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: time.Millisecond * 100,
			},
			RouterOptions: []core.Option{
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableSingleFlight:      true,
					ForceEnableSingleFlight: false,
					MaxConcurrentResolvers:  0,
					Debug: config.EngineDebugConfiguration{
						ReportWebSocketConnections: true,
					},
				}),
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
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
				numOfOperations = int64(10)
				done            sync.WaitGroup
			)
			done.Add(int(numOfOperations))

			// Wait for all subscriptions to be established before triggering
			go func() {
				xEnv.WaitForSubscriptionCount(uint64(numOfOperations), time.Second*5)
				// Trigger the subscription via NATS to get updates for all subscriptions
				err := xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename": "Employee"}`))
				require.NoError(t, err)
				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)
			}()

			for i := int64(0); i < numOfOperations; i++ {
				go func() {
					defer done.Done()

					conn := xEnv.InitGraphQLWebSocketConnection(http.Header{
						"Authorization": []string{"Bearer test"},
					}, nil, nil)
					defer conn.Close()

					err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
						ID:      "1",
						Type:    "subscribe",
						Payload: []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } } }"}`),
					})
					require.NoError(t, err)

					// Read one message to ensure subscription is working
					var msg testenv.WebSocketMessage
					err = testenv.WSReadJSON(t, conn, &msg)
					require.NoError(t, err)
					require.Equal(t, "next", msg.Type)
					require.Equal(t, "1", msg.ID)

					// Complete the subscription
					err = testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
						ID:   "1",
						Type: "complete",
					})
					require.NoError(t, err)

					// Read the complete message
					var complete testenv.WebSocketMessage
					err = conn.SetReadDeadline(time.Now().Add(1 * time.Second))
					require.NoError(t, err)
					err = testenv.WSReadJSON(t, conn, &complete)
					require.NoError(t, err)
					require.Equal(t, "complete", complete.Type)
					require.Equal(t, "1", complete.ID)
				}()
			}
			done.Wait()
			xEnv.WaitForSubscriptionCount(0, time.Second*5)

			// We expect request de-duplication because same headers should be de-duplicated
			// This subscription involves multiple subgraphs:
			// - employees subgraph: provides the subscription root and id field
			// - family subgraph: provides details.forename and details.surname fields
			actualSubgraphRequests := xEnv.SubgraphRequestCount.Global.Load()
			require.Less(t, actualSubgraphRequests, numOfOperations)
		})
	})
	t.Run("subscription deduplication with multiple subgraphs - different headers", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: time.Millisecond * 100,
			},
			RouterOptions: []core.Option{
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableSingleFlight:      true,
					ForceEnableSingleFlight: false,
					MaxConcurrentResolvers:  0,
					Debug: config.EngineDebugConfiguration{
						ReportWebSocketConnections: true,
					},
				}),
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
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
				numOfOperations = int64(10)
				done            sync.WaitGroup
			)
			done.Add(int(numOfOperations))

			// Wait for all subscriptions to be established before triggering
			go func() {
				xEnv.WaitForSubscriptionCount(uint64(numOfOperations), time.Second*5)
				// Trigger the subscription via NATS to get updates for all subscriptions
				err := xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename": "Employee"}`))
				require.NoError(t, err)
				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)
			}()

			for i := int64(0); i < numOfOperations; i++ {
				go func(index int64) {
					defer done.Done()

					conn := xEnv.InitGraphQLWebSocketConnection(http.Header{
						"Authorization": []string{fmt.Sprintf("Bearer test-%d", index)},
					}, nil, nil)
					defer conn.Close()

					err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
						ID:      "1",
						Type:    "subscribe",
						Payload: []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } } }"}`),
					})
					require.NoError(t, err)

					// Read one message to ensure subscription is working
					var msg testenv.WebSocketMessage
					err = testenv.WSReadJSON(t, conn, &msg)
					require.NoError(t, err)
					require.Equal(t, "next", msg.Type)
					require.Equal(t, "1", msg.ID)

					// Complete the subscription
					err = testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
						ID:   "1",
						Type: "complete",
					})
					require.NoError(t, err)

					// Read the complete message
					var complete testenv.WebSocketMessage
					err = conn.SetReadDeadline(time.Now().Add(1 * time.Second))
					require.NoError(t, err)
					err = testenv.WSReadJSON(t, conn, &complete)
					require.NoError(t, err)
					require.Equal(t, "complete", complete.Type)
					require.Equal(t, "1", complete.ID)
				}(i)
			}
			done.Wait()
			xEnv.WaitForSubscriptionCount(0, time.Second*5)

			// We expect no request de-duplication because different headers must not be de-duplicated
			// This subscription involves multiple subgraphs:
			// - employees subgraph: provides the subscription root and id field
			// - family subgraph: provides details.forename and details.surname fields
			actualSubgraphRequests := xEnv.SubgraphRequestCount.Global.Load()
			require.Equal(t, numOfOperations, actualSubgraphRequests)
		})
	})
	t.Run("mutation with multiple subgraphs deduplication", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: time.Millisecond * 100,
			},
			RouterOptions: []core.Option{
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableSingleFlight:      true,
					ForceEnableSingleFlight: false,
					MaxConcurrentResolvers:  0,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var (
				numOfOperations = int64(10)
				ready, done     sync.WaitGroup
			)
			ready.Add(int(numOfOperations))
			done.Add(int(numOfOperations))
			trigger := make(chan struct{})
			for i := int64(0); i < numOfOperations; i++ {
				go func() {
					ready.Done()
					defer done.Done()
					<-trigger
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `mutation { updateMood(employeeID: 1, mood: HAPPY) { id currentMood isAvailable tag } }`,
					})
					require.Contains(t, res.Body, `"updateMood"`)
				}()
			}
			ready.Wait()
			close(trigger)
			done.Wait()

			// The mutation is called 10 times (mutations must not be deduplicated at the root level)
			// However, the subgraph requests for fetching additional fields (like isAvailable, tag, currentMood)
			// should be deduplicated since they are queries to other subgraphs
			moodRequests := xEnv.SubgraphRequestCount.Mood.Load()
			availabilityRequests := xEnv.SubgraphRequestCount.Availability.Load()

			// The mood subgraph receives the mutation, but the additional field requests to availability
			// and global subgraphs should be deduplicated
			require.Equal(t, numOfOperations, moodRequests) // Mutation calls mood subgraph 10 times
			require.Less(t, availabilityRequests, numOfOperations)
		})
	})
	t.Run("mutation with EnableInboundRequestDeduplication enabled - should not deduplicate", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: time.Millisecond * 100,
			},
			RouterOptions: []core.Option{
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableSingleFlight:                true,
					ForceEnableSingleFlight:           false,
					EnableInboundRequestDeduplication: true,
					MaxConcurrentResolvers:            0,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var (
				numOfOperations = int64(10)
				ready, done     sync.WaitGroup
			)
			ready.Add(int(numOfOperations))
			done.Add(int(numOfOperations))
			trigger := make(chan struct{})
			for i := int64(0); i < numOfOperations; i++ {
				go func() {
					ready.Done()
					defer done.Done()
					<-trigger
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `mutation { updateMood(employeeID: 1, mood: HAPPY) { id currentMood } }`,
					})
					require.Contains(t, res.Body, `"updateMood"`)
				}()
			}
			ready.Wait()
			close(trigger)
			done.Wait()

			// Even with EnableInboundRequestDeduplication enabled, mutations should not be deduplicated
			moodRequests := xEnv.SubgraphRequestCount.Mood.Load()
			require.Equal(t, numOfOperations, moodRequests)
		})
	})
	t.Run("query with both SingleFlight and InboundRequestDeduplication enabled - should deduplicate both", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: time.Millisecond * 100,
			},
			RouterOptions: []core.Option{
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableSingleFlight:                true,
					ForceEnableSingleFlight:           false,
					EnableInboundRequestDeduplication: true,
					MaxConcurrentResolvers:            0,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var (
				numOfOperations = int64(10)
				ready, done     sync.WaitGroup
			)
			ready.Add(int(numOfOperations))
			done.Add(int(numOfOperations))
			trigger := make(chan struct{})
			for i := int64(0); i < numOfOperations; i++ {
				go func() {
					ready.Done()
					defer done.Done()
					<-trigger
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `{ employee(id: 1) { id details { forename surname } isAvailable currentMood } }`,
					})
					require.Contains(t, res.Body, `"employee"`)
				}()
			}
			ready.Wait()
			close(trigger)
			done.Wait()

			// With both flags enabled, we should see deduplication at both levels
			globalRequests := xEnv.SubgraphRequestCount.Global.Load()
			familyRequests := xEnv.SubgraphRequestCount.Family.Load()
			availabilityRequests := xEnv.SubgraphRequestCount.Availability.Load()
			moodRequests := xEnv.SubgraphRequestCount.Mood.Load()

			// The root operation should be deduplicated (less than 10 inbound requests)
			// and the subgraph requests should also be deduplicated
			require.Less(t, globalRequests, numOfOperations)
			require.Less(t, familyRequests, numOfOperations)
			require.Less(t, availabilityRequests, numOfOperations)
			require.Less(t, moodRequests, numOfOperations)
		})
	})
	t.Run("query with unique variables - should not deduplicate", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: time.Millisecond * 100,
			},
			RouterOptions: []core.Option{
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableSingleFlight:                true,
					ForceEnableSingleFlight:           false,
					EnableInboundRequestDeduplication: true,
					MaxConcurrentResolvers:            0,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var (
				numOfOperations = int64(10)
				ready, done     sync.WaitGroup
			)
			ready.Add(int(numOfOperations))
			done.Add(int(numOfOperations))
			trigger := make(chan struct{})
			for i := int64(0); i < numOfOperations; i++ {
				go func(index int64) {
					ready.Done()
					defer done.Done()
					<-trigger
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query:     `query($id: Int!) { employee(id: $id) { id tag } }`,
						Variables: []byte(fmt.Sprintf(`{"id": %d}`, index)),
					})
					require.Contains(t, res.Body, `"employee"`)
				}(i)
			}
			ready.Wait()
			close(trigger)
			done.Wait()

			// With unique variables in each request, we should see no deduplication
			globalRequests := xEnv.SubgraphRequestCount.Global.Load()
			require.Equal(t, numOfOperations, globalRequests)
		})
	})
	t.Run("query with unique headers - should not deduplicate", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: time.Millisecond * 100,
			},
			RouterOptions: []core.Option{
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableSingleFlight:                true,
					ForceEnableSingleFlight:           false,
					EnableInboundRequestDeduplication: true,
					MaxConcurrentResolvers:            0,
				}),
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
							{
								Named:     "X-Request-ID",
								Operation: config.HeaderRuleOperationPropagate,
							},
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var (
				numOfOperations = int64(10)
				ready, done     sync.WaitGroup
			)
			ready.Add(int(numOfOperations))
			done.Add(int(numOfOperations))
			trigger := make(chan struct{})
			for i := int64(0); i < numOfOperations; i++ {
				go func(index int64) {
					ready.Done()
					defer done.Done()
					<-trigger
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `{ employee(id: 1) { id tag } }`,
						Header: http.Header{
							"X-Request-ID": []string{fmt.Sprintf("request-%d", index)},
						},
					})
					require.Contains(t, res.Body, `"employee"`)
				}(i)
			}
			ready.Wait()
			close(trigger)
			done.Wait()

			// With unique headers in each request, we should see no deduplication
			globalRequests := xEnv.SubgraphRequestCount.Global.Load()
			require.Equal(t, numOfOperations, globalRequests)
		})
	})
}
