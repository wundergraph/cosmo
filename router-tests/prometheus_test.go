package integration

import (
	"github.com/prometheus/client_golang/prometheus"
	io_prometheus_client "github.com/prometheus/client_model/go"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"go.opentelemetry.io/otel/sdk/metric"
	"testing"
)

func TestPrometheus(t *testing.T) {
	t.Parallel()

	t.Run("Collect and export OTEL metrics to Prometheus from named operation", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			TraceExporter:      exporter,
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			require.Equal(t, 35, len(mf))

			requestTotal := findMetricByName(mf, "router_http_requests_total")
			requestTotalMetrics := requestTotal.GetMetric()

			require.Len(t, requestTotalMetrics, 2)
			require.Len(t, requestTotalMetrics[0].Label, 12)
			require.Len(t, requestTotalMetrics[1].Label, 13)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("http_status_code"),
					Value: PointerOf("200"),
				},
				{
					Name:  PointerOf("otel_scope_name"),
					Value: PointerOf("cosmo.router.prometheus"),
				},
				{
					Name:  PointerOf("otel_scope_version"),
					Value: PointerOf("0.0.1"),
				},
				{
					Name:  PointerOf("wg_client_name"),
					Value: PointerOf("unknown"),
				},
				{
					Name:  PointerOf("wg_client_version"),
					Value: PointerOf("missing"),
				},
				{
					Name:  PointerOf("wg_federated_graph_id"),
					Value: PointerOf("graph"),
				},
				{
					Name:  PointerOf("wg_operation_name"),
					Value: PointerOf("myQuery"),
				},
				{
					Name:  PointerOf("wg_operation_protocol"),
					Value: PointerOf("http"),
				},
				{
					Name:  PointerOf("wg_operation_type"),
					Value: PointerOf("query"),
				},
				{
					Name:  PointerOf("wg_router_cluster_name"),
					Value: PointerOf(""),
				},
				{
					Name:  PointerOf("wg_router_config_version"),
					Value: PointerOf(""),
				},
				{
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
			}, requestTotalMetrics[0].Label)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("otel_scope_name"),
					Value: PointerOf("cosmo.router.prometheus"),
				},
				{
					Name:  PointerOf("otel_scope_version"),
					Value: PointerOf("0.0.1"),
				},
				{
					Name:  PointerOf("wg_client_name"),
					Value: PointerOf("unknown"),
				},
				{
					Name:  PointerOf("wg_client_version"),
					Value: PointerOf("missing"),
				},
				{
					Name:  PointerOf("wg_federated_graph_id"),
					Value: PointerOf("graph"),
				},
				{
					Name:  PointerOf("wg_operation_name"),
					Value: PointerOf("myQuery"),
				},
				{
					Name:  PointerOf("wg_operation_protocol"),
					Value: PointerOf("http"),
				},
				{
					Name:  PointerOf("wg_operation_type"),
					Value: PointerOf("query"),
				},
				{
					Name:  PointerOf("wg_router_cluster_name"),
					Value: PointerOf(""),
				},
				{
					Name:  PointerOf("wg_router_config_version"),
					Value: PointerOf(""),
				},
				{
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
				{
					Name:  PointerOf("wg_subgraph_id"),
					Value: PointerOf("0"),
				},
				{
					Name:  PointerOf("wg_subgraph_name"),
					Value: PointerOf("employees"),
				},
			}, requestTotalMetrics[1].Label)

			requestsInFlight := findMetricByName(mf, "router_http_requests_in_flight_count")
			requestsInFlightMetrics := requestsInFlight.GetMetric()

			require.Len(t, requestsInFlightMetrics, 2)
			require.Len(t, requestsInFlightMetrics[0].Label, 6)
			require.Len(t, requestsInFlightMetrics[1].Label, 13)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("otel_scope_name"),
					Value: PointerOf("cosmo.router.prometheus"),
				},
				{
					Name:  PointerOf("otel_scope_version"),
					Value: PointerOf("0.0.1"),
				},
				{
					Name:  PointerOf("wg_federated_graph_id"),
					Value: PointerOf("graph"),
				},
				{
					Name:  PointerOf("wg_router_cluster_name"),
					Value: PointerOf(""),
				},
				{
					Name:  PointerOf("wg_router_config_version"),
					Value: PointerOf(""),
				},
				{
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
			}, requestsInFlightMetrics[0].Label)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("otel_scope_name"),
					Value: PointerOf("cosmo.router.prometheus"),
				},
				{
					Name:  PointerOf("otel_scope_version"),
					Value: PointerOf("0.0.1"),
				},
				{
					Name:  PointerOf("wg_client_name"),
					Value: PointerOf("unknown"),
				},
				{
					Name:  PointerOf("wg_client_version"),
					Value: PointerOf("missing"),
				},
				{
					Name:  PointerOf("wg_federated_graph_id"),
					Value: PointerOf("graph"),
				},
				{
					Name:  PointerOf("wg_operation_name"),
					Value: PointerOf("myQuery"),
				},
				{
					Name:  PointerOf("wg_operation_protocol"),
					Value: PointerOf("http"),
				},
				{
					Name:  PointerOf("wg_operation_type"),
					Value: PointerOf("query"),
				},
				{
					Name:  PointerOf("wg_router_cluster_name"),
					Value: PointerOf(""),
				},
				{
					Name:  PointerOf("wg_router_config_version"),
					Value: PointerOf(""),
				},
				{
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
				{
					Name:  PointerOf("wg_subgraph_id"),
					Value: PointerOf("0"),
				},
				{
					Name:  PointerOf("wg_subgraph_name"),
					Value: PointerOf("employees"),
				},
			}, requestsInFlightMetrics[1].Label)

			requestDuration := findMetricByName(mf, "router_http_request_duration_milliseconds")
			requestDurationMetrics := requestDuration.GetMetric()

			require.Len(t, requestDurationMetrics, 2)
			require.Len(t, requestDurationMetrics[0].Label, 12)
			require.Len(t, requestDurationMetrics[1].Label, 13)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("http_status_code"),
					Value: PointerOf("200"),
				},
				{
					Name:  PointerOf("otel_scope_name"),
					Value: PointerOf("cosmo.router.prometheus"),
				},
				{
					Name:  PointerOf("otel_scope_version"),
					Value: PointerOf("0.0.1"),
				},
				{
					Name:  PointerOf("wg_client_name"),
					Value: PointerOf("unknown"),
				},
				{
					Name:  PointerOf("wg_client_version"),
					Value: PointerOf("missing"),
				},
				{
					Name:  PointerOf("wg_federated_graph_id"),
					Value: PointerOf("graph"),
				},
				{
					Name:  PointerOf("wg_operation_name"),
					Value: PointerOf("myQuery"),
				},
				{
					Name:  PointerOf("wg_operation_protocol"),
					Value: PointerOf("http"),
				},
				{
					Name:  PointerOf("wg_operation_type"),
					Value: PointerOf("query"),
				},
				{
					Name:  PointerOf("wg_router_cluster_name"),
					Value: PointerOf(""),
				},
				{
					Name:  PointerOf("wg_router_config_version"),
					Value: PointerOf(""),
				},
				{
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
			}, requestDurationMetrics[0].Label)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("otel_scope_name"),
					Value: PointerOf("cosmo.router.prometheus"),
				},
				{
					Name:  PointerOf("otel_scope_version"),
					Value: PointerOf("0.0.1"),
				},
				{
					Name:  PointerOf("wg_client_name"),
					Value: PointerOf("unknown"),
				},
				{
					Name:  PointerOf("wg_client_version"),
					Value: PointerOf("missing"),
				},
				{
					Name:  PointerOf("wg_federated_graph_id"),
					Value: PointerOf("graph"),
				},
				{
					Name:  PointerOf("wg_operation_name"),
					Value: PointerOf("myQuery"),
				},
				{
					Name:  PointerOf("wg_operation_protocol"),
					Value: PointerOf("http"),
				},
				{
					Name:  PointerOf("wg_operation_type"),
					Value: PointerOf("query"),
				},
				{
					Name:  PointerOf("wg_router_cluster_name"),
					Value: PointerOf(""),
				},
				{
					Name:  PointerOf("wg_router_config_version"),
					Value: PointerOf(""),
				},
				{
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
				{
					Name:  PointerOf("wg_subgraph_id"),
					Value: PointerOf("0"),
				},
				{
					Name:  PointerOf("wg_subgraph_name"),
					Value: PointerOf("employees"),
				},
			}, requestDurationMetrics[1].Label)

			responseContentLength := findMetricByName(mf, "router_http_response_content_length_total")
			responseContentLengthMetrics := responseContentLength.GetMetric()

			require.Len(t, responseContentLengthMetrics, 2)
			require.Len(t, responseContentLengthMetrics[0].Label, 12)
			require.Len(t, responseContentLengthMetrics[1].Label, 14)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("http_status_code"),
					Value: PointerOf("200"),
				},
				{
					Name:  PointerOf("otel_scope_name"),
					Value: PointerOf("cosmo.router.prometheus"),
				},
				{
					Name:  PointerOf("otel_scope_version"),
					Value: PointerOf("0.0.1"),
				},
				{
					Name:  PointerOf("wg_client_name"),
					Value: PointerOf("unknown"),
				},
				{
					Name:  PointerOf("wg_client_version"),
					Value: PointerOf("missing"),
				},
				{
					Name:  PointerOf("wg_federated_graph_id"),
					Value: PointerOf("graph"),
				},
				{
					Name:  PointerOf("wg_operation_name"),
					Value: PointerOf("myQuery"),
				},
				{
					Name:  PointerOf("wg_operation_protocol"),
					Value: PointerOf("http"),
				},
				{
					Name:  PointerOf("wg_operation_type"),
					Value: PointerOf("query"),
				},
				{
					Name:  PointerOf("wg_router_cluster_name"),
					Value: PointerOf(""),
				},
				{
					Name:  PointerOf("wg_router_config_version"),
					Value: PointerOf(""),
				},
				{
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
			}, responseContentLengthMetrics[0].Label)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("http_status_code"),
					Value: PointerOf("200"),
				},
				{
					Name:  PointerOf("otel_scope_name"),
					Value: PointerOf("cosmo.router.prometheus"),
				},
				{
					Name:  PointerOf("otel_scope_version"),
					Value: PointerOf("0.0.1"),
				},
				{
					Name:  PointerOf("wg_client_name"),
					Value: PointerOf("unknown"),
				},
				{
					Name:  PointerOf("wg_client_version"),
					Value: PointerOf("missing"),
				},
				{
					Name:  PointerOf("wg_federated_graph_id"),
					Value: PointerOf("graph"),
				},
				{
					Name:  PointerOf("wg_operation_name"),
					Value: PointerOf("myQuery"),
				},
				{
					Name:  PointerOf("wg_operation_protocol"),
					Value: PointerOf("http"),
				},
				{
					Name:  PointerOf("wg_operation_type"),
					Value: PointerOf("query"),
				},
				{
					Name:  PointerOf("wg_router_cluster_name"),
					Value: PointerOf(""),
				},
				{
					Name:  PointerOf("wg_router_config_version"),
					Value: PointerOf(""),
				},
				{
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
				{
					Name:  PointerOf("wg_subgraph_id"),
					Value: PointerOf("0"),
				},
				{
					Name:  PointerOf("wg_subgraph_name"),
					Value: PointerOf("employees"),
				},
			}, responseContentLengthMetrics[1].Label)

		})
	})
}

func findMetricByName(mf []*io_prometheus_client.MetricFamily, name string) *io_prometheus_client.MetricFamily {
	for _, m := range mf {
		if m.GetName() == name {
			return m
		}
	}
	return nil
}

func PointerOf[T any](t T) *T {
	return &t
}
