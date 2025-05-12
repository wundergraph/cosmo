package integration

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	io_prometheus_client "github.com/prometheus/client_model/go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/cmd/custom/module"
	"github.com/wundergraph/cosmo/router/core"
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
				{
					Key: "custom2",
					ValueFrom: &config.CustomDynamicAttribute{
						Expression: "request.header.Get('x-custom-header')",
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

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("custom"),
					Value: PointerOf("value"),
				},
				{
					Name:  PointerOf("custom2"),
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
					Name:  PointerOf("custom2"),
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
					Name:  PointerOf("custom2"),
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

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("custom"),
					Value: PointerOf("value"),
				},
				{
					Name:  PointerOf("custom2"),
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
					Name:  PointerOf("custom2"),
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

			require.Equal(t, []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("custom"),
					Value: PointerOf("value"),
				},
				{
					Name:  PointerOf("custom2"),
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
					Name:  PointerOf("custom2"),
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
			require.Len(t, requestDurationMetric[0].Label, 13)
			require.Len(t, requestDurationMetric[1].Label, 13)
			require.Len(t, requestDurationMetric[2].Label, 13)
			require.Len(t, requestDurationMetric[3].Label, 15)
			require.Len(t, requestDurationMetric[4].Label, 15)

			totalRequestsErrors := findMetricFamilyByName(mf, "router_http_requests_error_total")
			totalRequestErrorsMetric := totalRequestsErrors.GetMetric()

			/**
			products -> 402 + 2x error codes = 2
			router -> 200 Status code + 2x error codes = 2

			Total metrics = 4
			*/

			require.Len(t, totalRequestErrorsMetric, 4)

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

	t.Run("Collect and export OTEL metrics to Prometheus with exclude scope info", func(t *testing.T) {
		t.Parallel()

		var (
			err        error
			mfFiltered []*io_prometheus_client.MetricFamily
		)

		metricReaderFiltered := metric.NewManualReader()
		promRegistryFiltered := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReaderFiltered,
			PrometheusRegistry: promRegistryFiltered,
			MetricOptions: testenv.MetricOptions{
				MetricExclusions: testenv.MetricExclusions{
					ExcludeScopeInfo: true,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
			})

			require.JSONEq(t, employeesIDData, res.Body)

			mfFiltered, err = promRegistryFiltered.Gather()
			require.NoError(t, err)

			requestsInFlightFiltered := findMetricFamilyByName(mfFiltered, "router_http_requests_in_flight")
			requestsInFlightMetricsFiltered := requestsInFlightFiltered.GetMetric()

			require.Len(t, requestsInFlightMetricsFiltered, 2)

			for _, metric := range requestsInFlightMetricsFiltered {
				for _, label := range metric.Label {
					require.NotEqual(t, PointerOf("otel_scope_name"), label.Name, "otel_scope_name should not be present")
					require.NotEqual(t, PointerOf("otel_scope_version"), label.Name, "otel_scope_version should not be present")
				}
			}
		})
	})

	t.Run("Collect correct default router cache metrics when OTLP is also enabled", func(t *testing.T) {
		t.Parallel()

		var (
			err            error
			metricFamilies []*io_prometheus_client.MetricFamily
			// The base cost to store any item in the cache with the current configuration
			baseCost int64 = 1
		)

		metricReaderFiltered := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReaderFiltered,
			PrometheusRegistry: promRegistry,
			MetricOptions: testenv.MetricOptions{
				EnablePrometheusRouterCache: true,
				EnableOTLPRouterCache:       true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			baseAttributes := []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("otel_scope_name"),
					Value: PointerOf("cosmo.router.cache"),
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
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
			}

			promRegistry.Unregister(collectors.NewGoCollector())

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

			metricFamilies, err = promRegistry.Gather()
			require.NoError(t, err)

			cacheMetrics := findCacheMetrics(metricFamilies)

			// cache max cost metrics
			cacheMaxCostMetricMf := findMetricFamilyByName(cacheMetrics, "router_graphql_cache_cost_max")
			cacheMaxCostExecution := findMetricsByLabel(cacheMaxCostMetricMf, "cache_type", "plan")
			cacheMaxCostNormalization := findMetricsByLabel(cacheMaxCostMetricMf, "cache_type", "query_normalization")
			cacheMaxCostValidation := findMetricsByLabel(cacheMaxCostMetricMf, "cache_type", "validation")

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}), cacheMaxCostExecution[0].Label)
			require.Equal(t, float64(1024), cacheMaxCostExecution[0].GetGauge().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}), cacheMaxCostNormalization[0].Label)
			require.Equal(t, float64(1024), cacheMaxCostNormalization[0].GetGauge().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}), cacheMaxCostValidation[0].Label)
			require.Equal(t, float64(1024), cacheMaxCostValidation[0].GetGauge().GetValue())

			// Check the cache request stats

			cacheRequestStatsMetricMf := findMetricFamilyByName(cacheMetrics, "router_graphql_cache_requests_stats_total")
			cacheRequestExecutionStats := findMetricsByLabel(cacheRequestStatsMetricMf, "cache_type", "plan")
			cacheRequestNormalizationStats := findMetricsByLabel(cacheRequestStatsMetricMf, "cache_type", "query_normalization")
			cacheRequestValidationStats := findMetricsByLabel(cacheRequestStatsMetricMf, "cache_type", "validation")

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("type"),
				Value: PointerOf("hits"),
			}), cacheRequestExecutionStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("type"),
				Value: PointerOf("misses"),
			}), cacheRequestExecutionStats[1].Label)

			require.Equal(t, float64(1), cacheRequestExecutionStats[0].GetCounter().GetValue())
			require.Equal(t, float64(2), cacheRequestExecutionStats[1].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("type"),
				Value: PointerOf("hits"),
			}), cacheRequestNormalizationStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("type"),
				Value: PointerOf("misses"),
			}), cacheRequestNormalizationStats[1].Label)

			require.Equal(t, float64(1), cacheRequestNormalizationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(2), cacheRequestNormalizationStats[1].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("type"),
				Value: PointerOf("hits"),
			}), cacheRequestValidationStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("type"),
				Value: PointerOf("misses"),
			}), cacheRequestValidationStats[1].Label)

			require.Equal(t, float64(1), cacheRequestValidationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(2), cacheRequestValidationStats[1].GetCounter().GetValue())

			// Cache cost stats
			cacheCostStatsMf := findMetricFamilyByName(cacheMetrics, "router_graphql_cache_cost_stats_total")
			cacheCostExecutionStats := findMetricsByLabel(cacheCostStatsMf, "cache_type", "plan")
			cacheCostNormalizationStats := findMetricsByLabel(cacheCostStatsMf, "cache_type", "query_normalization")
			cacheCostValidationStats := findMetricsByLabel(cacheCostStatsMf, "cache_type", "validation")

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("added"),
			}), cacheCostExecutionStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheCostExecutionStats[1].Label)

			require.Equal(t, float64(baseCost*2), cacheCostExecutionStats[0].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheCostExecutionStats[1].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("added"),
			}), cacheCostNormalizationStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheCostNormalizationStats[1].Label)

			require.Equal(t, float64(baseCost*2), cacheCostNormalizationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheCostNormalizationStats[1].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheCostNormalizationStats[1].Label)

			require.Equal(t, float64(baseCost*2), cacheCostNormalizationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheCostNormalizationStats[1].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("added"),
			}), cacheCostValidationStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheCostValidationStats[1].Label)

			require.Equal(t, float64(baseCost*2), cacheCostValidationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheCostValidationStats[1].GetCounter().GetValue())

			// cache Key stats
			cacheKeyStatsMf := findMetricFamilyByName(cacheMetrics, "router_graphql_cache_keys_stats_total")
			cacheKeyExecutionStats := findMetricsByLabel(cacheKeyStatsMf, "cache_type", "plan")
			cacheKeyNormalizationStats := findMetricsByLabel(cacheKeyStatsMf, "cache_type", "query_normalization")
			cacheKeyValidationStats := findMetricsByLabel(cacheKeyStatsMf, "cache_type", "validation")

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("added"),
			}), cacheKeyExecutionStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheKeyExecutionStats[1].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("updated"),
			}), cacheKeyExecutionStats[2].Label)

			require.Equal(t, float64(2), cacheKeyExecutionStats[0].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheKeyExecutionStats[1].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheKeyExecutionStats[2].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("added"),
			}), cacheKeyNormalizationStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheKeyNormalizationStats[1].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("updated"),
			}), cacheKeyNormalizationStats[2].Label)

			require.Equal(t, float64(2), cacheKeyNormalizationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheKeyNormalizationStats[1].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheKeyNormalizationStats[2].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("added"),
			}), cacheKeyValidationStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheKeyValidationStats[1].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("updated"),
			}), cacheKeyValidationStats[2].Label)

			require.Equal(t, float64(2), cacheKeyValidationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheKeyValidationStats[1].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheKeyValidationStats[2].GetCounter().GetValue())

		})
	})

	t.Run("Collect router cache metrics with default cache configs", func(t *testing.T) {
		t.Parallel()

		var (
			err            error
			metricFamilies []*io_prometheus_client.MetricFamily
			// The base cost to store any item in the cache with the current configuration
			baseCost int64 = 1
		)

		metricReaderFiltered := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReaderFiltered,
			PrometheusRegistry: promRegistry,
			MetricOptions: testenv.MetricOptions{
				EnablePrometheusRouterCache: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			baseAttributes := []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("otel_scope_name"),
					Value: PointerOf("cosmo.router.cache"),
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
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
			}

			promRegistry.Unregister(collectors.NewGoCollector())

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

			metricFamilies, err = promRegistry.Gather()
			require.NoError(t, err)

			cacheMetrics := findCacheMetrics(metricFamilies)

			// cache max cost metrics
			cacheMaxCostMetricMf := findMetricFamilyByName(cacheMetrics, "router_graphql_cache_cost_max")
			cacheMaxCostExecution := findMetricsByLabel(cacheMaxCostMetricMf, "cache_type", "plan")
			cacheMaxCostNormalization := findMetricsByLabel(cacheMaxCostMetricMf, "cache_type", "query_normalization")
			cacheMaxCostValidation := findMetricsByLabel(cacheMaxCostMetricMf, "cache_type", "validation")

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}), cacheMaxCostExecution[0].Label)
			require.Equal(t, float64(1024), cacheMaxCostExecution[0].GetGauge().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}), cacheMaxCostNormalization[0].Label)
			require.Equal(t, float64(1024), cacheMaxCostNormalization[0].GetGauge().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}), cacheMaxCostValidation[0].Label)
			require.Equal(t, float64(1024), cacheMaxCostValidation[0].GetGauge().GetValue())

			// Check the cache request stats

			cacheRequestStatsMetricMf := findMetricFamilyByName(cacheMetrics, "router_graphql_cache_requests_stats_total")
			cacheRequestExecutionStats := findMetricsByLabel(cacheRequestStatsMetricMf, "cache_type", "plan")
			cacheRequestNormalizationStats := findMetricsByLabel(cacheRequestStatsMetricMf, "cache_type", "query_normalization")
			cacheRequestValidationStats := findMetricsByLabel(cacheRequestStatsMetricMf, "cache_type", "validation")

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("type"),
				Value: PointerOf("hits"),
			}), cacheRequestExecutionStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("type"),
				Value: PointerOf("misses"),
			}), cacheRequestExecutionStats[1].Label)

			require.Equal(t, float64(1), cacheRequestExecutionStats[0].GetCounter().GetValue())
			require.Equal(t, float64(2), cacheRequestExecutionStats[1].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("type"),
				Value: PointerOf("hits"),
			}), cacheRequestNormalizationStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("type"),
				Value: PointerOf("misses"),
			}), cacheRequestNormalizationStats[1].Label)

			require.Equal(t, float64(1), cacheRequestNormalizationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(2), cacheRequestNormalizationStats[1].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("type"),
				Value: PointerOf("hits"),
			}), cacheRequestValidationStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("type"),
				Value: PointerOf("misses"),
			}), cacheRequestValidationStats[1].Label)

			require.Equal(t, float64(1), cacheRequestValidationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(2), cacheRequestValidationStats[1].GetCounter().GetValue())

			// Cache cost stats
			cacheCostStatsMf := findMetricFamilyByName(cacheMetrics, "router_graphql_cache_cost_stats_total")
			cacheCostExecutionStats := findMetricsByLabel(cacheCostStatsMf, "cache_type", "plan")
			cacheCostNormalizationStats := findMetricsByLabel(cacheCostStatsMf, "cache_type", "query_normalization")
			cacheCostValidationStats := findMetricsByLabel(cacheCostStatsMf, "cache_type", "validation")

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("added"),
			}), cacheCostExecutionStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheCostExecutionStats[1].Label)

			require.Equal(t, float64(baseCost*2), cacheCostExecutionStats[0].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheCostExecutionStats[1].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("added"),
			}), cacheCostNormalizationStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheCostNormalizationStats[1].Label)

			require.Equal(t, float64(baseCost*2), cacheCostNormalizationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheCostNormalizationStats[1].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheCostNormalizationStats[1].Label)

			require.Equal(t, float64(baseCost*2), cacheCostNormalizationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheCostNormalizationStats[1].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("added"),
			}), cacheCostValidationStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheCostValidationStats[1].Label)

			require.Equal(t, float64(baseCost*2), cacheCostValidationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheCostValidationStats[1].GetCounter().GetValue())

			// cache Key stats
			cacheKeyStatsMf := findMetricFamilyByName(cacheMetrics, "router_graphql_cache_keys_stats_total")
			cacheKeyExecutionStats := findMetricsByLabel(cacheKeyStatsMf, "cache_type", "plan")
			cacheKeyNormalizationStats := findMetricsByLabel(cacheKeyStatsMf, "cache_type", "query_normalization")
			cacheKeyValidationStats := findMetricsByLabel(cacheKeyStatsMf, "cache_type", "validation")

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("added"),
			}), cacheKeyExecutionStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheKeyExecutionStats[1].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("updated"),
			}), cacheKeyExecutionStats[2].Label)

			require.Equal(t, float64(2), cacheKeyExecutionStats[0].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheKeyExecutionStats[1].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheKeyExecutionStats[2].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("added"),
			}), cacheKeyNormalizationStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheKeyNormalizationStats[1].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("updated"),
			}), cacheKeyNormalizationStats[2].Label)

			require.Equal(t, float64(2), cacheKeyNormalizationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheKeyNormalizationStats[1].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheKeyNormalizationStats[2].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("added"),
			}), cacheKeyValidationStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheKeyValidationStats[1].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("updated"),
			}), cacheKeyValidationStats[2].Label)

			require.Equal(t, float64(2), cacheKeyValidationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheKeyValidationStats[1].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheKeyValidationStats[2].GetCounter().GetValue())

		})
	})

	t.Run("Validate key and cost eviction metrics with small validation cache config", func(t *testing.T) {
		t.Parallel()

		var (
			err            error
			metricFamilies []*io_prometheus_client.MetricFamily
			// The base cost to store any item in the cache with the current configuration
			baseCost int64 = 1
		)

		metricReaderFiltered := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(eec *config.EngineExecutionConfiguration) {
				eec.ValidationCacheSize = baseCost
			},
			MetricReader:       metricReaderFiltered,
			PrometheusRegistry: promRegistry,
			MetricOptions: testenv.MetricOptions{
				EnablePrometheusRouterCache: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			baseAttributes := []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("otel_scope_name"),
					Value: PointerOf("cosmo.router.cache"),
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
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
			}

			promRegistry.Unregister(collectors.NewGoCollector())

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

			metricFamilies, err = promRegistry.Gather()
			require.NoError(t, err)

			cacheMetrics := findCacheMetrics(metricFamilies)

			// cache max cost metrics

			cacheMaxCostMetricMf := findMetricFamilyByName(cacheMetrics, "router_graphql_cache_cost_max")
			cacheMaxCostExecution := findMetricsByLabel(cacheMaxCostMetricMf, "cache_type", "plan")
			cacheMaxCostNormalization := findMetricsByLabel(cacheMaxCostMetricMf, "cache_type", "query_normalization")
			cacheMaxCostValidation := findMetricsByLabel(cacheMaxCostMetricMf, "cache_type", "validation")

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}), cacheMaxCostExecution[0].Label)
			require.Equal(t, float64(1024), cacheMaxCostExecution[0].GetGauge().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}), cacheMaxCostNormalization[0].Label)
			require.Equal(t, float64(1024), cacheMaxCostNormalization[0].GetGauge().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}), cacheMaxCostValidation[0].Label)
			require.Equal(t, float64(baseCost), cacheMaxCostValidation[0].GetGauge().GetValue())

			// Check the cache request stats

			cacheRequestStatsMetricMf := findMetricFamilyByName(cacheMetrics, "router_graphql_cache_requests_stats_total")
			cacheRequestExecutionStats := findMetricsByLabel(cacheRequestStatsMetricMf, "cache_type", "plan")
			cacheRequestNormalizationStats := findMetricsByLabel(cacheRequestStatsMetricMf, "cache_type", "query_normalization")
			cacheRequestValidationStats := findMetricsByLabel(cacheRequestStatsMetricMf, "cache_type", "validation")

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("type"),
				Value: PointerOf("hits"),
			}), cacheRequestExecutionStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("type"),
				Value: PointerOf("misses"),
			}), cacheRequestExecutionStats[1].Label)

			require.Equal(t, float64(1), cacheRequestExecutionStats[0].GetCounter().GetValue())
			require.Equal(t, float64(2), cacheRequestExecutionStats[1].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("type"),
				Value: PointerOf("hits"),
			}), cacheRequestNormalizationStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("type"),
				Value: PointerOf("misses"),
			}), cacheRequestNormalizationStats[1].Label)

			require.Equal(t, float64(1), cacheRequestNormalizationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(2), cacheRequestNormalizationStats[1].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("type"),
				Value: PointerOf("hits"),
			}), cacheRequestValidationStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("type"),
				Value: PointerOf("misses"),
			}), cacheRequestValidationStats[1].Label)

			require.Equal(t, float64(1), cacheRequestValidationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(2), cacheRequestValidationStats[1].GetCounter().GetValue())

			// Cache cost stats
			cacheCostStatsMf := findMetricFamilyByName(cacheMetrics, "router_graphql_cache_cost_stats_total")
			cacheCostExecutionStats := findMetricsByLabel(cacheCostStatsMf, "cache_type", "plan")
			cacheCostNormalizationStats := findMetricsByLabel(cacheCostStatsMf, "cache_type", "query_normalization")
			cacheCostValidationStats := findMetricsByLabel(cacheCostStatsMf, "cache_type", "validation")

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("added"),
			}), cacheCostExecutionStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheCostExecutionStats[1].Label)

			require.Equal(t, float64(baseCost*2), cacheCostExecutionStats[0].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheCostExecutionStats[1].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("added"),
			}), cacheCostNormalizationStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheCostNormalizationStats[1].Label)

			require.Equal(t, float64(baseCost*2), cacheCostNormalizationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheCostNormalizationStats[1].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheCostNormalizationStats[1].Label)

			require.Equal(t, float64(baseCost*2), cacheCostNormalizationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheCostNormalizationStats[1].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("added"),
			}), cacheCostValidationStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheCostValidationStats[1].Label)

			require.Equal(t, float64(baseCost*2), cacheCostValidationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(baseCost), cacheCostValidationStats[1].GetCounter().GetValue())

			// cache Key stats
			cacheKeyStatsMf := findMetricFamilyByName(cacheMetrics, "router_graphql_cache_keys_stats_total")
			cacheKeyExecutionStats := findMetricsByLabel(cacheKeyStatsMf, "cache_type", "plan")
			cacheKeyNormalizationStats := findMetricsByLabel(cacheKeyStatsMf, "cache_type", "query_normalization")
			cacheKeyValidationStats := findMetricsByLabel(cacheKeyStatsMf, "cache_type", "validation")

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("added"),
			}), cacheKeyExecutionStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheKeyExecutionStats[1].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("plan"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("updated"),
			}), cacheKeyExecutionStats[2].Label)

			require.Equal(t, float64(2), cacheKeyExecutionStats[0].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheKeyExecutionStats[1].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheKeyExecutionStats[2].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("added"),
			}), cacheKeyNormalizationStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheKeyNormalizationStats[1].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("query_normalization"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("updated"),
			}), cacheKeyNormalizationStats[2].Label)

			require.Equal(t, float64(2), cacheKeyNormalizationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheKeyNormalizationStats[1].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheKeyNormalizationStats[2].GetCounter().GetValue())

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("added"),
			}), cacheKeyValidationStats[0].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("evicted"),
			}), cacheKeyValidationStats[1].Label)

			require.ElementsMatch(t, append(baseAttributes, &io_prometheus_client.LabelPair{
				Name:  PointerOf("cache_type"),
				Value: PointerOf("validation"),
			}, &io_prometheus_client.LabelPair{
				Name:  PointerOf("operation"),
				Value: PointerOf("updated"),
			}), cacheKeyValidationStats[2].Label)

			require.Equal(t, float64(2), cacheKeyValidationStats[0].GetCounter().GetValue())
			require.Equal(t, float64(1), cacheKeyValidationStats[1].GetCounter().GetValue())
			require.Equal(t, float64(0), cacheKeyValidationStats[2].GetCounter().GetValue())

		})
	})

	t.Run("Should export engine statistics to prometheus registry with websocket connection", func(t *testing.T) {
		t.Parallel()

		promRegistry := prometheus.NewRegistry()
		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			MetricOptions: testenv.MetricOptions{
				PrometheusEngineStatsOptions: testenv.EngineStatOptions{
					EnableSubscription: true,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			baseAttributes := []*io_prometheus_client.LabelPair{
				{
					Name:  PointerOf("otel_scope_name"),
					Value: PointerOf("cosmo.router.engine"),
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
					Name:  PointerOf("wg_router_version"),
					Value: PointerOf("dev"),
				},
			}

			promRegistry.Unregister(collectors.NewGoCollector())

			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { currentTime { unixTime timeStamp }}"}`),
			})

			require.NoError(t, err)

			xEnv.WaitForSubscriptionCount(1, time.Second*5)
			xEnv.WaitForMinMessagesSent(1, time.Second*5)
			promMetrics, err := promRegistry.Gather()

			require.NoError(t, err)
			mf := findEngineMetrics(promMetrics)
			require.Len(t, mf, 4)

			// Connection stats
			connectionMetrics := findMetricFamilyByName(mf, "router_engine_connections")
			subscriptionMetrics := findMetricFamilyByName(mf, "router_engine_subscriptions")
			triggerMetrics := findMetricFamilyByName(mf, "router_engine_triggers")
			messagesSentCounter := findMetricFamilyByName(mf, "router_engine_messages_sent_total")

			require.NotNil(t, connectionMetrics)
			require.NotNil(t, subscriptionMetrics)
			require.NotNil(t, triggerMetrics)
			require.NotNil(t, messagesSentCounter)

			// We only provide base attributes here. In the testing scenario we don't have any additional attributes
			// that can increase the cardinality.
			require.Len(t, connectionMetrics.Metric, 1)
			require.Equal(t, float64(1), connectionMetrics.Metric[0].GetGauge().GetValue())
			require.ElementsMatch(t, baseAttributes, connectionMetrics.Metric[0].Label)

			require.Len(t, subscriptionMetrics.Metric, 1)
			require.Equal(t, float64(1), subscriptionMetrics.Metric[0].GetGauge().GetValue())
			require.ElementsMatch(t, baseAttributes, subscriptionMetrics.Metric[0].Label)

			require.Len(t, triggerMetrics.Metric, 1)
			require.Equal(t, float64(1), triggerMetrics.Metric[0].GetGauge().GetValue())
			require.ElementsMatch(t, baseAttributes, triggerMetrics.Metric[0].Label)

			require.Len(t, messagesSentCounter.Metric, 1)
			require.GreaterOrEqual(t, messagesSentCounter.Metric[0].GetCounter().GetValue(), float64(1))
			require.ElementsMatch(t, baseAttributes, messagesSentCounter.Metric[0].Label)

			// close the connection
			require.NoError(t, conn.Close())

			xEnv.WaitForSubscriptionCount(0, time.Second*5)

			promMetrics, err = promRegistry.Gather()
			require.NoError(t, err)
			mf = findEngineMetrics(promMetrics)
			require.Len(t, mf, 4)

			connectionMetrics = findMetricFamilyByName(mf, "router_engine_connections")
			subscriptionMetrics = findMetricFamilyByName(mf, "router_engine_subscriptions")
			triggerMetrics = findMetricFamilyByName(mf, "router_engine_triggers")

			require.NotNil(t, connectionMetrics)
			require.NotNil(t, subscriptionMetrics)
			require.NotNil(t, triggerMetrics)
			require.NotNil(t, messagesSentCounter)

			require.Len(t, connectionMetrics.Metric, 1)
			require.Equal(t, float64(0), connectionMetrics.Metric[0].GetGauge().GetValue())
			require.ElementsMatch(t, baseAttributes, connectionMetrics.Metric[0].Label)

			require.Len(t, subscriptionMetrics.Metric, 1)
			require.Equal(t, float64(0), subscriptionMetrics.Metric[0].GetGauge().GetValue())
			require.ElementsMatch(t, baseAttributes, subscriptionMetrics.Metric[0].Label)

			require.Len(t, triggerMetrics.Metric, 1)
			require.Equal(t, float64(0), triggerMetrics.Metric[0].GetGauge().GetValue())
			require.ElementsMatch(t, baseAttributes, triggerMetrics.Metric[0].Label)

		})

	})

	t.Run("Collect and export OTEL metrics in respect to custom attributes / from JWT claim", func(t *testing.T) {
		t.Parallel()

		const claimKey = "customKey"
		const claimVal = "customClaimValue"

		authenticators, authServer := ConfigureAuth(t)
		exporter := tracetest.NewInMemoryExporter(t)
		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			TraceExporter:      exporter,
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
			CustomMetricAttributes: []config.CustomAttribute{
				{
					Key: claimKey,
					ValueFrom: &config.CustomDynamicAttribute{
						Expression: "request.auth.claims.custom_value." + claimKey,
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(map[string]any{
				"scope": "read:employee read:private",
				"custom_value": map[string]string{
					claimKey: claimVal,
				},
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: header,
				Query:  `query myQuery { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			requestTotal := findMetricFamilyByName(mf, "router_http_requests_total")
			requestTotalMetrics := requestTotal.GetMetric()

			require.Len(t, requestTotalMetrics, 2)
			require.Len(t, requestTotalMetrics[0].Label, 12)
			require.Len(t, requestTotalMetrics[1].Label, 14)

			requestsInFlight := findMetricFamilyByName(mf, "router_http_requests_in_flight")
			requestsInFlightMetrics := requestsInFlight.GetMetric()

			require.Len(t, requestsInFlightMetrics, 2)
			require.Len(t, requestsInFlightMetrics[0].Label, 8)
			require.Len(t, requestsInFlightMetrics[1].Label, 13)

			// the request toward the subgraph has no authorization header
			require.NotContains(t, requestsInFlightMetrics[0].Label, &io_prometheus_client.LabelPair{
				Name:  PointerOf(claimKey),
				Value: PointerOf(claimVal),
			})

			require.Contains(t, requestsInFlightMetrics[1].Label, &io_prometheus_client.LabelPair{
				Name:  PointerOf(claimKey),
				Value: PointerOf(claimVal),
			})

			requestDuration := findMetricFamilyByName(mf, "router_http_request_duration_milliseconds")
			requestDurationMetrics := requestDuration.GetMetric()

			require.Len(t, requestDurationMetrics, 2)
			require.Len(t, requestDurationMetrics[0].Label, 12)
			require.Len(t, requestDurationMetrics[1].Label, 14)

			require.Contains(t, requestDurationMetrics[0].Label, &io_prometheus_client.LabelPair{
				Name:  PointerOf(claimKey),
				Value: PointerOf(claimVal),
			})

			require.Contains(t, requestDurationMetrics[1].Label, &io_prometheus_client.LabelPair{
				Name:  PointerOf(claimKey),
				Value: PointerOf(claimVal),
			})

			responseContentLength := findMetricFamilyByName(mf, "router_http_response_content_length_total")
			responseContentLengthMetrics := responseContentLength.GetMetric()

			require.Len(t, responseContentLengthMetrics, 2)
			require.Len(t, responseContentLengthMetrics[0].Label, 12)
			require.Len(t, responseContentLengthMetrics[1].Label, 14)

			require.Contains(t, responseContentLengthMetrics[0].Label, &io_prometheus_client.LabelPair{
				Name:  PointerOf(claimKey),
				Value: PointerOf(claimVal),
			})

			require.Contains(t, responseContentLengthMetrics[1].Label, &io_prometheus_client.LabelPair{
				Name:  PointerOf(claimKey),
				Value: PointerOf(claimVal),
			})

		})
	})

}

func TestPrometheusWithModule(t *testing.T) {
	t.Parallel()

	metricReader := metric.NewManualReader()
	promRegistry := prometheus.NewRegistry()

	cfg := config.Config{
		Graph: config.Graph{},
		Modules: map[string]interface{}{
			"myModule": module.MyModule{
				Value: 1,
			},
		},
	}

	testenv.Run(t, &testenv.Config{
		MetricReader:       metricReader,
		PrometheusRegistry: promRegistry,
		RouterOptions: []core.Option{
			core.WithModulesConfig(cfg.Modules),
			core.WithCustomModules(&module.MyModule{}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		t.Helper()

		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query:         `query MyQuery { employees { id } }`,
			OperationName: json.RawMessage(`"MyQuery"`),
		})
		require.NoError(t, err)
		assert.Equal(t, 200, res.Response.StatusCode)
		assert.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)

		mf, err := promRegistry.Gather()
		require.NoError(t, err)

		requestDuration := findMetricFamilyByName(mf, "router_http_request_duration_milliseconds")
		requestDurationMetrics := requestDuration.GetMetric()

		require.Len(t, requestDurationMetrics, 2)

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
				Value: PointerOf("MyQuery"),
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
				Value: PointerOf("MyQuery"),
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
	})

	t.Run("Verify router_info attributes", func(t *testing.T) {
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

			routerConfigVersion := findMetricFamilyByName(mf, "router_info")
			routerConfigVersionMetrics := routerConfigVersion.GetMetric()

			expectedMainConfig := xEnv.RouterConfigVersionMain()
			mainBase := routerConfigVersionMetrics[0]
			require.Len(t, mainBase.Label, 4)
			require.Equal(t, expectedMainConfig, *mainBase.Label[2].Value)
			require.Equal(t, 1.0, *mainBase.Gauge.Value)
			require.Equal(t, "dev", *mainBase.Label[3].Value)

			expectedFeatureFlagConfig := xEnv.RouterConfigVersionMyFF()
			featureFlag := routerConfigVersionMetrics[1]
			require.Len(t, featureFlag.Label, 5)
			require.Equal(t, "myff", *featureFlag.Label[2].Value)
			require.Equal(t, expectedFeatureFlagConfig, *featureFlag.Label[3].Value)
			require.Equal(t, 1.0, *featureFlag.Gauge.Value)
			require.Equal(t, "dev", *featureFlag.Label[4].Value)
		})
	})

	t.Run("Verify router config version exists when adding a custom router_config_version metric", func(t *testing.T) {
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
					Key: "wg.router.config.version",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: "router_config_version",
					},
				},
			},
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

func findMetricsByLabel(mf *io_prometheus_client.MetricFamily, labelName, labelValue string) []*io_prometheus_client.Metric {
	var metrics []*io_prometheus_client.Metric
	for _, m := range mf.Metric {
		for _, label := range m.Label {
			if label.GetName() == labelName && label.GetValue() == labelValue {
				metrics = append(metrics, m)
			}
		}
	}

	return metrics
}

func findMetricsWithPrefix(mf []*io_prometheus_client.MetricFamily, prefix string) []*io_prometheus_client.MetricFamily {
	var cacheMetrics []*io_prometheus_client.MetricFamily
	for _, m := range mf {
		if strings.HasPrefix(m.GetName(), prefix) {
			cacheMetrics = append(cacheMetrics, m)
		}
	}
	return cacheMetrics
}

func findCacheMetrics(mf []*io_prometheus_client.MetricFamily) []*io_prometheus_client.MetricFamily {
	return findMetricsWithPrefix(mf, "router_graphql_cache_")
}

func findEngineMetrics(mf []*io_prometheus_client.MetricFamily) []*io_prometheus_client.MetricFamily {
	return findMetricsWithPrefix(mf, "router_engine_")
}

func PointerOf[T any](t T) *T {
	return &t
}
