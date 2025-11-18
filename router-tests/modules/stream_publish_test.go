package module_test

import (
	"encoding/json"
	"errors"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"go.uber.org/zap/zapcore"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/events"
	stream_publish "github.com/wundergraph/cosmo/router-tests/modules/stream-publish"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
)

func TestPublishHook(t *testing.T) {
	t.Parallel()

	t.Run("Test Publish hook can't assert to mutable types", func(t *testing.T) {
		t.Parallel()

		// This test verifies that regular StreamEvents cannot be type-asserted to MutableStreamEvent.
		// By default events are immutable in Cosmo Streams hooks, because it is not garantueed they aren't
		// shared with other goroutines.
		// The only acceptable way to get mutable events is to do a deep copy inside the hook by invoking
		// event.Clone(), which returns a mutable copy of the event. If a type assertion would be successful
		// it means the hook developer would have an event of type MutableEvent, but the deep copy never happened.
		// Note: It's not as important in the OnPublishEvent hook, because events are isolated between hook calls.
		// It's rather important in the OnReceiveEvent hook but both hooks share the same behaviour for consistency reasons
		// and thats why we test it here as well.

		var taPossible atomic.Bool
		taPossible.Store(true)

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"publishModule": stream_publish.PublishModule{
					Callback: func(ctx core.StreamPublishEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
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
				core.WithCustomModules(&stream_publish.PublishModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeMyKafka(employeeID: 3, update: {name: "name test"}) { success } }`,
			})
			require.JSONEq(t, `{"data":{"updateEmployeeMyKafka":{"success":false}}}`, resOne.Body)

			requestLog := xEnv.Observer().FilterMessage("Publish Hook has been run")
			assert.Len(t, requestLog.All(), 1)

			assert.False(t, taPossible.Load(), "invalid type assertion was possible")
		})
	})

	t.Run("Test Publish hook is called", func(t *testing.T) {
		t.Parallel()

		// This test verifies that the publish hook is invoked when a mutation with a Kafka publish is executed.
		// It confirms the hook as been called by checking a log message, which is written by the custom module
		// used in these tests right before the actual hook is being called.

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"publishModule": stream_publish.PublishModule{
					Callback: func(ctx core.StreamPublishEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
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
				core.WithCustomModules(&stream_publish.PublishModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeMyKafka(employeeID: 3, update: {name: "name test"}) { success } }`,
			})
			require.JSONEq(t, `{"data":{"updateEmployeeMyKafka":{"success":false}}}`, resOne.Body)

			requestLog := xEnv.Observer().FilterMessage("Publish Hook has been run")
			assert.Len(t, requestLog.All(), 1)
		})
	})

	t.Run("Test kafka publish error is returned and messages sent", func(t *testing.T) {
		t.Parallel()

		// This test verifies that when the publish hook returns events and an error,
		// the error is properly logged but the messages are still sent to Kafka.
		// It ensures that hook errors don't prevent message delivery if the hook developer
		// wants to do so. If he does not want this he must no return events.

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"publishModule": stream_publish.PublishModule{
					Callback: func(ctx core.StreamPublishEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
						return events, errors.New("test")
					},
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&stream_publish.PublishModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, time.Second, "employeeUpdated")
			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeMyKafka(employeeID: 3, update: {name: "name test"}) { success } }`,
			})
			require.JSONEq(t, `{"data": {"updateEmployeeMyKafka": {"success": false}}}`, resOne.Body)
			require.Equal(t, resOne.Response.StatusCode, 200)

			requestLog := xEnv.Observer().FilterMessage("Publish Hook has been run")
			assert.Len(t, requestLog.All(), 1)

			requestLog2 := xEnv.Observer().FilterMessage("error applying publish event hooks")
			assert.Len(t, requestLog2.All(), 1)

			records, err := events.ReadKafkaMessages(xEnv, time.Second, "employeeUpdated", 1)
			require.NoError(t, err)
			require.Len(t, records, 1)
		})
	})

	t.Run("Test nats publish error is returned and messages sent", func(t *testing.T) {
		t.Parallel()

		// This test verifies that when the publish hook returns an error for NATS events,
		// the error is properly logged but the messages are still sent to NATS.
		// It ensures that hook errors don't prevent message delivery for NATS if the hook developer wants to do so.
		// If he does not want this he must no return events.

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"publishModule": stream_publish.PublishModule{
					Callback: func(ctx core.StreamPublishEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
						return events, errors.New("test")
					},
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&stream_publish.PublishModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			firstSub, err := xEnv.NatsConnectionDefault.SubscribeSync(xEnv.GetPubSubName("employeeUpdatedMyNats.3"))
			require.NoError(t, err)
			t.Cleanup(func() {
				_ = firstSub.Unsubscribe()
			})
			require.NoError(t, xEnv.NatsConnectionDefault.Flush())
			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation UpdateEmployeeNats($update: UpdateEmployeeInput!) {
							updateEmployeeMyNats(id: 3, update: $update) {success}
						}`,
				Variables: json.RawMessage(`{"update":{"name":"Stefan Avramovic","email":"avramovic@wundergraph.com"}}`),
			})
			assert.JSONEq(t, `{"data": {"updateEmployeeMyNats": {"success": false}}}`, resOne.Body)

			requestLog := xEnv.Observer().FilterMessage("Publish Hook has been run")
			assert.Len(t, requestLog.All(), 1)

			requestLog2 := xEnv.Observer().FilterMessage("error applying publish event hooks")
			assert.Len(t, requestLog2.All(), 1)

			msgOne, err := firstSub.NextMsg(5 * time.Second)
			require.NoError(t, err)
			require.Equal(t, xEnv.GetPubSubName("employeeUpdatedMyNats.3"), msgOne.Subject)
			require.Equal(t, `{"id":3,"update":{"name":"Stefan Avramovic","email":"avramovic@wundergraph.com"}}`, string(msgOne.Data))
			require.NoError(t, err)
		})
	})

	t.Run("Test redis publish error is returned and messages sent", func(t *testing.T) {
		t.Parallel()

		// This test verifies that when the publish hook returns an error for Redis events,
		// the error is properly logged but the messages are still sent to Redis (non-blocking behavior).
		// It ensures that hook errors don't prevent message delivery for Redis if the hook developer wants to do so.
		// If he does not want this he must no return events.

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"publishModule": stream_publish.PublishModule{
					Callback: func(ctx core.StreamPublishEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
						return events, errors.New("test")
					},
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedis:              true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&stream_publish.PublishModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			records, err := events.ReadRedisMessages(t, xEnv, "employeeUpdatedMyRedis")
			require.NoError(t, err)

			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeMyRedis(id: 3, update: {name: "name test"}) { success } }`,
			})
			require.JSONEq(t, `{"data": {"updateEmployeeMyRedis": {"success": false}}}`, resOne.Body)

			requestLog := xEnv.Observer().FilterMessage("Publish Hook has been run")
			assert.Len(t, requestLog.All(), 1)

			requestLog2 := xEnv.Observer().FilterMessage("error applying publish event hooks")
			assert.Len(t, requestLog2.All(), 1)

			require.Len(t, records, 1)
		})
	})

	t.Run("Test kafka module publish with argument in header", func(t *testing.T) {
		t.Parallel()

		// This test verifies that the publish hook can modify Kafka events by cloning them,
		// changing the event data, and adding custom headers. It tests the ability to access
		// operation variables and inject them as headers into Kafka messages.
		// The test ensures that concrete event types can be used and their
		// distinct broker features (like headers for Kafka) are accessible for hook developers.

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"publishModule": stream_publish.PublishModule{
					Callback: func(ctx core.StreamPublishEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
						if ctx.PublishEventConfiguration().RootFieldName() != "updateEmployeeMyKafka" {
							return events, nil
						}

						employeeID := ctx.Operation().Variables().GetInt("employeeID")

						newEvents := make([]datasource.StreamEvent, 0, events.Len())
						for _, event := range events.All() {
							newEvt, ok := event.Clone().(*kafka.MutableEvent)
							if !ok {
								continue
							}
							newEvt.SetData([]byte(`{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`))
							if newEvt.Headers == nil {
								newEvt.Headers = map[string][]byte{}
							}
							newEvt.Headers["x-employee-id"] = []byte(strconv.Itoa(employeeID))
							newEvents = append(newEvents, newEvt)
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
				core.WithCustomModules(&stream_publish.PublishModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, time.Second, "employeeUpdated")
			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `mutation UpdateEmployeeKafka($employeeID: Int!) { updateEmployeeMyKafka(employeeID: $employeeID, update: {name: "name test"}) { success } }`,
				Variables: json.RawMessage(`{"employeeID": 3}`),
			})
			require.JSONEq(t, `{"data": {"updateEmployeeMyKafka": {"success": true}}}`, resOne.Body)

			requestLog := xEnv.Observer().FilterMessage("Publish Hook has been run")
			assert.Len(t, requestLog.All(), 1)

			records, err := events.ReadKafkaMessages(xEnv, time.Second, "employeeUpdated", 1)
			require.NoError(t, err)
			require.Len(t, records, 1)
			header := records[0].Headers[0]
			require.Equal(t, "x-employee-id", header.Key)
			require.Equal(t, []byte("3"), header.Value)
		})
	})
}
