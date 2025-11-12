package module_test

import (
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

	t.Run("Test Receive hook change events of one of multiple subscriptions", func(t *testing.T) {
		t.Parallel()

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

								// wait for other handlers in the batch
								for {
									current := currentHandlers.Load()
									max := maxCurrentHandlers.Load()

									if current > max {
										maxCurrentHandlers.CompareAndSwap(max, current)
									}

									if current >= int32(tc.maxConcurrent) {
										// wait to see if the updater spawns too many concurrent handlers
										deadline := time.Now().Add(300 * time.Millisecond)
										for time.Now().Before(deadline) {
											if currentHandlers.Load() > int32(tc.maxConcurrent) {
												break
											}
										}
										break
									}

									// Let handlers continue if we never reach a batch size = tc.maxConcurrent
									// because there are not enough remaining subscribers to be updated.
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
						core.WithSubscriptionHooks(config.SubscriptionHooksConfiguration{
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
}
