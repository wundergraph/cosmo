package module_test

import (
	"encoding/json"
	"net/http"
	"strconv"
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

	t.Run("Test Publish hook is called", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"publishModule": stream_publish.PublishModule{},
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

	t.Run("Test Publish kafka hook allows to set headers", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"publishModule": stream_publish.PublishModule{
					Callback: func(ctx core.StreamPublishEventHandlerContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error) {
						for _, event := range events {
							evt, ok := event.(*kafka.Event)
							if !ok {
								continue
							}
							evt.Headers["x-test"] = []byte("test")
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
			events.KafkaEnsureTopicExists(t, xEnv, time.Second, "employeeUpdated")
			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeMyKafka(employeeID: 3, update: {name: "name test"}) { success } }`,
			})
			require.JSONEq(t, `{"data":{"updateEmployeeMyKafka":{"success":true}}}`, resOne.Body)

			requestLog := xEnv.Observer().FilterMessage("Publish Hook has been run")
			assert.Len(t, requestLog.All(), 1)

			records, err := events.ReadKafkaMessages(xEnv, time.Second, "employeeUpdated", 1)
			require.NoError(t, err)
			require.Len(t, records, 1)
			header := records[0].Headers[0]
			require.Equal(t, "x-test", header.Key)
			require.Equal(t, []byte("test"), header.Value)
		})
	})

	t.Run("Test kafka publish error is returned and messages sent", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"publishModule": stream_publish.PublishModule{
					Callback: func(ctx core.StreamPublishEventHandlerContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error) {
						return events, core.NewHttpGraphqlError("test", http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
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

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"publishModule": stream_publish.PublishModule{
					Callback: func(ctx core.StreamPublishEventHandlerContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error) {
						return events, core.NewHttpGraphqlError("test", http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
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

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"publishModule": stream_publish.PublishModule{
					Callback: func(ctx core.StreamPublishEventHandlerContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error) {
						return events, core.NewHttpGraphqlError("test", http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
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

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"publishModule": stream_publish.PublishModule{
					Callback: func(ctx core.StreamPublishEventHandlerContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error) {
						if ctx.PublishEventConfiguration().RootFieldName() != "updateEmployeeMyKafka" {
							return events, nil
						}

						employeeID := ctx.Operation().Variables().GetInt("employeeID")

						newEvents := []datasource.StreamEvent{}
						for _, event := range events {
							evt, ok := event.(*kafka.Event)
							if !ok {
								continue
							}
							if evt.Headers == nil {
								evt.Headers = map[string][]byte{}
							}
							evt.Headers["x-employee-id"] = []byte(strconv.Itoa(employeeID))
							newEvents = append(newEvents, event)
						}
						return newEvents, nil
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
