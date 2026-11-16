package module_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	io_prometheus_client "github.com/prometheus/client_model/go"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	custommetrics "github.com/wundergraph/cosmo/router-tests/modules/custom-metrics"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutils"
	"github.com/wundergraph/cosmo/router/core"
)

func TestCustomModuleMetrics(t *testing.T) {
	t.Parallel()

	metricReader := metric.NewManualReader()
	promRegistry := prometheus.NewRegistry()

	testenv.Run(t, &testenv.Config{
		MetricReader:       metricReader,
		PrometheusRegistry: promRegistry,
		RouterOptions: []core.Option{
			core.WithCustomModules(&custommetrics.CustomMetricsModule{}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		query := testenv.GraphQLRequest{Query: `{ employees { id } }`}

		// Counted: the tenant header is set.
		query.Header = http.Header{"X-Tenant": []string{"acme"}}
		xEnv.MakeGraphQLRequestOK(query)
		xEnv.MakeGraphQLRequestOK(query)

		// Not counted: no tenant on the request context.
		query.Header = nil
		xEnv.MakeGraphQLRequestOK(query)

		t.Run("prometheus", func(t *testing.T) {
			mfs, err := promRegistry.Gather()
			require.NoError(t, err)

			var family *io_prometheus_client.MetricFamily
			for _, mf := range mfs {
				if mf.GetName() == "module_subgraph_requests_total" {
					family = mf
				}
			}
			require.NotNil(t, family, "custom module metric is not served by the router registry")
			require.Len(t, family.GetMetric(), 1)

			m := family.GetMetric()[0]
			labels := map[string]string{}
			for _, l := range m.GetLabel() {
				labels[l.GetName()] = l.GetValue()
			}
			require.Equal(t, "employees", labels["subgraph"])
			require.Equal(t, "acme", labels["tenant"])
			require.Equal(t, float64(2), m.GetCounter().GetValue())
		})

		t.Run("otlp", func(t *testing.T) {
			rm := metricdata.ResourceMetrics{}
			require.NoError(t, metricReader.Collect(context.Background(), &rm))

			scope := testutils.GetMetricScopeByName(rm.ScopeMetrics, custommetrics.MeterName)
			require.NotNil(t, scope)
			m := testutils.GetMetricByName(scope, custommetrics.CounterName)
			require.NotNil(t, m)

			sum, ok := m.Data.(metricdata.Sum[int64])
			require.True(t, ok)
			require.Len(t, sum.DataPoints, 1)
			dp := sum.DataPoints[0]
			require.Equal(t, int64(2), dp.Value)
			require.Equal(t, attribute.NewSet(
				attribute.String("subgraph", "employees"),
				attribute.String("tenant", "acme"),
			), dp.Attributes)
		})
	})
}
