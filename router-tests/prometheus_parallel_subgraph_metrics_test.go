package integration

import (
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"go.opentelemetry.io/otel/sdk/metric"
)

func TestPrometheusParallelSubgraphRequestDurationMetrics(t *testing.T) {
	t.Parallel()

	const productsDelay = 1200 * time.Millisecond

	metricReader := metric.NewManualReader()
	promRegistry := prometheus.NewRegistry()

	testenv.Run(t, &testenv.Config{
		MetricReader:       metricReader,
		PrometheusRegistry: promRegistry,
		Subgraphs: testenv.SubgraphsConfig{
			Products: testenv.SubgraphConfig{
				Delay: productsDelay,
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `query TestParallel2 {
				employee(id: 1) {
					id
				}
				productTypes {
					... on Consultancy {
						name
					}
					... on Cosmo {
						name
					}
				}
			}`,
		})

		require.Contains(t, res.Body, `"employee":{"id":1}`)
		require.Contains(t, res.Body, `"productTypes"`)

		metricFamily, err := promRegistry.Gather()
		require.NoError(t, err)

		requestDuration := findMetricFamilyByName(metricFamily, "router_http_request_duration_milliseconds")
		require.NotNil(t, requestDuration)

		employeesDurationMetrics := findMetricsByLabel(requestDuration, "wg_subgraph_name", "employees")
		require.Len(t, employeesDurationMetrics, 1)

		productsDurationMetrics := findMetricsByLabel(requestDuration, "wg_subgraph_name", "products")
		require.Len(t, productsDurationMetrics, 1)

		employeesHistogram := employeesDurationMetrics[0].GetHistogram()
		productsHistogram := productsDurationMetrics[0].GetHistogram()
		require.NotNil(t, employeesHistogram)
		require.NotNil(t, productsHistogram)
		require.EqualValues(t, 1, employeesHistogram.GetSampleCount())
		require.EqualValues(t, 1, productsHistogram.GetSampleCount())

		employeesDurationMs := employeesHistogram.GetSampleSum()
		productsDurationMs := productsHistogram.GetSampleSum()

		require.GreaterOrEqual(t, productsDurationMs, float64(productsDelay.Milliseconds()))
		require.Less(t, employeesDurationMs, float64(productsDelay.Milliseconds()))
	})
}
