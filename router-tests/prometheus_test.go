package integration

import (
	"net/http"
	"regexp"
	"strings"
	"testing"

	"github.com/wundergraph/cosmo/router/core"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
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
	const employeesTagData = `{"data":{"employees":[{"tag":""},{"tag":""},{"tag":""},{"tag":""},{"tag":""},{"tag":""},{"tag":""},{"tag":""},{"tag":""},{"tag":""}]}}`

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

			planningTime := findMetricFamilyByName(mf, "router_graphql_operation_planning_time")
			planningTimeMetrics := planningTime.GetMetric()

			require.Len(t, planningTimeMetrics, 1)
			require.Len(t, planningTimeMetrics[0].Label, 12)

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
					Name:  PointerOf("wg_engine_plan_cache_hit"),
					Value: PointerOf("false"),
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
			}, planningTimeMetrics[0].Label)

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
			CustomResourceAttributes: []config.CustomStaticAttribute{
				{
					Key:   "custom.resource",
					Value: "value",
				},
			},
			CustomMetricAttributes: []config.CustomAttribute{
				{
					Key:     "custom",
					Default: "value_different",
					ValueFrom: &config.CustomDynamicAttribute{
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
			require.Len(t, requestTotalMetrics[1].Label, 15)

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
			require.Len(t, requestDurationMetrics[1].Label, 15)

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
			CustomResourceAttributes: []config.CustomStaticAttribute{
				{
					Key:   "custom.resource",
					Value: "value",
				},
			},
			CustomMetricAttributes: []config.CustomAttribute{
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
			require.Len(t, requestTotalMetrics[1].Label, 15)

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
			require.Len(t, requestDurationMetrics[1].Label, 15)

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
		t.Parallel()

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
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'.","extensions":{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}},{"message":"MyErrorMessage","extensions":{"code":"YOUR_ERROR_CODE"}}],"statusCode":403}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			totalRequestsErrors := findMetricFamilyByName(mf, "router_http_requests_error_total")
			totalRequestErrorsMetric := totalRequestsErrors.GetMetric()

			require.Len(t, totalRequestErrorsMetric, 2)
			require.Len(t, totalRequestErrorsMetric[0].Label, 12)
			require.Len(t, totalRequestErrorsMetric[1].Label, 14)

			// Error metric for the subgraph error
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
			}, totalRequestErrorsMetric[0].Label)

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
					Value: PointerOf("3"),
				},
				{
					Name:  PointerOf("wg_subgraph_name"),
					Value: PointerOf("products"),
				},
			}, totalRequestErrorsMetric[1].Label)
		})
	})

	t.Run("Custom slice metric attributes produces multiple metric series", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			TraceExporter:      exporter,
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			CustomMetricAttributes: []config.CustomAttribute{
				{
					Key: "error_codes",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldGraphQLErrorCodes,
					},
				},
			},
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
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'.","extensions":{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}},{"message":"MyErrorMessage","extensions":{"code":"YOUR_ERROR_CODE"}}],"statusCode":403}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			requestDuration := findMetricFamilyByName(mf, "router_http_request_duration_milliseconds")
			requestDurationMetric := requestDuration.GetMetric()

			/**
			employees -> 200 Status code = 1
			products -> 402 + 2x error codes = 2
			router -> 200 Status code + 2x error codes = 2

			Total metrics = 5
			*/

			require.Len(t, requestDurationMetric, 5)
			require.Len(t, requestDurationMetric[0].Label, 14)
			require.Len(t, requestDurationMetric[1].Label, 14)
			require.Len(t, requestDurationMetric[2].Label, 14)
			require.Len(t, requestDurationMetric[3].Label, 16)
			require.Len(t, requestDurationMetric[4].Label, 16)

			totalRequestsErrors := findMetricFamilyByName(mf, "router_http_requests_error_total")
			totalRequestErrorsMetric := totalRequestsErrors.GetMetric()

			/**
			products -> 402 + 2x error codes = 2
			router -> 200 Status code + 2x error codes = 2

			Total metrics = 4
			*/

			require.Len(t, totalRequestErrorsMetric, 4)
			require.Len(t, totalRequestErrorsMetric[0].Label, 13)
			require.Len(t, totalRequestErrorsMetric[1].Label, 13)
			require.Len(t, totalRequestErrorsMetric[2].Label, 15)
			require.Len(t, totalRequestErrorsMetric[3].Label, 15)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("error_codes"),
					Value: PointerOf("UNAUTHORIZED"),
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
			}, totalRequestErrorsMetric[0].Label)

			// Error metric for the subgraph error
			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("error_codes"),
					Value: PointerOf("YOUR_ERROR_CODE"),
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
			}, totalRequestErrorsMetric[1].Label)

			// Error metric for the subgraph error
			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("error_codes"),
					Value: PointerOf("UNAUTHORIZED"),
				},
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
					Value: PointerOf("3"),
				},
				{
					Name:  PointerOf("wg_subgraph_name"),
					Value: PointerOf("products"),
				},
			}, totalRequestErrorsMetric[2].Label)

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("error_codes"),
					Value: PointerOf("YOUR_ERROR_CODE"),
				},
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
					Value: PointerOf("3"),
				},
				{
					Name:  PointerOf("wg_subgraph_name"),
					Value: PointerOf("products"),
				},
			}, totalRequestErrorsMetric[3].Label)
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
			require.Len(t, requestTotalMetrics[1].Label, 15)

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
			require.Len(t, requestDurationMetrics[1].Label, 15)

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

	t.Run("Collect and export OTEL metrics to Prometheus with exclusion", func(t *testing.T) {
		t.Parallel()

		var (
			err        error
			mfFull     []*io_prometheus_client.MetricFamily
			mfFiltered []*io_prometheus_client.MetricFamily
		)

		metricReaderFull := metric.NewManualReader()
		promRegistryFull := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReaderFull,
			PrometheusRegistry: promRegistryFull,
		}, func(t *testing.T, xEnv *testenv.Environment) {

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			mfFull, err = promRegistryFull.Gather()
			require.NoError(t, err)

			requestTotal := findMetricFamilyByName(mfFull, "router_http_requests_total")
			requestTotalMetrics := requestTotal.GetMetric()

			require.Len(t, requestTotalMetrics, 2)
			require.Len(t, requestTotalMetrics[0].Label, 12)
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
			}, requestTotalMetrics[1].Label)

			requestsInFlight := findMetricFamilyByName(mfFull, "router_http_requests_in_flight")
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

		})

		metricReaderFiltered := metric.NewManualReader()
		promRegistryFiltered := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReaderFiltered,
			PrometheusRegistry: promRegistryFiltered,
			MetricOptions: testenv.MetricOptions{
				MetricExclusions: testenv.MetricExclusions{
					ExcludedPrometheusMetrics: []*regexp.Regexp{
						regexp.MustCompile(`^router_http_requests$`),
					},
					ExcludedPrometheusMetricLabels: []*regexp.Regexp{
						regexp.MustCompile(`^wg_client_name$`),
						regexp.MustCompile(`^wg_router_cluster.*`),
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
			})

			require.JSONEq(t, employeesIDData, res.Body)

			mfFiltered, err = promRegistryFiltered.Gather()
			require.NoError(t, err)

			rt := findMetricFamilyByName(mfFiltered, "router_http_requests_total")

			require.Nil(t, rt)

			requestsInFlightFull := findMetricFamilyByName(mfFull, "router_http_requests_in_flight")
			requestsInFlightMetricsFull := requestsInFlightFull.GetMetric()

			requestsInFlightFiltered := findMetricFamilyByName(mfFiltered, "router_http_requests_in_flight")
			requestsInFlightMetricsFiltered := requestsInFlightFiltered.GetMetric()

			require.Len(t, requestsInFlightMetricsFiltered, 2)
			require.Len(t, requestsInFlightMetricsFiltered[0].Label, 7)
			require.Len(t, requestsInFlightMetricsFiltered[1].Label, 11)

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
					Name:  PointerOf("wg_router_config_version"),
					Value: PointerOf(xEnv.RouterConfigVersionMain()),
				},
				{
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
			}, requestsInFlightMetricsFiltered[0].Label)

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
			}, requestsInFlightMetricsFiltered[1].Label)

			// Check that the full and filtered metrics are different
			require.Greater(t, len(mfFull), len(mfFiltered), "full metrics should have more metrics than filtered")
			require.Greater(t, len(requestsInFlightMetricsFull[0].Label), len(requestsInFlightMetricsFiltered[0].Label))
			require.Greater(t, len(requestsInFlightMetricsFull[1].Label), len(requestsInFlightMetricsFiltered[1].Label))
		})
	})

	t.Run("Collect router cache metrics", func(t *testing.T) {
		var (
			err            error
			metricFamilies []*io_prometheus_client.MetricFamily
			baseCost       = 57
		)

		metricReaderFiltered := metric.NewManualReader()
		promRegistryFiltered := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(eec *config.EngineExecutionConfiguration) {
				eec.ExecutionPlanCacheSize = int64(baseCost * 10)
				eec.NormalizationCacheSize = int64(baseCost * 20)
				eec.ValidationCacheSize = int64(baseCost)
			},
			MetricReader:       metricReaderFiltered,
			PrometheusRegistry: promRegistryFiltered,
			MetricOptions: testenv.MetricOptions{
				EnablePrometheusRouterCache: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			promRegistryFiltered.Unregister(collectors.NewGoCollector())

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
			})

			require.JSONEq(t, employeesIDData, res.Body)

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
			})

			require.JSONEq(t, employeesIDData, res.Body)

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { tag } }`,
			})

			require.JSONEq(t, employeesTagData, res.Body)

			metricFamilies, err = promRegistryFiltered.Gather()
			require.NoError(t, err)

			cacheMetrics := findCacheMetrics(metricFamilies)

			for _, c := range cacheMetrics {
				assertCacheTypeLabels(t, c)

				if c.GetName() == "router_graphql_cache_cost_max" {
					for _, m := range c.GetMetric() {
						switch getCacheType(t, m) {
						case "execution":
							require.Equal(t, float64(baseCost*10), m.GetGauge().GetValue())
						case "normalization":
							require.Equal(t, float64(baseCost*20), m.GetGauge().GetValue())
						case "validation":
							require.Equal(t, float64(baseCost), m.GetGauge().GetValue())
						}
					}
				}

				if c.GetName() == "router_graphql_cache_cost_stats_total" {
					const searchLabel = "operation"
					require.Len(t, c.GetMetric(), 6)
					for _, m := range c.GetMetric() {
						switch getCacheType(t, m) {
						case "execution":
							switch getLabel(t, m, searchLabel) {
							case "added":
								require.Equal(t, float64(baseCost*2), m.GetCounter().GetValue())
							case "evicted":
								require.Equal(t, float64(0), m.GetCounter().GetValue())
							default:
								require.Fail(t, "unable to find operation")
							}
						case "normalization":
							switch getLabel(t, m, searchLabel) {
							case "added":
								require.Equal(t, float64(baseCost*2), m.GetCounter().GetValue())
							case "evicted":
								require.Equal(t, float64(0), m.GetCounter().GetValue())
							default:
								require.Fail(t, "unable to find operation")
							}
						case "validation":
							switch getLabel(t, m, searchLabel) {
							case "added":
								require.Equal(t, float64(baseCost*2), m.GetCounter().GetValue())
							case "evicted":
								require.Equal(t, float64(baseCost), m.GetCounter().GetValue())
							default:
								require.Fail(t, "unable to find operation")
							}
						}
					}
				}

				if c.GetName() == "router_graphql_cache_hits_stats_total" {
					require.Len(t, c.GetMetric(), 6)
					const searchLabel = "type"
					for _, m := range c.GetMetric() {
						switch getCacheType(t, m) {
						case "execution":
							switch getLabel(t, m, searchLabel) {
							case "hits":
								require.Equal(t, float64(1), m.GetCounter().GetValue())
							case "misses":
								require.Equal(t, float64(2), m.GetCounter().GetValue())
							default:
								require.Fail(t, "unable to find expected type")
							}
						case "normalization":
							switch getLabel(t, m, searchLabel) {
							case "hits":
								require.Equal(t, float64(1), m.GetCounter().GetValue())
							case "misses":
								require.Equal(t, float64(2), m.GetCounter().GetValue())
							default:
								require.Fail(t, "unable to find expected type")
							}
						case "validation":
							switch getLabel(t, m, searchLabel) {
							case "hits":
								require.Equal(t, float64(1), m.GetCounter().GetValue())
							case "misses":
								require.Equal(t, float64(2), m.GetCounter().GetValue())
							default:
								require.Fail(t, "unable to find expected type")
							}
						}
					}
				}

				if c.GetName() == "router_graphql_cache_keys_stats_total" {
					require.Len(t, c.GetMetric(), 9)
					const searchLabel = "operation"
					for _, m := range c.GetMetric() {
						switch getCacheType(t, m) {
						case "execution":
							switch getLabel(t, m, searchLabel) {
							case "added":
								require.Equal(t, float64(2), m.GetCounter().GetValue())
							case "evicted":
								require.Equal(t, float64(0), m.GetCounter().GetValue())
							case "updated":
								require.Equal(t, float64(0), m.GetCounter().GetValue())
							default:
								require.Fail(t, "unable to find operation")
							}
						case "normalization":
							switch getLabel(t, m, searchLabel) {
							case "added":
								require.Equal(t, float64(2), m.GetCounter().GetValue())
							case "evicted":
								require.Equal(t, float64(0), m.GetCounter().GetValue())
							case "updated":
								require.Equal(t, float64(0), m.GetCounter().GetValue())
							default:
								require.Fail(t, "unable to find operation")
							}
						case "validation":
							switch getLabel(t, m, searchLabel) {
							case "added":
								require.Equal(t, float64(2), m.GetCounter().GetValue())
							case "evicted":
								require.Equal(t, float64(1), m.GetCounter().GetValue())
							case "updated":
								require.Equal(t, float64(0), m.GetCounter().GetValue())
							default:
								require.Fail(t, "unable to find operation")
							}
						}
					}
				}
			}
		})
	})
}

// Creates a separate prometheus metric when service error codes are used as custom attributes

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

func findCacheMetrics(mf []*io_prometheus_client.MetricFamily) []*io_prometheus_client.MetricFamily {
	var cacheMetrics []*io_prometheus_client.MetricFamily
	for _, m := range mf {
		if strings.HasPrefix(m.GetName(), "router_graphql_cache_") {
			cacheMetrics = append(cacheMetrics, m)
		}
	}
	return cacheMetrics
}

func assertCacheTypeLabels(t *testing.T, mf *io_prometheus_client.MetricFamily) {
	t.Helper()

	cacheTypes := map[string]struct{}{
		"execution":     {},
		"validation":    {},
		"normalization": {},
	}

	// The metrics should contain a cache_type label with one of the expected values
	for _, m := range mf.GetMetric() {
		for _, l := range m.GetLabel() {
			if l.GetName() == "cache_type" {
				_, found := cacheTypes[l.GetValue()]
				require.Truef(t, found, "unexpected cache type label value: %s", l.GetValue())
			}
		}
	}
}

func getCacheType(t *testing.T, m *io_prometheus_client.Metric) string {
	for _, l := range m.GetLabel() {
		if l.GetName() == "cache_type" {
			return l.GetValue()
		}
	}

	require.Fail(t, "cache_type label not found")
	return ""
}

func getLabel(t *testing.T, m *io_prometheus_client.Metric, name string) string {
	for _, l := range m.GetLabel() {
		if l.GetName() == name {
			return l.GetValue()
		}
	}

	require.Fail(t, "operation label not found")
	return ""
}

func PointerOf[T any](t T) *T {
	return &t
}
