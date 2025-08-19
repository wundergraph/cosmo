package integration

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/hasura/go-graphql-client"
	"github.com/nats-io/nats.go"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/events"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.opentelemetry.io/otel/sdk/metric"
)

type subscriptionArgs struct {
	dataValue []byte
	errValue  error
}

const WaitTimeout = time.Second * 30

func TestFlakyEventMetrics(t *testing.T) {
	t.Parallel()

	t.Run("kafka", func(t *testing.T) {
		t.Parallel()

		t.Run("publish", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			promRegistry := prometheus.NewRegistry()

			testenv.Run(t, &testenv.Config{
				MetricReader:             metricReader,
				PrometheusRegistry:       promRegistry,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
				EnableKafka:              true,
				MetricOptions: testenv.MetricOptions{
					EnablePrometheusStreamMetrics: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				events.EnsureTopicExists(t, xEnv, "employeeUpdated")
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation { updateEmployeeMyKafka(employeeID: 3, update: {name: "name test"}) { success } }`})
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation { updateEmployeeMyKafka(employeeID: 3, update: {name: "name test"}) { success } }`})

				mf, err := promRegistry.Gather()
				require.NoError(t, err)

				family := findMetricFamilyByName(mf, "router_streams_sent_messages_total")
				metrics := family.GetMetric()
				require.Len(t, metrics, 1)

				operation := findMetricLabelByName(metrics, "wg_stream_operation_name")
				require.Equal(t, "produce", operation.GetValue())

				errLabel := findMetricLabelByName(metrics, "wg_error_type")
				require.Nil(t, errLabel)

				system := findMetricLabelByName(metrics, "wg_provider_type")
				require.Equal(t, "kafka", system.GetValue())

				destination := findMetricLabelByName(metrics, "wg_destination_name")
				require.True(t, strings.HasSuffix(destination.GetValue(), "employeeUpdated"))

				provider := findMetricLabelByName(metrics, "wg_provider_id")
				require.NotNil(t, provider)
				require.Equal(t, "my-kafka", provider.GetValue())

				require.Equal(t, float64(2), metrics[0].Counter.GetValue())
			})
		})

		t.Run("subscribe", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			promRegistry := prometheus.NewRegistry()
			topic := "employeeUpdated"

			testenv.Run(t, &testenv.Config{
				MetricReader:             metricReader,
				PrometheusRegistry:       promRegistry,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
				EnableKafka:              true,
				MetricOptions: testenv.MetricOptions{
					EnablePrometheusStreamMetrics: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				events.EnsureTopicExists(t, xEnv, topic)

				var subscriptionOne struct {
					employeeUpdatedMyKafka struct {
						ID      float64 `graphql:"id"`
						Details struct {
							Forename string `graphql:"forename"`
							Surname  string `graphql:"surname"`
						} `graphql:"details"`
					} `graphql:"employeeUpdatedMyKafka(employeeID: 3)"`
				}

				client := graphql.NewSubscriptionClient(xEnv.GraphQLWebSocketSubscriptionURL())
				subscriptionArgsCh := make(chan subscriptionArgs)
				subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
					subscriptionArgsCh <- subscriptionArgs{dataValue: dataValue, errValue: errValue}
					return nil
				})
				require.NoError(t, err)
				require.NotEmpty(t, subscriptionOneID)
				clientRunCh := make(chan error)
				go func() { clientRunCh <- client.Run() }()
				xEnv.WaitForSubscriptionCount(1, WaitTimeout)

				events.ProduceKafkaMessage(t, xEnv, topic, `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

				testenv.AwaitChannelWithT(t, WaitTimeout, subscriptionArgsCh, func(t *testing.T, args subscriptionArgs) {
					require.NoError(t, args.errValue)
					require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))

					mf, err := promRegistry.Gather()
					require.NoError(t, err)

					family := findMetricFamilyByName(mf, "router_streams_received_messages_total")
					metrics := family.GetMetric()
					require.Len(t, metrics, 1)

					operation := findMetricLabelByName(metrics, "wg_stream_operation_name")
					require.Equal(t, "receive", operation.GetValue())

					errLabel := findMetricLabelByName(metrics, "wg_error_type")
					require.Nil(t, errLabel)

					system := findMetricLabelByName(metrics, "wg_provider_type")
					require.Equal(t, "kafka", system.GetValue())

					destination := findMetricLabelByName(metrics, "wg_destination_name")
					require.True(t, strings.HasSuffix(destination.GetValue(), "employeeUpdated"))

					provider := findMetricLabelByName(metrics, "wg_provider_id")
					require.NotNil(t, provider)
					require.Equal(t, "my-kafka", provider.GetValue())

					require.Equal(t, float64(1), metrics[0].Counter.GetValue())
				})

				require.NoError(t, client.Close())
				testenv.AwaitChannelWithT(t, WaitTimeout, clientRunCh, func(t *testing.T, err error) { require.NoError(t, err) })
			})
		})
	})

	t.Run("nats", func(t *testing.T) {
		t.Parallel()

		t.Run("publish", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			promRegistry := prometheus.NewRegistry()
			testenv.Run(t, &testenv.Config{
				MetricReader:             metricReader,
				PrometheusRegistry:       promRegistry,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				EnableNats:               true,
				MetricOptions: testenv.MetricOptions{
					EnablePrometheusStreamMetrics: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation UpdateEmployeeNats($update: UpdateEmployeeInput!) {
					updateEmployeeMyNats(id: 12, update: $update) {success}
				}`, Variables: json.RawMessage(`{"update":{"name":"n1"}}`)})
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation UpdateEmployeeNats($update: UpdateEmployeeInput!) {
					updateEmployeeMyNats(id: 12, update: $update) {success}
				}`, Variables: json.RawMessage(`{"update":{"name":"n2"}}`)})

				mf, err := promRegistry.Gather()
				require.NoError(t, err)

				family := findMetricFamilyByName(mf, "router_streams_sent_messages_total")
				metrics := family.GetMetric()
				require.Len(t, metrics, 1)

				operation := findMetricLabelByName(metrics, "wg_stream_operation_name")
				require.Equal(t, "publish", operation.GetValue())

				errLabel := findMetricLabelByName(metrics, "wg_error_type")
				require.Nil(t, errLabel)

				system := findMetricLabelByName(metrics, "wg_provider_type")
				require.Equal(t, "nats", system.GetValue())

				destination := findMetricLabelByName(metrics, "wg_destination_name")
				require.True(t, strings.HasSuffix(destination.GetValue(), "employeeUpdatedMyNats.12"))

				provider := findMetricLabelByName(metrics, "wg_provider_id")
				require.NotNil(t, provider)
				require.Equal(t, "my-nats", provider.GetValue())

				require.Equal(t, float64(2), metrics[0].Counter.GetValue())
			})
		})

		t.Run("request", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			promRegistry := prometheus.NewRegistry()
			testenv.Run(t, &testenv.Config{
				MetricReader:             metricReader,
				PrometheusRegistry:       promRegistry,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				EnableNats:               true,
				MetricOptions: testenv.MetricOptions{
					EnablePrometheusStreamMetrics: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				sub, err := xEnv.NatsConnectionMyNats.Subscribe(xEnv.GetPubSubName("getEmployeeMyNats.12"), func(msg *nats.Msg) { _ = msg.Respond([]byte(`{"id": 12, "__typename": "Employee"}`)) })
				require.NoError(t, err)
				require.NoError(t, xEnv.NatsConnectionMyNats.Flush())
				t.Cleanup(func() { _ = sub.Unsubscribe() })

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employeeFromEventMyNats(employeeID: 12) { id details { forename } }}`})
				require.JSONEq(t, `{"data":{"employeeFromEventMyNats": {"id": 12, "details": {"forename": "David"}}}}`, res.Body)

				mf, err := promRegistry.Gather()
				require.NoError(t, err)

				family := findMetricFamilyByName(mf, "router_streams_sent_messages_total")
				metrics := family.GetMetric()
				require.Len(t, metrics, 1)

				operation := findMetricLabelByName(metrics, "wg_stream_operation_name")
				require.Equal(t, "request", operation.GetValue())

				errLabel := findMetricLabelByName(metrics, "wg_error_type")
				require.Nil(t, errLabel)

				system := findMetricLabelByName(metrics, "wg_provider_type")
				require.Equal(t, "nats", system.GetValue())

				destination := findMetricLabelByName(metrics, "wg_destination_name")
				require.True(t, strings.HasSuffix(destination.GetValue(), "getEmployeeMyNats.12"))

				provider := findMetricLabelByName(metrics, "wg_provider_id")
				require.NotNil(t, provider)
				require.Equal(t, "my-nats", provider.GetValue())

				require.Equal(t, float64(1), metrics[0].Counter.GetValue())
			})
		})

		t.Run("subscribe", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			promRegistry := prometheus.NewRegistry()
			testenv.Run(t, &testenv.Config{
				MetricReader:                       metricReader,
				PrometheusRegistry:                 promRegistry,
				RouterConfigJSONTemplate:           testenv.ConfigWithEdfsNatsJSONTemplate,
				EnableNats:                         true,
				ModifyEngineExecutionConfiguration: func(ec *config.EngineExecutionConfiguration) { ec.WebSocketClientReadTimeout = time.Second },
				MetricOptions:                      testenv.MetricOptions{EnablePrometheusStreamMetrics: true},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				var subscriptionOne struct {
					employeeUpdated struct {
						ID      float64 `graphql:"id"`
						Details struct {
							Forename string `graphql:"forename"`
							Surname  string `graphql:"surname"`
						} `graphql:"details"`
					} `graphql:"employeeUpdated(employeeID: 3)"`
				}

				client := graphql.NewSubscriptionClient(xEnv.GraphQLWebSocketSubscriptionURL())

				subscriptionArgsCh := make(chan subscriptionArgs)
				subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
					subscriptionArgsCh <- subscriptionArgs{
						dataValue: dataValue,
						errValue:  errValue,
					}
					return nil
				})
				require.NoError(t, err)
				require.NotEmpty(t, subscriptionOneID)

				clientRunErrCh := make(chan error)
				go func() {
					clientRunErrCh <- client.Run()
				}()

				xEnv.WaitForSubscriptionCount(1, WaitTimeout)

				err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename":"Employee"}`))
				require.NoError(t, err)

				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)

				testenv.AwaitChannelWithT(t, WaitTimeout, subscriptionArgsCh, func(t *testing.T, args subscriptionArgs) {
					require.NoError(t, args.errValue)
					require.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(args.dataValue))

					mf, err := promRegistry.Gather()
					require.NoError(t, err)

					family := findMetricFamilyByName(mf, "router_streams_received_messages_total")
					metrics := family.GetMetric()

					errLabel := findMetricLabelByName(metrics, "wg_error_type")
					require.Nil(t, errLabel)

					operation := findMetricLabelByName(metrics, "wg_stream_operation_name")
					require.Equal(t, "receive", operation.GetValue())

					system := findMetricLabelByName(metrics, "wg_provider_type")
					require.Equal(t, "nats", system.GetValue())

					destination := findMetricLabelByName(metrics, "wg_destination_name")
					require.True(t, strings.HasSuffix(destination.GetValue(), "employeeUpdated.3"))

					provider := findMetricLabelByName(metrics, "wg_provider_id")
					require.NotNil(t, provider)
					require.Equal(t, "default", provider.GetValue())

					require.Equal(t, float64(1), metrics[0].Counter.GetValue())
				})

				require.NoError(t, client.Close())
				testenv.AwaitChannelWithT(t, WaitTimeout, clientRunErrCh, func(t *testing.T, err error) {
					require.NoError(t, err)
				}, "unable to close client before timeout")

				xEnv.WaitForSubscriptionCount(0, WaitTimeout)
				xEnv.WaitForConnectionCount(0, WaitTimeout)
			})
		})
	})

	t.Run("redis", func(t *testing.T) {
		t.Parallel()

		t.Run("publish", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			promRegistry := prometheus.NewRegistry()

			testenv.Run(t, &testenv.Config{
				MetricReader:             metricReader,
				PrometheusRegistry:       promRegistry,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
				EnableRedis:              true,
				MetricOptions: testenv.MetricOptions{
					EnablePrometheusStreamMetrics: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation { updateEmployeeMyRedis(id: 3, update: {name: "r1"}) { success } }`})
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation { updateEmployeeMyRedis(id: 3, update: {name: "r2"}) { success } }`})

				mf, err := promRegistry.Gather()
				require.NoError(t, err)

				family := findMetricFamilyByName(mf, "router_streams_sent_messages_total")
				metrics := family.GetMetric()
				require.Len(t, metrics, 1)

				operation := findMetricLabelByName(metrics, "wg_stream_operation_name")
				require.Equal(t, "publish", operation.GetValue())

				errLabel := findMetricLabelByName(metrics, "wg_error_type")
				require.Nil(t, errLabel)

				system := findMetricLabelByName(metrics, "wg_provider_type")
				require.Equal(t, "redis", system.GetValue())

				destination := findMetricLabelByName(metrics, "wg_destination_name")
				require.True(t, strings.HasSuffix(destination.GetValue(), "employeeUpdatedMyRedis"))

				provider := findMetricLabelByName(metrics, "wg_provider_id")
				require.NotNil(t, provider)
				require.Equal(t, "my-redis", provider.GetValue())

				require.Equal(t, float64(2), metrics[0].Counter.GetValue())
			})
		})

		t.Run("subscribe", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			promRegistry := prometheus.NewRegistry()

			testenv.Run(t, &testenv.Config{
				MetricReader:             metricReader,
				PrometheusRegistry:       promRegistry,
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
				EnableRedis:              true,
				MetricOptions:            testenv.MetricOptions{EnablePrometheusStreamMetrics: true},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				topic := "employeeUpdatedMyRedis"

				var subscriptionOne struct {
					employeeUpdates struct {
						ID      float64 `graphql:"id"`
						Details struct {
							Forename string `graphql:"forename"`
							Surname  string `graphql:"surname"`
						} `graphql:"details"`
					} `graphql:"employeeUpdates"`
				}

				client := graphql.NewSubscriptionClient(xEnv.GraphQLWebSocketSubscriptionURL())

				subscriptionArgsCh := make(chan subscriptionArgs)
				subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
					subscriptionArgsCh <- subscriptionArgs{dataValue, errValue}
					return nil
				})
				require.NoError(t, err)
				require.NotEmpty(t, subscriptionOneID)

				runCh := make(chan error)
				go func() { runCh <- client.Run() }()

				xEnv.WaitForSubscriptionCount(1, WaitTimeout)
				events.ProduceRedisMessage(t, xEnv, topic, `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

				testenv.AwaitChannelWithT(t, WaitTimeout, subscriptionArgsCh, func(t *testing.T, args subscriptionArgs) {
					require.NoError(t, args.errValue)
					require.JSONEq(t, `{"employeeUpdates":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))

					mf, err := promRegistry.Gather()
					require.NoError(t, err)

					family := findMetricFamilyByName(mf, "router_streams_received_messages_total")
					metrics := family.GetMetric()
					require.Len(t, metrics, 1)

					errLabel := findMetricLabelByName(metrics, "wg_error_type")
					require.Nil(t, errLabel)

					operation := findMetricLabelByName(metrics, "wg_stream_operation_name")
					require.Equal(t, "receive", operation.GetValue())

					system := findMetricLabelByName(metrics, "wg_provider_type")
					require.Equal(t, "redis", system.GetValue())

					destination := findMetricLabelByName(metrics, "wg_destination_name")
					require.True(t, strings.HasSuffix(destination.GetValue(), "employeeUpdatedMyRedis"))

					provider := findMetricLabelByName(metrics, "wg_provider_id")
					require.NotNil(t, provider)
					require.Equal(t, "my-redis", provider.GetValue())
					require.Equal(t, float64(1), metrics[0].Counter.GetValue())
				})

				require.NoError(t, client.Close())
				testenv.AwaitChannelWithT(t, WaitTimeout, runCh, func(t *testing.T, err error) { require.NoError(t, err) })
			})
		})
	})
}
