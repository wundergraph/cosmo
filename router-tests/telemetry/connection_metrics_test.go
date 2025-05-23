package telemetry

import (
	"context"
	"github.com/stretchr/testify/require"
	integration "github.com/wundergraph/cosmo/router-tests"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/metric/metricdata/metricdatatest"
	"testing"
	"time"
)

func TestFlakyConnectionMetrics(t *testing.T) {
	t.Parallel()

	t.Run("validate router connection metrics are not present by default", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			scopeMetric := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.connections")
			require.Nil(t, scopeMetric)
		})
	})

	t.Run("validate router connection metrics are present when enabled", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			MetricOptions: testenv.MetricOptions{
				EnableOTLPConnectionMetrics: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})

			time.Sleep(1 * time.Second)

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id isAvailable } }`,
			})
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.connections")

			require.Len(t, scopeMetric.Metrics, 3)

			t.Run("verify max connections", func(t *testing.T) {
				expected := metricdata.Metrics{
					Name:        "router.http.client.max_connections",
					Description: "Total number of max connections per subgraph",
					Unit:        "",
					Data: metricdata.Gauge[int64]{
						DataPoints: []metricdata.DataPoint[int64]{
							{},
						},
					},
				}
				metricdatatest.AssertEqual(t, expected, scopeMetric.Metrics[0], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			})

			t.Run("verify connections active", func(t *testing.T) {
				metrics := scopeMetric.Metrics[2]

				expected := metricdata.Metrics{
					Name:        "router.http.client.active_connections",
					Description: "Connections active",
					Unit:        "",
					Data: metricdata.Gauge[int64]{
						DataPoints: []metricdata.DataPoint[int64]{
							{
								Attributes: attribute.NewSet(
									otel.ServerAddress.String("127.0.0.1"),
									otel.ServerPort.String(getPort(t, metrics, 0, "gauge")),
								),
								Value: 1,
							},
							{
								Attributes: attribute.NewSet(
									otel.ServerAddress.String("127.0.0.1"),
									otel.ServerPort.String(getPort(t, metrics, 1, "gauge")),
								),
								Value: 1,
							},
						},
					},
				}

				metricdatatest.AssertEqual(t, expected, metrics, metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			})

			t.Run("verify connection total duration", func(t *testing.T) {
				metrics := scopeMetric.Metrics[1]

				actualHistogram, ok := metrics.Data.(metricdata.Histogram[float64])
				require.True(t, ok)
				require.Greater(t, actualHistogram.DataPoints[0].Sum, 0.0)

				expected := metricdata.Metrics{
					Name:        "router.http.client.connection.acquire_duration",
					Description: "Total connection acquire duration",
					Unit:        "ms",
					Data: metricdata.Histogram[float64]{
						Temporality: metricdata.CumulativeTemporality,
						DataPoints: []metricdata.HistogramDataPoint[float64]{
							{
								Attributes: attribute.NewSet(
									otel.ServerAddress.String("127.0.0.1"),
									otel.ServerPort.String(getPort(t, metrics, 0, "")),
									otel.WgClientReusedConnection.Bool(false),
									otel.WgSubgraphName.String("employees"),
								),
							},
							{
								Attributes: attribute.NewSet(
									otel.ServerAddress.String("127.0.0.1"),
									otel.ServerPort.String(getPort(t, metrics, 1, "")),
									otel.WgClientReusedConnection.Bool(true),
									otel.WgSubgraphName.String("employees"),
								),
							},
							{
								Attributes: attribute.NewSet(
									otel.ServerAddress.String("127.0.0.1"),
									otel.ServerPort.String(getPort(t, metrics, 2, "")),
									otel.WgClientReusedConnection.Bool(false),
									otel.WgSubgraphName.String("availability"),
								),
							},
						},
					},
				}

				metricdatatest.AssertEqual(t, expected, metrics, metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			})

		})
	})

	t.Run("verify custom subgraph transport configs", func(t *testing.T) {
		t.Parallel()

		trafficConfig := config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				RequestTimeout: integration.ToPtr(200 * time.Millisecond),
			},
			Subgraphs: map[string]*config.GlobalSubgraphRequestRule{
				"availability": {
					RequestTimeout: integration.ToPtr(300 * time.Millisecond),
				},
			},
		}

		metricReader := metric.NewManualReader()
		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			MetricOptions: testenv.MetricOptions{
				EnableOTLPConnectionMetrics: true,
			},
			RouterOptions: []core.Option{
				core.WithSubgraphTransportOptions(
					core.NewSubgraphTransportOptions(trafficConfig)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id isAvailable } }`,
			})
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.connections")

			require.Len(t, scopeMetric.Metrics, 3)

			t.Run("verify max connections", func(t *testing.T) {
				expected := metricdata.Metrics{
					Name:        "router.http.client.max_connections",
					Description: "Total number of max connections per subgraph",
					Unit:        "",
					Data: metricdata.Gauge[int64]{
						DataPoints: []metricdata.DataPoint[int64]{
							{},
							{
								Attributes: attribute.NewSet(
									otel.WgSubgraphName.String("availability"),
								),
							},
						},
					},
				}
				metricdatatest.AssertEqual(t, expected, scopeMetric.Metrics[0], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			})

			t.Run("verify connections active", func(t *testing.T) {
				metrics := scopeMetric.Metrics[2]

				expected := metricdata.Metrics{
					Name:        "router.http.client.active_connections",
					Description: "Connections active",
					Unit:        "",
					Data: metricdata.Gauge[int64]{
						DataPoints: []metricdata.DataPoint[int64]{
							{
								Attributes: attribute.NewSet(
									otel.ServerAddress.String("127.0.0.1"),
									otel.ServerPort.String(getPort(t, metrics, 0, "gauge")),
								),
								Value: 1,
							},
							{
								Attributes: attribute.NewSet(
									otel.ServerAddress.String("127.0.0.1"),
									otel.ServerPort.String(getPort(t, metrics, 1, "gauge")),
									otel.WgSubgraphName.String("availability"),
								),
								Value: 1,
							},
						},
					},
				}

				metricdatatest.AssertEqual(t, expected, metrics, metricdatatest.IgnoreTimestamp())
			})
		})
	})

}

// Since we cannot really predict the host and port we use this to get the host
func getPort(t *testing.T, metric metricdata.Metrics, dataPointIndex int, typeName string) string {
	t.Helper()

	if typeName == "" {
		typeName = "histogram"
	}

	var hostAttribute attribute.KeyValue
	var retrieved bool

	switch typeName {
	case "histogram":
		histogramDp := metric.Data.(metricdata.Histogram[float64]).DataPoints[dataPointIndex]
		hostAttribute, retrieved = histogramDp.Attributes.Get(1)
	case "gauge":
		actualDp := metric.Data.(metricdata.Gauge[int64]).DataPoints[dataPointIndex]
		hostAttribute, retrieved = actualDp.Attributes.Get(1)
	}

	require.True(t, retrieved)
	require.True(t, hostAttribute.Valid())

	return hostAttribute.Value.AsString()
}
