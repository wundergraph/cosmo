package module_test

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"go.uber.org/zap/zapcore"

	"github.com/hasura/go-graphql-client"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/events"
	stream_receive "github.com/wundergraph/cosmo/router-tests/modules/stream-receive"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
)

type errorWithCloseSubscription struct {
	err error
}

func (e *errorWithCloseSubscription) Error() string {
	return e.err.Error()
}

func (e *errorWithCloseSubscription) CloseSubscription() bool {
	return true
}

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
					Callback: func(ctx core.StreamReceiveEventHookContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error) {
						for _, event := range events {
							evt, ok := event.(*kafka.Event)
							if !ok {
								continue
							}
							evt.Data = []byte(`{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`)
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
					Callback: func(ctx core.StreamReceiveEventHookContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error) {
						if hdr, ok := ctx.Request().Header[http.CanonicalHeaderKey("x-custom-header")]; ok && hdr[0] == "dont-change" {
							return events, nil
						}
						for _, event := range events {
							evt, ok := event.(*kafka.Event)
							if !ok {
								continue
							}
							evt.Data = []byte(`{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`)
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
			client2 := graphql.NewSubscriptionClient(surl)
			client2.WithWebSocketOptions(graphql.WebsocketOptions{
				HTTPHeader: http.Header{
					http.CanonicalHeaderKey("x-custom-header"): []string{"dont-change"},
				},
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
			subscriptionTwoID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
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
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(args.dataValue))
			})

			testenv.AwaitChannelWithT(t, Timeout, subscriptionArgsCh2, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, Timeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")

			require.NoError(t, client2.Close())
			testenv.AwaitChannelWithT(t, Timeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")

			requestLog := xEnv.Observer().FilterMessage("Stream Hook has been run")
			assert.Len(t, requestLog.All(), 1)
		})
	})

	t.Run("Test Batch hook can close subscriptions", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"streamBatchModule": stream_receive.StreamReceiveModule{
					Callback: func(ctx core.StreamReceiveEventHookContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error) {
						return nil, &errorWithCloseSubscription{err: errors.New("test error from streamevents hook")}
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

			xEnv.WaitForSubscriptionCount(0, Timeout)

			testenv.AwaitChannelWithT(t, Timeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "client should have completed when server closed connection")
		})
	})
}
