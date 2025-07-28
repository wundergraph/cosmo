package module_test

import (
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
					Callback: func(ctx core.StreamPublishEventHookContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error) {
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
			events.EnsureTopicExists(t, xEnv, time.Second, "employeeUpdated")
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
}
