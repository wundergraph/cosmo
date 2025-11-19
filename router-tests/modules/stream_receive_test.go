package module_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hasura/go-graphql-client"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	integration "github.com/wundergraph/cosmo/router-tests"
	"github.com/wundergraph/cosmo/router-tests/events"
	"github.com/wundergraph/cosmo/router-tests/jwks"
	stream_receive "github.com/wundergraph/cosmo/router-tests/modules/stream-receive"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

func TestReceiveHook(t *testing.T) {
	t.Parallel()

	const Timeout = time.Second * 10

	type kafkaSubscriptionArgs struct {
		dataValue []byte
		errValue  error
	}

	t.Run("Test Receive hook is called", func(t *testing.T) {
		t.Parallel()

		// This test verifies that the receive hook is invoked when events are received from Kafka.
		// It confirms the hook is called by checking for the expected log message
		// and that subscription events are properly delivered to the client.

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"streamReceiveModule": stream_receive.StreamReceiveModule{},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&stream_receive.StreamReceiveModule{}),
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

			subscriptionArgsCh := make(chan kafkaSubscriptionArgs)
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

			requestLog := xEnv.Observer().FilterMessage("Stream Hook has been run")
			assert.Len(t, requestLog.All(), 1)
		})
	})

	t.Run("Test Receive hook could change events", func(t *testing.T) {
		t.Parallel()

		// This test verifies that the receive hook can modify events by cloning them first, so they become mutable,
		// and then changing their data. This is the only way to get mutable events, because by default events are immutable.
		// It tests that the modified events are properly delivered to subscribers with the updated data,
		// demonstrating that hooks can transform stream events before they reach clients.

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"streamReceiveModule": stream_receive.StreamReceiveModule{
					Callback: func(ctx core.StreamReceiveEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
						newEvents := make([]datasource.StreamEvent, 0, events.Len())
						for _, event := range events.All() {
							eventCopy := event.Clone()
							eventCopy.SetData([]byte(`{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`))
							newEvents = append(newEvents, eventCopy)
						}

						return datasource.NewStreamEvents(newEvents), nil
					},
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&stream_receive.StreamReceiveModule{}),
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

			subscriptionArgsCh := make(chan kafkaSubscriptionArgs)
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
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, Timeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")

			requestLog := xEnv.Observer().FilterMessage("Stream Hook has been run")
			assert.Len(t, requestLog.All(), 1)
		})
	})

	t.Run("Test hook can't assert to mutable types", func(t *testing.T) {
		t.Parallel()

		// This test verifies that regular StreamEvents cannot be type-asserted to MutableStreamEvent.
		// By default events are immutable in Cosmo Streams hooks, because it is not garantueed they aren't
		// shared with other goroutines.
		// The only acceptable way to get mutable events is to do a deep copy inside the hook by invoking
		// event.Clone(), which returns a mutable copy of the event. If a type assertion would be successful
		// it means the hook developer would have an event of type MutableEvent, but the deep copy never happened.

		var taPossible atomic.Bool
		taPossible.Store(true)

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"streamReceiveModule": stream_receive.StreamReceiveModule{
					Callback: func(ctx core.StreamReceiveEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
						for _, evt := range events.All() {
							_, ok := evt.(datasource.MutableStreamEvent)
							if !ok {
								taPossible.Store(false)
							}
						}
						return events, nil
					},
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&stream_receive.StreamReceiveModule{}),
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

			subscriptionArgsCh := make(chan kafkaSubscriptionArgs)
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

			requestLog := xEnv.Observer().FilterMessage("Stream Hook has been run")
			assert.Len(t, requestLog.All(), 1)

			assert.False(t, taPossible.Load(), "invalid type assertion was possible")
		})
	})

	t.Run("Test Receive hook change events of one of multiple subscriptions", func(t *testing.T) {
		t.Parallel()

		// This test verifies that the receive hook can selectively modify events for specific subscriptions
		// based on the clients authentication context. It tests that when multiple clients are subscribed, the hook can
		// access JWT claims of individual clients and modify events only for authenticated users with specific claims,
		// while leaving events for other clients unchanged.

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"streamReceiveModule": stream_receive.StreamReceiveModule{
					Callback: func(ctx core.StreamReceiveEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
						if ctx.Authentication() == nil {
							return events, nil
						}
						if val, ok := ctx.Authentication().Claims()["sub"]; !ok || val != "user-2" {
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
				},
			},
		}

		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		defer authServer.Close()

		JwksName := "my-jwks-server"

		tokenDecoder, _ := authentication.NewJwksTokenDecoder(integration.NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{{
			URL:             authServer.JWKSURL(),
			RefreshInterval: time.Second * 5,
		}})
		jwksOpts := authentication.HttpHeaderAuthenticatorOptions{
			Name:         JwksName,
			TokenDecoder: tokenDecoder,
		}

		authenticator, err := authentication.NewHttpHeaderAuthenticator(jwksOpts)
		require.NoError(t, err)
		authenticators := []authentication.Authenticator{authenticator}
		controller, err := core.NewAccessController(core.AccessControllerOptions{
			Authenticators:         authenticators,
			AuthenticationRequired: false,
		})
		require.NoError(t, err)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&stream_receive.StreamReceiveModule{}),
				core.WithAccessController(controller),
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

			token, err := authServer.Token(map[string]interface{}{
				"sub": "user-2",
			})
			require.NoError(t, err)

			headers := http.Header{
				"Authorization": []string{"Bearer " + token},
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			client2 := graphql.NewSubscriptionClient(surl)
			client2.WithWebSocketOptions(graphql.WebsocketOptions{
				HTTPHeader: headers,
			})

			subscriptionArgsCh := make(chan kafkaSubscriptionArgs)
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

			subscriptionArgsCh2 := make(chan kafkaSubscriptionArgs)
			subscriptionTwoID, err := client2.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionArgsCh2 <- kafkaSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionTwoID)

			clientRunCh2 := make(chan error)
			go func() {
				clientRunCh2 <- client2.Run()
			}()

			xEnv.WaitForSubscriptionCount(2, Timeout)

			events.ProduceKafkaMessage(t, xEnv, Timeout, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			testenv.AwaitChannelWithT(t, Timeout, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				assert.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			testenv.AwaitChannelWithT(t, Timeout, subscriptionArgsCh2, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				assert.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(args.dataValue))
			})

			unSub1Err := client.Unsubscribe(subscriptionOneID)
			require.NoError(t, unSub1Err)
			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, Timeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")

			unSub2Err := client2.Unsubscribe(subscriptionTwoID)
			require.NoError(t, unSub2Err)
			require.NoError(t, client2.Close())
			testenv.AwaitChannelWithT(t, Timeout, clientRunCh2, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")

			requestLog := xEnv.Observer().FilterMessage("Stream Hook has been run")
			assert.Len(t, requestLog.All(), 2)
		})
	})

	t.Run("Test Receive hook can access custom header", func(t *testing.T) {
		t.Parallel()

		// This test verifies that the receive hook can access custom HTTP headers from the WebSocket connection.
		// It tests that hooks can read headers sent during subscription initialization and use them to
		// conditionally modify events, enabling header-based event transformation logic.

		customHeader := http.CanonicalHeaderKey("X-Custom-Header")

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"streamReceiveModule": stream_receive.StreamReceiveModule{
					Callback: func(ctx core.StreamReceiveEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
						if val, ok := ctx.Request().Header[customHeader]; !ok || val[0] != "Test" {
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
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&stream_receive.StreamReceiveModule{}),
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
			headers := http.Header{
				customHeader: []string{"Test"},
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			client.WithWebSocketOptions(graphql.WebsocketOptions{
				HTTPHeader: headers,
			})

			subscriptionArgsCh := make(chan kafkaSubscriptionArgs)
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

			unSub1Err := client.Unsubscribe(subscriptionOneID)
			require.NoError(t, unSub1Err)
			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, Timeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")

			requestLog := xEnv.Observer().FilterMessage("Stream Hook has been run")
			assert.Len(t, requestLog.All(), 1)
		})
	})

	t.Run("Test Batch hook error should close Kafka clients and subscriptions", func(t *testing.T) {
		t.Parallel()

		// This test verifies that when the receive hook returns an error, the router properly closes
		// the subscription connection and cleans up Kafka clients. It ensures that hook errors trigger
		// graceful shutdown of the subscription to prevent resource leaks or stuck connections.

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"streamReceiveModule": stream_receive.StreamReceiveModule{
					Callback: func(ctx core.StreamReceiveEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
						return datasource.NewStreamEvents(nil), errors.New("test error from streamevents hook")
					},
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&stream_receive.StreamReceiveModule{}),
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

			subscriptionArgsCh := make(chan kafkaSubscriptionArgs)
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

			// Wait for server to close the subscription connection
			xEnv.WaitForSubscriptionCount(0, Timeout)

			// Verify that client.Run() completed when server closed the connection
			testenv.AwaitChannelWithT(t, Timeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "client should have completed when server closed connection")

			xEnv.WaitForTriggerCount(0, Timeout)
		})
	})

	t.Run("Test concurrent handler execution works", func(t *testing.T) {
		t.Parallel()

		// This test verifies that the MaxConcurrentHandlers configuration properly limits the number of
		// receive hooks executing simultaneously. It tests various concurrency levels (1, 2, 10, 20 handlers)
		// with multiple clients to ensure the router respects the concurrency limit and never exceeds it,
		// even under load with many active clients.

		testCases := []struct {
			name           string
			maxConcurrent  int
			numSubscribers int
		}{
			{
				name:           "1 concurrent handler",
				maxConcurrent:  1,
				numSubscribers: 5,
			},
			{
				name:           "2 concurrent handlers",
				maxConcurrent:  2,
				numSubscribers: 10,
			},
			{
				name:           "10 concurrent handlers",
				maxConcurrent:  10,
				numSubscribers: 20,
			},
			{
				name:           "20 concurrent handlers",
				maxConcurrent:  20,
				numSubscribers: 40,
			},
		}

		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()

				var (
					currentHandlers    atomic.Int32
					maxCurrentHandlers atomic.Int32
					finishedHandlers   atomic.Int32
				)

				cfg := config.Config{
					Graph: config.Graph{},
					Modules: map[string]interface{}{
						"streamReceiveModule": stream_receive.StreamReceiveModule{
							Callback: func(ctx core.StreamReceiveEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
								currentHandlers.Add(1)

								// Wait for other hooks in the same client update batch to start.
								for {
									current := currentHandlers.Load()
									max := maxCurrentHandlers.Load()

									if current > max {
										maxCurrentHandlers.CompareAndSwap(max, current)
									}

									if current >= int32(tc.maxConcurrent) {
										// wait to see if the subscription-updater spawns too many concurrent hooks,
										// i.e. exceeding the number of configured max concurrent hooks.
										deadline := time.Now().Add(300 * time.Millisecond)
										for time.Now().Before(deadline) {
											if currentHandlers.Load() > int32(tc.maxConcurrent) {
												break
											}
										}
										break
									}

									// Let hooks continue if we never reach a updater batch size = tc.maxConcurrent
									// because there are not enough remaining clients to be updated.
									// i.e. it could be the last round of updates:
									// 100 clients, now in comes a new event from broker, max concurrent hooks = 30.
									// First round: 30 hooks run, 70 remaining.
									// Second round: 30 hooks run, 40 remaining.
									// Third round: 30 hooks run, 10 remaining.
									// Fourth round: 10 hooks run, then we end up here because remainingSubs < tc.maxConcurrent.
									remainingSubs := tc.numSubscribers - int(finishedHandlers.Load())
									if remainingSubs < tc.maxConcurrent {
										break
									}
								}

								currentHandlers.Add(-1)
								finishedHandlers.Add(1)
								return events, nil
							},
						},
					},
				}

				testenv.Run(t, &testenv.Config{
					RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
					EnableKafka:              true,
					RouterOptions: []core.Option{
						core.WithModulesConfig(cfg.Modules),
						core.WithCustomModules(&stream_receive.StreamReceiveModule{}),
						core.WithStreamsHandlerConfiguration(config.StreamsHandlerConfiguration{
							OnReceiveEvents: config.OnReceiveEventsConfiguration{
								MaxConcurrentHandlers: tc.maxConcurrent,
							},
						}),
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

					clients := make([]*graphql.SubscriptionClient, tc.numSubscribers)
					clientRunChs := make([]chan error, tc.numSubscribers)
					subscriptionArgsChs := make([]chan kafkaSubscriptionArgs, tc.numSubscribers)

					for i := range tc.numSubscribers {
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

					xEnv.WaitForSubscriptionCount(uint64(tc.numSubscribers), Timeout)

					events.ProduceKafkaMessage(t, xEnv, Timeout, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

					// Collect events from all subscribers
					for i := 0; i < tc.numSubscribers; i++ {
						testenv.AwaitChannelWithT(t, Timeout, subscriptionArgsChs[i], func(t *testing.T, args kafkaSubscriptionArgs) {
							require.NoError(t, args.errValue)
							require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
						})
					}

					// Close all clients
					for i := 0; i < tc.numSubscribers; i++ {
						require.NoError(t, clients[i].Close())
						testenv.AwaitChannelWithT(t, Timeout, clientRunChs[i], func(t *testing.T, err error) {
							require.NoError(t, err)
						}, "unable to close client before timeout")
					}

					for i := range subscriptionArgsChs {
						close(subscriptionArgsChs[i])
					}

					assert.Equal(t, int32(tc.maxConcurrent), maxCurrentHandlers.Load(), "amount of concurrent handlers not what was expected")

					requestLog := xEnv.Observer().FilterMessage("Stream Hook has been run")
					assert.Len(t, requestLog.All(), tc.numSubscribers)
				})
			})
		}
	})

	t.Run("Test timeout mechanism allows out-of-order event delivery", func(t *testing.T) {
		t.Parallel()

		// One subscriber receives three consecutive events.
		// The first event's hook is delayed, exceeding the configurable hook timeout.
		// The second and third events' hooks process immediately without delay.
		// Because the first hook exceeds the timeout, the subscription-updater gives up waiting for it
		// and proceedes to process the second and third events immediately.
		// The first event will be delivered later when its hook finally completes.
		// This should result in the first event being delivered last.
		//
		// Delivering events out of order is a tradeoff to ensure that hooks do not block the subscription-updater for too long.
		// We try to keep the order but once the timeout is exceeded we need to move on and it's no longer guaranteed.

		hookDelay := 500 * time.Millisecond
		hookTimeout := 100 * time.Millisecond

		var callCount atomic.Int32

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"streamReceiveModule": stream_receive.StreamReceiveModule{
					Callback: func(ctx core.StreamReceiveEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
						// Only the first call should delay
						if callCount.Add(1) == 1 {
							time.Sleep(hookDelay)
						}
						return events, nil
					},
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&stream_receive.StreamReceiveModule{}),
				core.WithStreamsHandlerConfiguration(config.StreamsHandlerConfiguration{
					OnReceiveEvents: config.OnReceiveEventsConfiguration{
						MaxConcurrentHandlers: 3,
						HandlerTimeout:        hookTimeout,
					},
				}),
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

			subscriptionArgsCh := make(chan kafkaSubscriptionArgs, 3)
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

			events.ProduceKafkaMessage(t, xEnv, Timeout, topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"first"}}`)
			events.ProduceKafkaMessage(t, xEnv, Timeout, topics[0], `{"__typename":"Employee","id": 2,"update":{"name":"second"}}`)
			events.ProduceKafkaMessage(t, xEnv, Timeout, topics[0], `{"__typename":"Employee","id": 3,"update":{"name":"third"}}`)

			// Collect all 3 events
			receivedIDs := make([]float64, 0, 3)
			for i := 0; i < 3; i++ {
				testenv.AwaitChannelWithT(t, Timeout, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
					require.NoError(t, args.errValue)

					var response struct {
						EmployeeUpdatedMyKafka struct {
							ID float64 `json:"id"`
						} `json:"employeeUpdatedMyKafka"`
					}
					err := json.Unmarshal(args.dataValue, &response)
					require.NoError(t, err)
					receivedIDs = append(receivedIDs, response.EmployeeUpdatedMyKafka.ID)
				})
			}

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, Timeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")

			// Verify events arrived out of order: event 1 should be the last one to arrive
			assert.ElementsMatch(t, []float64{1, 2, 3}, receivedIDs, "expected to receive all events")
			assert.Equal(t, float64(1), receivedIDs[len(receivedIDs)-1], "expected the delayed event to arrive last")
			assert.NotEqual(t, float64(1), receivedIDs[0], "expected at least one later event to arrive before the delayed one")

			timeoutLog := xEnv.Observer().FilterMessage("Timeout exceeded during subscription updates, events may arrive out of order")
			assert.Len(t, timeoutLog.All(), 1, "expected timeout warning to be logged")

			// Verify all hooks were executed
			hookLog := xEnv.Observer().FilterMessage("Stream Hook has been run")
			assert.Len(t, hookLog.All(), 3)
		})
	})
}
