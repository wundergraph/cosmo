package module_test

import (
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hasura/go-graphql-client"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/events"
	stream_broadcast "github.com/wundergraph/cosmo/router-tests/modules/stream-broadcast"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap/zapcore"
)

func TestBroadcastHook(t *testing.T) {
	t.Parallel()

	const Timeout = time.Second * 10

	type kafkaSubscriptionArgs struct {
		dataValue []byte
		errValue  error
	}

	t.Run("OnBroadcastEvents hook could change events for all subscribers", func(t *testing.T) {
		t.Parallel()

		// This test verifies that the broadcast hook can modify events by cloning them first, so they become mutable,
		// and then changing their data. Unlike OnReceiveEvents, OnBroadcastEvents runs once per batch, before the
		// per-subscriber fan-out, so a single hook invocation must be enough to update all subscribers.

		customModule := stream_broadcast.StreamBroadcastModule{
			HookCallCount: &atomic.Int32{},
			Callback: func(ctx core.StreamBroadcastEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
				newEvents := make([]datasource.StreamEvent, 0, events.Len())
				for _, event := range events.All() {
					eventCopy := event.Clone()
					eventCopy.SetData([]byte(`{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`))
					newEvents = append(newEvents, eventCopy)
				}

				return datasource.NewStreamEvents(newEvents), nil
			},
		}

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"streamBroadcastModule": customModule,
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&stream_broadcast.StreamBroadcastModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			topics := []string{"employeeUpdated"}
			events.KafkaEnsureTopicExists(t, xEnv, time.Second, topics...)

			var subscriptionQuery struct {
				employeeUpdatedMyKafka struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyKafka(employeeID: 3)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()

			const numSubscribers = 3
			clients := make([]*graphql.SubscriptionClient, numSubscribers)
			clientRunChs := make([]chan error, numSubscribers)
			subscriptionArgsChs := make([]chan kafkaSubscriptionArgs, numSubscribers)

			for i := 0; i < numSubscribers; i++ {
				clients[i] = graphql.NewSubscriptionClient(surl)
				clientRunChs[i] = make(chan error)
				subscriptionArgsChs[i] = make(chan kafkaSubscriptionArgs, 1)

				idx := i
				subscriptionID, err := clients[i].Subscribe(&subscriptionQuery, nil, func(dataValue []byte, errValue error) error {
					subscriptionArgsChs[idx] <- kafkaSubscriptionArgs{
						dataValue: dataValue,
						errValue:  errValue,
					}
					return nil
				})
				require.NoError(t, err)
				require.NotEmpty(t, subscriptionID)

				go func(i int) {
					clientRunChs[i] <- clients[i].Run()
				}(i)
			}

			xEnv.WaitForSubscriptionCount(numSubscribers, Timeout)

			xEnv.KafkaPublishUntilReceived(topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`, 1, Timeout)

			for i := range numSubscribers {
				testenv.AwaitChannelWithT(t, Timeout, subscriptionArgsChs[i], func(t *testing.T, args kafkaSubscriptionArgs) {
					require.NoError(t, args.errValue)
					assert.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(args.dataValue))
				})
			}

			for i := range numSubscribers {
				require.NoError(t, clients[i].Close())
				testenv.AwaitChannelWithT(t, Timeout, clientRunChs[i], func(t *testing.T, err error) {
					require.NoError(t, err)
				}, "unable to close client before timeout")
			}

			// The hook runs once per batch, not once per subscriber.
			// Asserting >=1 since KafkaPublishUntilReceived could publish more than once.
			assert.GreaterOrEqual(t, customModule.HookCallCount.Load(), int32(1))
		})
	})

	t.Run("OnBroadcastEvents hook error drops the batch but keeps the connection open", func(t *testing.T) {
		t.Parallel()

		// This test verifies that when the broadcast hook returns an error, the whole batch is dropped
		// (no subscriber receives an update for it) but, unlike OnReceiveEvents, the subscription connection
		// and Kafka clients stay open. A subsequent, successfully-processed event must still be delivered.

		var shouldFail atomic.Bool
		shouldFail.Store(true)

		customModule := stream_broadcast.StreamBroadcastModule{
			HookCallCount: &atomic.Int32{},
			Callback: func(ctx core.StreamBroadcastEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
				if shouldFail.Load() {
					return datasource.NewStreamEvents(nil), errors.New("test error from broadcast hook")
				}
				return events, nil
			},
		}

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"streamBroadcastModule": customModule,
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&stream_broadcast.StreamBroadcastModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			topics := []string{"employeeUpdated"}
			events.KafkaEnsureTopicExists(t, xEnv, time.Second, topics...)

			var subscriptionOne struct {
				employeeUpdatedMyKafka struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyKafka(employeeID: 3)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			subscriptionArgsCh := make(chan kafkaSubscriptionArgs, 1)
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionArgsCh <- kafkaSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, Timeout)

			events.ProduceKafkaMessage(t, xEnv, Timeout, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			// The batch is dropped by the hook, so no update should arrive for it.
			select {
			case args := <-subscriptionArgsCh:
				t.Fatalf("expected no event to be delivered while the hook is failing, got: %v", args)
			case <-time.After(time.Second * 2):
			}

			// The subscription must still be alive.
			xEnv.WaitForSubscriptionCount(1, Timeout)

			require.Eventually(t, func() bool {
				return customModule.HookCallCount.Load() >= 1
			}, Timeout, time.Millisecond*50)

			warnLogs := xEnv.Observer().FilterMessage("OnBroadcastEvents handler failed, dropping event batch")
			assert.GreaterOrEqual(t, warnLogs.Len(), 1, "expected a warning about the dropped batch to be logged")

			// Now let a subsequent event succeed to prove the connection is still functional.
			shouldFail.Store(false)

			xEnv.KafkaPublishUntilReceived(topics[0], `{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`, 1, Timeout)

			testenv.AwaitChannelWithT(t, Timeout, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				assert.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, Timeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")
		})
	})

	t.Run("OnBroadcastEvents can't assert to mutable types", func(t *testing.T) {
		t.Parallel()

		// This test verifies that regular StreamEvents cannot be type-asserted to MutableStreamEvent.
		// By default events are immutable in Cosmo Streams hooks, because it is not garantueed they aren't
		// shared with other goroutines.
		// The only acceptable way to get mutable events is to do a deep copy inside the hook by invoking
		// event.Clone(), which returns a mutable copy of the event. If a type assertion would be successful
		// it means the hook developer would have an event of type MutableEvent, but the deep copy never happened.

		var taPossible atomic.Bool
		taPossible.Store(true)

		customModule := stream_broadcast.StreamBroadcastModule{
			HookCallCount: &atomic.Int32{},
			Callback: func(ctx core.StreamBroadcastEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
				for _, evt := range events.All() {
					_, ok := evt.(datasource.MutableStreamEvent)
					if !ok {
						taPossible.Store(false)
					}
				}
				return events, nil
			},
		}

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"streamBroadcastModule": customModule,
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&stream_broadcast.StreamBroadcastModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			topics := []string{"employeeUpdated"}
			events.KafkaEnsureTopicExists(t, xEnv, time.Second, topics...)

			var subscriptionOne struct {
				employeeUpdatedMyKafka struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyKafka(employeeID: 3)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			subscriptionArgsCh := make(chan kafkaSubscriptionArgs, 1)
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionArgsCh <- kafkaSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, Timeout)

			events.ProduceKafkaMessage(t, xEnv, Timeout, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			testenv.AwaitChannelWithT(t, Timeout, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, Timeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")

			assert.Equal(t, int32(1), customModule.HookCallCount.Load())

			assert.False(t, taPossible.Load(), "invalid type assertion was possible")
		})
	})

	t.Run("OnBroadcastEvents hook can access subscription event configuration", func(t *testing.T) {
		t.Parallel()

		// This test verifies that the broadcast hook can access the subscription event configuration
		// (provider ID, provider type, root field name). Unlike OnReceiveEvents, OnBroadcastEvents runs
		// once per batch before any per-subscriber fan-out, so there is no per-subscriber HTTP request or
		// client authentication available on its context - only metadata about the subscription/provider
		// that produced the batch. This test uses that metadata to conditionally transform events.

		customModule := stream_broadcast.StreamBroadcastModule{
			HookCallCount: &atomic.Int32{},
			Callback: func(ctx core.StreamBroadcastEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
				subConf := ctx.SubscriptionEventConfiguration()
				if subConf == nil || subConf.RootFieldName() != "employeeUpdatedMyKafka" || subConf.ProviderType() != datasource.ProviderTypeKafka {
					return events, nil
				}

				newEvents := make([]datasource.StreamEvent, 0, events.Len())
				for _, event := range events.All() {
					eventCopy := event.Clone()
					eventCopy.SetData([]byte(`{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`))
					newEvents = append(newEvents, eventCopy)
				}

				return datasource.NewStreamEvents(newEvents), nil
			},
		}

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"streamBroadcastModule": customModule,
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&stream_broadcast.StreamBroadcastModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			topics := []string{"employeeUpdated"}
			events.KafkaEnsureTopicExists(t, xEnv, time.Second, topics...)

			var subscriptionOne struct {
				employeeUpdatedMyKafka struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyKafka(employeeID: 3)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			subscriptionArgsCh := make(chan kafkaSubscriptionArgs, 1)
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionArgsCh <- kafkaSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, Timeout)

			events.ProduceKafkaMessage(t, xEnv, Timeout, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			testenv.AwaitChannelWithT(t, Timeout, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				assert.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, Timeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")

			assert.Equal(t, int32(1), customModule.HookCallCount.Load())
		})
	})
}
