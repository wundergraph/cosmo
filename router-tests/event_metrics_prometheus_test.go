package integration

import (
	"github.com/hasura/go-graphql-client"
	"strings"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/events"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"go.opentelemetry.io/otel/sdk/metric"
)

func TestKafkaPublishMetricsPrometheus(t *testing.T) {
	t.Run("verify apache kafka publish recorded", func(t *testing.T) {
		exporter := tracetest.NewInMemoryExporter(t)
		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			TraceExporter:            exporter,
			MetricReader:             metricReader,
			PrometheusRegistry:       promRegistry,
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			MetricOptions: testenv.MetricOptions{
				EnablePrometheusEventMetrics: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.EnsureTopicExists(t, xEnv, "employeeUpdated")

			// First Publish
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeMyKafka(employeeID: 3, update: {name: "name test"}) { success } }`,
			})
			require.JSONEq(t, `{"data":{"updateEmployeeMyKafka":{"success":true}}}`, res.Body)

			// Second Publish
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeMyKafka(employeeID: 3, update: {name: "name test"}) { success } }`,
			})
			require.JSONEq(t, `{"data":{"updateEmployeeMyKafka":{"success":true}}}`, res.Body)

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			family := findMetricFamilyByName(mf, "router_kafka_publish_messages_total")
			require.NotNil(t, family, "expected router_kafka_publish_messages_total metric family")

			metrics := family.GetMetric()
			require.Len(t, metrics, 1)
			require.NotEmpty(t, metrics)

			eventProvider := findMetricLabelByName(metrics, "wg_event_provider_id")
			topic := findMetricLabelByName(metrics, "wg_kafka_topic")

			require.Equal(t, "my-kafka", eventProvider.GetValue())
			require.True(t, strings.HasSuffix(topic.GetValue(), "employeeUpdated"))

			require.Equal(t, float64(2), metrics[0].Counter.GetValue())
		})
	})

	t.Run("verify apache kafka subscription received recorded", func(t *testing.T) {
		exporter := tracetest.NewInMemoryExporter(t)
		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		topic := "employeeUpdated"

		testenv.Run(t, &testenv.Config{
			TraceExporter:            exporter,
			MetricReader:             metricReader,
			PrometheusRegistry:       promRegistry,
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			MetricOptions: testenv.MetricOptions{
				EnablePrometheusEventMetrics: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.EnsureTopicExists(t, xEnv, "employeeUpdated")

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

			xEnv.WaitForSubscriptionCount(1, KafkaWaitTimeout)

			events.ProduceKafkaMessage(t, xEnv, topic, `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`)

			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))

				mf, err := promRegistry.Gather()
				require.NoError(t, err)

				family := findMetricFamilyByName(mf, "router_kafka_messages_received_total")
				require.NotNil(t, family)

				metrics := family.GetMetric()
				require.Len(t, metrics, 1)
				require.NotEmpty(t, metrics)

				eventProvider := findMetricLabelByName(metrics, "wg_event_provider_id")
				topic := findMetricLabelByName(metrics, "wg_kafka_topic")

				require.Equal(t, "my-kafka", eventProvider.GetValue())
				require.True(t, strings.HasSuffix(topic.GetValue(), "employeeUpdated"))

				require.Equal(t, float64(1), metrics[0].Counter.GetValue())
			})

			testenv.AwaitChannelWithT(t, KafkaWaitTimeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")
		})
	})
}

type kafkaSubscriptionArgs struct {
	dataValue []byte
	errValue  error
}

const KafkaWaitTimeout = time.Second * 30
