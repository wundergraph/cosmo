package integration

import (
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/require"
	events_test "github.com/wundergraph/cosmo/router-tests/events"
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
			events_test.EnsureTopicExists(t, xEnv, "employeeUpdated")

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
}
