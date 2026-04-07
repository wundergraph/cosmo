package integration

import (
	"context"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	io_prometheus_client "github.com/prometheus/client_model/go"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"go.opentelemetry.io/otel/sdk/metric"
	"google.golang.org/grpc"
)

func requireSubgraphDurationHistogram(
	t *testing.T,
	metricFamilies []*io_prometheus_client.MetricFamily,
	subgraphName string,
) *io_prometheus_client.Histogram {
	t.Helper()

	requestDuration := findMetricFamilyByName(metricFamilies, "router_http_request_duration_milliseconds")
	require.NotNil(t, requestDuration)

	durationMetrics := findMetricsByLabel(requestDuration, "wg_subgraph_name", subgraphName)
	require.Len(t, durationMetrics, 1)

	histogram := durationMetrics[0].GetHistogram()
	require.NotNil(t, histogram)
	require.EqualValues(t, 1, histogram.GetSampleCount())

	return histogram
}

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
			Query: `query TestParallelSubgraphDurations {
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

		metricFamilies, err := promRegistry.Gather()
		require.NoError(t, err)

		employeesDurationMs := requireSubgraphDurationHistogram(t, metricFamilies, "employees").GetSampleSum()
		productsDurationMs := requireSubgraphDurationHistogram(t, metricFamilies, "products").GetSampleSum()

		require.GreaterOrEqual(t, productsDurationMs, float64(productsDelay.Milliseconds()))
		require.Less(t, employeesDurationMs, float64(productsDelay.Milliseconds())/2)
	})
}

func TestPrometheusParallelHTTPAndGRPCSubgraphRequestDurationMetrics(t *testing.T) {
	t.Parallel()

	const projectsDelay = 900 * time.Millisecond

	metricReader := metric.NewManualReader()
	promRegistry := prometheus.NewRegistry()

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
		EnableGRPC:               true,
		MetricReader:             metricReader,
		PrometheusRegistry:       promRegistry,
		Subgraphs: testenv.SubgraphsConfig{
			Projects: testenv.SubgraphConfig{
				GRPCInterceptor: func(
					ctx context.Context,
					req any,
					_ *grpc.UnaryServerInfo,
					handler grpc.UnaryHandler,
				) (any, error) {
					time.Sleep(projectsDelay)
					return handler(ctx, req)
				},
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `query TestParallelHTTPAndGRPCSubgraphDurations {
				employees {
					id
				}
				projects {
					id
				}
			}`,
		})

		require.Contains(t, res.Body, `"employees":[`)
		require.Contains(t, res.Body, `"projects":[`)

		metricFamilies, err := promRegistry.Gather()
		require.NoError(t, err)

		employeesDurationMs := requireSubgraphDurationHistogram(t, metricFamilies, "employees").GetSampleSum()
		projectsDurationMs := requireSubgraphDurationHistogram(t, metricFamilies, "projects").GetSampleSum()

		require.GreaterOrEqual(t, projectsDurationMs, float64(projectsDelay.Milliseconds()))
		require.Less(t, employeesDurationMs, float64(projectsDelay.Milliseconds())/2)
	})
}
