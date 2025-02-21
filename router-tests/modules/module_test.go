package module_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"go.uber.org/zap/zapcore"

	"github.com/wundergraph/cosmo/router/cmd/custom/module"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"

	"github.com/prometheus/client_golang/prometheus"
	io_prometheus_client "github.com/prometheus/client_model/go"
	"go.opentelemetry.io/otel/sdk/metric"
)

func TestModuleSetCustomHeader(t *testing.T) {
	cfg := config.Config{
		Graph: config.Graph{},
		Modules: map[string]interface{}{
			"myModule": module.MyModule{
				Value: 1,
			},
		},
	}

	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{
			core.WithModulesConfig(cfg.Modules),
			core.WithCustomModules(&module.MyModule{}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query:         `query MyQuery { employees { id } }`,
			OperationName: json.RawMessage(`"MyQuery"`),
		})
		require.NoError(t, err)

		assert.Equal(t, 200, res.Response.StatusCode)

		assert.JSONEq(t, res.Body, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`)
	})
}

func TestModuleSetCustomHeaderCheckMetrics(t *testing.T) {
	t.Parallel()

	exporter := tracetest.NewInMemoryExporter(t)
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
		TraceExporter:      exporter,
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

func PointerOf[T any](t T) *T {
	return &t
}

func TestCustomModuleLogs(t *testing.T) {
	cfg := config.Config{
		Graph: config.Graph{},
		Modules: map[string]interface{}{
			"myModule": module.MyModule{
				Value: 1,
			},
		},
	}

	exporter := tracetest.NewInMemoryExporter(t)

	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{
			core.WithModulesConfig(cfg.Modules),
			core.WithCustomModules(&module.MyModule{}),
		},
		LogObservation: testenv.LogObservationConfig{
			Enabled:  true,
			LogLevel: zapcore.InfoLevel,
		},
		TraceExporter: exporter,
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query:         `query MyQuery { employees { id } }`,
			OperationName: json.RawMessage(`"MyQuery"`),
		})
		require.NoError(t, err)

		assert.Equal(t, 200, res.Response.StatusCode)
		assert.JSONEq(t, res.Body, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`)

		requestLog := xEnv.Observer().FilterMessage("Test custom module logs")
		assert.Equal(t, requestLog.Len(), 1)
		requestContext := requestLog.All()[0].ContextMap()

		expectedKeys := []string{
			"trace_id", "request_id", "hostname", "pid",
		}

		for _, key := range expectedKeys {
			assert.NotEmpty(t, requestContext[key])
		}
	})
}
