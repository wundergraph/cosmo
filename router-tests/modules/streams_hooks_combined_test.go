package module

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/hasura/go-graphql-client"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/events"
	stream_publish "github.com/wundergraph/cosmo/router-tests/modules/stream-publish"
	stream_receive "github.com/wundergraph/cosmo/router-tests/modules/stream-receive"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
	"go.uber.org/zap/zapcore"
)

func TestStreamsHooksCombined(t *testing.T) {
	t.Parallel()

	t.Run("Test kafka modules can depend on each other", func(t *testing.T) {
		t.Parallel()

		type event struct {
			data []byte
			err  error
		}

		const Timeout = time.Second * 10

		cfg := config.Config{
			Graph: config.Graph{},
			Events: config.EventsConfiguration{
				SubscriptionHooks: config.SubscriptionHooksConfiguration{
					MaxConcurrentEventReceiveHandlers: 100,
				},
			},
			Modules: map[string]interface{}{
				"streamReceiveModule": stream_receive.StreamReceiveModule{
					Callback: func(ctx core.StreamReceiveEventHandlerContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error) {
						for _, event := range events {
							evt, ok := event.(*kafka.Event)
							if !ok {
								continue
							}

							if string(evt.Headers["x-publishModule"]) == "i_was_here" {
								evt.Data = []byte(`{"__typename":"Employee","id": 2,"update":{"name":"irrelevant"}}`)
							}
						}

						return events, nil
					},
				},
				"publishModule": stream_publish.PublishModule{
					Callback: func(ctx core.StreamPublishEventHandlerContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error) {
						if ctx.PublishEventConfiguration().RootFieldName() != "updateEmployeeMyKafka" {
							return events, nil
						}

						for _, event := range events {
							evt, ok := event.(*kafka.Event)
							if !ok {
								continue
							}
							evt.Headers["x-publishModule"] = []byte("i_was_here")
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
				core.WithCustomModules(&stream_publish.PublishModule{}, &stream_receive.StreamReceiveModule{}),
				core.WithSubscriptionHooks(cfg.Events.SubscriptionHooks),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			topics := []string{"employeeUpdated"}
			events.KafkaEnsureTopicExists(t, xEnv, time.Second, topics...)

			// start a subscriber
			var subscriptionPayload struct {
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

			subscriptionEventsChan := make(chan event)
			subscriptionID, err := client.Subscribe(&subscriptionPayload, nil, func(dataValue []byte, errValue error) error {
				subscriptionEventsChan <- event{
					data: dataValue,
					err:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionID)

			clientRunChan := make(chan error)
			go func() {
				clientRunChan <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, Timeout)

			// publish a message to broker via mutation
			// and let publish hook modify the message
			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `mutation UpdateEmployeeKafka($employeeID: Int!) { updateEmployeeMyKafka(employeeID: $employeeID, update: {name: "name test"}) { success } }`,
				Variables: json.RawMessage(`{"employeeID": 3}`),
			})
			require.JSONEq(t, `{"data": {"updateEmployeeMyKafka": {"success": true}}}`, resOne.Body)

			requestLog := xEnv.Observer().FilterMessage("Publish Hook has been run")
			assert.Len(t, requestLog.All(), 1)

			// wait for the message to be received by the subscriber
			testenv.AwaitChannelWithT(t, Timeout, subscriptionEventsChan, func(t *testing.T, args event) {
				require.NoError(t, args.err)
				// verify that the stream batch hook modified the message,
				// which it only does if the publish hook was run before it
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":2,"details":{"forename":"Dustin","surname":"Deus"}}}`, string(args.data))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, Timeout, clientRunChan, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")

			requestLog = xEnv.Observer().FilterMessage("Stream Hook has been run")
			assert.Len(t, requestLog.All(), 1)
		})
	})
}
