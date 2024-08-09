package integration

import (
	"net/http"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	io_prometheus_client "github.com/prometheus/client_model/go"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"go.opentelemetry.io/otel/sdk/metric"
)

func TestPrometheus(t *testing.T) {
	t.Parallel()

	const employeesIDData = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`

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

			requestTotal := findMetricFamilyByName(mf, "router_http_requests_total")
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
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

			requestsInFlight := findMetricFamilyByName(mf, "router_http_requests_in_flight")
			requestsInFlightMetrics := requestsInFlight.GetMetric()

			require.Len(t, requestsInFlightMetrics, 2)
			require.Len(t, requestsInFlightMetrics[0].Label, 9)
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
					Name:  PointerOf("wg_operation_protocol"),
					Value: PointerOf("http"),
				},
				{
					Name:  PointerOf("wg_router_cluster_name"),
					Value: PointerOf(""),
				},
				{
					Name:  PointerOf("wg_router_config_version"),
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
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

			requestDuration := findMetricFamilyByName(mf, "router_http_request_duration_milliseconds")
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
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

			responseContentLength := findMetricFamilyByName(mf, "router_http_response_content_length_total")
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
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

	t.Run("Collect and export OTEL metrics in respect to custom attributes / from header", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			TraceExporter:      exporter,
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			OtelResourceAttributes: []config.OtelResourceAttribute{
				{
					Key:   "custom.resource",
					Value: "value",
				},
			},
			OtelAttributes: []config.OtelAttribute{
				{
					Key:     "custom",
					Default: "value_different",
					ValueFrom: &config.OtelAttributeFromValue{
						RequestHeader: "x-custom-header",
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: map[string][]string{
					"x-custom-header": {"value"},
				},
				Query: `query myQuery { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			targetInfo := findMetricFamilyByName(mf, "target_info")
			customResourceLabel := findMetricLabelByName(targetInfo.GetMetric(), "custom_resource")

			require.NotNil(t, customResourceLabel)
			customResourceLabelValue := "value"
			require.Equal(t, customResourceLabel.Value, &customResourceLabelValue)

			requestTotal := findMetricFamilyByName(mf, "router_http_requests_total")
			requestTotalMetrics := requestTotal.GetMetric()

			require.Len(t, requestTotalMetrics, 2)
			require.Len(t, requestTotalMetrics[0].Label, 13)
			require.Len(t, requestTotalMetrics[1].Label, 14)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("custom"),
					Value: PointerOf("value"),
				},
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
				},
				{
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
			}, requestTotalMetrics[0].Label)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("custom"),
					Value: PointerOf("value"),
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
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

			requestsInFlight := findMetricFamilyByName(mf, "router_http_requests_in_flight")
			requestsInFlightMetrics := requestsInFlight.GetMetric()

			require.Len(t, requestsInFlightMetrics, 2)
			require.Len(t, requestsInFlightMetrics[0].Label, 10)
			require.Len(t, requestsInFlightMetrics[1].Label, 14)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("custom"),
					Value: PointerOf("value"),
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
					Name:  PointerOf("wg_operation_protocol"),
					Value: PointerOf("http"),
				},
				{
					Name:  PointerOf("wg_router_cluster_name"),
					Value: PointerOf(""),
				},
				{
					Name:  PointerOf("wg_router_config_version"),
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
				},
				{
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
			}, requestsInFlightMetrics[0].Label)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("custom"),
					Value: PointerOf("value"),
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
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

			requestDuration := findMetricFamilyByName(mf, "router_http_request_duration_milliseconds")
			requestDurationMetrics := requestDuration.GetMetric()

			require.Len(t, requestDurationMetrics, 2)
			require.Len(t, requestDurationMetrics[0].Label, 13)
			require.Len(t, requestDurationMetrics[1].Label, 14)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("custom"),
					Value: PointerOf("value"),
				},
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
				},
				{
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
			}, requestDurationMetrics[0].Label)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("custom"),
					Value: PointerOf("value"),
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
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

			responseContentLength := findMetricFamilyByName(mf, "router_http_response_content_length_total")
			responseContentLengthMetrics := responseContentLength.GetMetric()

			require.Len(t, responseContentLengthMetrics, 2)
			require.Len(t, responseContentLengthMetrics[0].Label, 13)
			require.Len(t, responseContentLengthMetrics[1].Label, 15)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("custom"),
					Value: PointerOf("value"),
				},
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
				},
				{
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
			}, responseContentLengthMetrics[0].Label)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("custom"),
					Value: PointerOf("value"),
				},
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
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

	t.Run("Collect and export OTEL metrics in respect to custom attributes / static", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			TraceExporter:      exporter,
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			OtelResourceAttributes: []config.OtelResourceAttribute{
				{
					Key:   "custom.resource",
					Value: "value",
				},
			},
			OtelAttributes: []config.OtelAttribute{
				{
					Key:     "custom",
					Default: "value",
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: map[string][]string{
					"x-custom-header": {"value_different"},
				},
				Query: `query myQuery { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			targetInfo := findMetricFamilyByName(mf, "target_info")
			customResourceLabel := findMetricLabelByName(targetInfo.GetMetric(), "custom_resource")

			require.NotNil(t, customResourceLabel)
			customResourceLabelValue := "value"
			require.Equal(t, customResourceLabel.Value, &customResourceLabelValue)

			requestTotal := findMetricFamilyByName(mf, "router_http_requests_total")
			requestTotalMetrics := requestTotal.GetMetric()

			require.Len(t, requestTotalMetrics, 2)
			require.Len(t, requestTotalMetrics[0].Label, 13)
			require.Len(t, requestTotalMetrics[1].Label, 14)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("custom"),
					Value: PointerOf("value"),
				},
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
				},
				{
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
			}, requestTotalMetrics[0].Label)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("custom"),
					Value: PointerOf("value"),
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
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

			requestsInFlight := findMetricFamilyByName(mf, "router_http_requests_in_flight")
			requestsInFlightMetrics := requestsInFlight.GetMetric()

			require.Len(t, requestsInFlightMetrics, 2)
			require.Len(t, requestsInFlightMetrics[0].Label, 10)
			require.Len(t, requestsInFlightMetrics[1].Label, 14)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("custom"),
					Value: PointerOf("value"),
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
					Name:  PointerOf("wg_operation_protocol"),
					Value: PointerOf("http"),
				},
				{
					Name:  PointerOf("wg_router_cluster_name"),
					Value: PointerOf(""),
				},
				{
					Name:  PointerOf("wg_router_config_version"),
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
				},
				{
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
			}, requestsInFlightMetrics[0].Label)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("custom"),
					Value: PointerOf("value"),
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
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

			requestDuration := findMetricFamilyByName(mf, "router_http_request_duration_milliseconds")
			requestDurationMetrics := requestDuration.GetMetric()

			require.Len(t, requestDurationMetrics, 2)
			require.Len(t, requestDurationMetrics[0].Label, 13)
			require.Len(t, requestDurationMetrics[1].Label, 14)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("custom"),
					Value: PointerOf("value"),
				},
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
				},
				{
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
			}, requestDurationMetrics[0].Label)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("custom"),
					Value: PointerOf("value"),
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
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

			responseContentLength := findMetricFamilyByName(mf, "router_http_response_content_length_total")
			responseContentLengthMetrics := responseContentLength.GetMetric()

			require.Len(t, responseContentLengthMetrics, 2)
			require.Len(t, responseContentLengthMetrics[0].Label, 13)
			require.Len(t, responseContentLengthMetrics[1].Label, 15)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("custom"),
					Value: PointerOf("value"),
				},
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
				},
				{
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
			}, responseContentLengthMetrics[0].Label)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("custom"),
					Value: PointerOf("value"),
				},
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
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

	t.Run("Subgraph errors are tracked through request error metric", func(t *testing.T) {
		exporter := tracetest.NewInMemoryExporter(t)
		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			TraceExporter:      exporter,
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusForbidden)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}},{"message":"MyErrorMessage","extensions":{"code":"YOUR_ERROR_CODE"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '3' at Path 'employees'.","extensions":{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}},{"message":"MyErrorMessage","extensions":{"code":"YOUR_ERROR_CODE"}}],"statusCode":403}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			responseContentLength := findMetricFamilyByName(mf, "router_http_requests_error_total")
			responseContentLengthMetrics := responseContentLength.GetMetric()

			require.Len(t, responseContentLengthMetrics, 3)
			require.Len(t, responseContentLengthMetrics[0].Label, 12)
			require.Len(t, responseContentLengthMetrics[1].Label, 16)
			require.Len(t, responseContentLengthMetrics[2].Label, 16)

			// Error metric for the subgraph error
			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("http_status_code"),
					Value: PointerOf("403"),
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
					Name:  PointerOf("wg_component_name"),
					Value: PointerOf("engine-loader"),
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
				},
				{
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
				{
					Name:  PointerOf("wg_subgraph_error_extended_code"),
					Value: PointerOf("UNAUTHORIZED"),
				},
				{
					Name:  PointerOf("wg_subgraph_id"),
					Value: PointerOf("3"),
				},
				{
					Name:  PointerOf("wg_subgraph_name"),
					Value: PointerOf("products"),
				},
			}, responseContentLengthMetrics[1].Label)

			// Error metric for the subgraph error
			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("http_status_code"),
					Value: PointerOf("403"),
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
					Name:  PointerOf("wg_component_name"),
					Value: PointerOf("engine-loader"),
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
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
				},
				{
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
				{
					Name:  PointerOf("wg_subgraph_error_extended_code"),
					Value: PointerOf("YOUR_ERROR_CODE"),
				},
				{
					Name:  PointerOf("wg_subgraph_id"),
					Value: PointerOf("3"),
				},
				{
					Name:  PointerOf("wg_subgraph_name"),
					Value: PointerOf("products"),
				},
			}, responseContentLengthMetrics[2].Label)
		})
	})

	t.Run("Collect and export OTEL metrics in respect to feature flags", func(t *testing.T) {
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
				Header: map[string][]string{
					"X-Feature-Flag": {"myff"},
				},
			})
			require.JSONEq(t, employeesIDData, res.Body)

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			requestTotal := findMetricFamilyByName(mf, "router_http_requests_total")
			requestTotalMetrics := requestTotal.GetMetric()

			require.Len(t, requestTotalMetrics, 2)
			require.Len(t, requestTotalMetrics[0].Label, 13)
			require.Len(t, requestTotalMetrics[1].Label, 14)

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
					Name:  PointerOf("wg_feature_flag"),
					Value: PointerOf("myff"),
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
					Value: PointerOf(xEnv.RouterConfigVersionMyFF()),
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
					Name:  PointerOf("wg_feature_flag"),
					Value: PointerOf("myff"),
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
					Value: PointerOf(xEnv.RouterConfigVersionMyFF()),
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

			requestsInFlight := findMetricFamilyByName(mf, "router_http_requests_in_flight")
			requestsInFlightMetrics := requestsInFlight.GetMetric()

			require.Len(t, requestsInFlightMetrics, 2)
			require.Len(t, requestsInFlightMetrics[0].Label, 10)
			require.Len(t, requestsInFlightMetrics[1].Label, 14)

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
					Name:  PointerOf("wg_feature_flag"),
					Value: PointerOf("myff"),
				},
				{
					Name:  PointerOf("wg_federated_graph_id"),
					Value: PointerOf("graph"),
				},
				{
					Name:  PointerOf("wg_operation_protocol"),
					Value: PointerOf("http"),
				},
				{
					Name:  PointerOf("wg_router_cluster_name"),
					Value: PointerOf(""),
				},
				{
					Name:  PointerOf("wg_router_config_version"),
					Value: PointerOf(xEnv.RouterConfigVersionMyFF()),
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
					Name:  PointerOf("wg_feature_flag"),
					Value: PointerOf("myff"),
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
					Value: PointerOf(xEnv.RouterConfigVersionMyFF()),
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

			requestDuration := findMetricFamilyByName(mf, "router_http_request_duration_milliseconds")
			requestDurationMetrics := requestDuration.GetMetric()

			require.Len(t, requestDurationMetrics, 2)
			require.Len(t, requestDurationMetrics[0].Label, 13)
			require.Len(t, requestDurationMetrics[1].Label, 14)

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
					Name:  PointerOf("wg_feature_flag"),
					Value: PointerOf("myff"),
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
					Value: PointerOf(xEnv.RouterConfigVersionMyFF()),
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
					Name:  PointerOf("wg_feature_flag"),
					Value: PointerOf("myff"),
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
					Value: PointerOf(xEnv.RouterConfigVersionMyFF()),
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

			responseContentLength := findMetricFamilyByName(mf, "router_http_response_content_length_total")
			responseContentLengthMetrics := responseContentLength.GetMetric()

			require.Len(t, responseContentLengthMetrics, 2)
			require.Len(t, responseContentLengthMetrics[0].Label, 13)
			require.Len(t, responseContentLengthMetrics[1].Label, 15)

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
					Name:  PointerOf("wg_feature_flag"),
					Value: PointerOf("myff"),
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
					Value: PointerOf(xEnv.RouterConfigVersionMyFF()),
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
					Name:  PointerOf("wg_feature_flag"),
					Value: PointerOf("myff"),
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
					Value: PointerOf(xEnv.RouterConfigVersionMyFF()),
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

func findMetricFamilyByName(mf []*io_prometheus_client.MetricFamily, name string) *io_prometheus_client.MetricFamily {
	for _, m := range mf {
		if m.GetName() == name {
			return m
		}
	}
	return nil
}

func findMetricLabelByName(mf []*io_prometheus_client.Metric, name string) *io_prometheus_client.LabelPair {
	for _, m := range mf {
		for _, l := range m.GetLabel() {
			if l.GetName() == name {
				return l
			}
		}
	}
	return nil
}

func PointerOf[T any](t T) *T {
	return &t
}
