package telemetry

import (
	"context"
	"github.com/stretchr/testify/require"
	integration "github.com/wundergraph/cosmo/router-tests"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/metric/metricdata/metricdatatest"
	"testing"
)

func TestConnectionMetrics(t *testing.T) {
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

			scopeMetric := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.connection")
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
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.connection")

			hostAttribute := getHost(t, scopeMetric, 0)
			require.Len(t, scopeMetric.Metrics, 5)

			t.Run("verify connection total exists", func(t *testing.T) {
				expected := metricdata.Metrics{
					Name:        "router.connection.total",
					Description: "Total number of connections with reused attribute",
					Unit:        "",
					Data: metricdata.Sum[int64]{
						Temporality: metricdata.CumulativeTemporality,
						IsMonotonic: true,
						DataPoints: []metricdata.DataPoint[int64]{
							{
								Value: 1,
								Attributes: attribute.NewSet(
									otel.WgHost.String(hostAttribute),
									otel.WgConnReused.Bool(false),
								),
							},
						},
					},
				}
				metricdatatest.AssertEqual(t, expected, scopeMetric.Metrics[0], metricdatatest.IgnoreTimestamp())
			})

			t.Run("verify dial duration", func(t *testing.T) {
				actualHistogram, ok := scopeMetric.Metrics[1].Data.(metricdata.Histogram[float64])
				require.True(t, ok)
				require.Greater(t, actualHistogram.DataPoints[0].Sum, 0.0)

				expected := metricdata.Metrics{
					Name:        "router.connection.dial_duration",
					Description: "TCP dial duration",
					Unit:        "s",
					Data: metricdata.Histogram[float64]{
						Temporality: metricdata.CumulativeTemporality,
						DataPoints: []metricdata.HistogramDataPoint[float64]{
							{
								Attributes: attribute.NewSet(
									otel.WgHost.String(hostAttribute),
								),
							},
						},
					},
				}

				metricdatatest.AssertEqual(t, expected, scopeMetric.Metrics[1], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			})

			t.Run("verify connection total duration", func(t *testing.T) {
				actualHistogram, ok := scopeMetric.Metrics[2].Data.(metricdata.Histogram[float64])
				require.True(t, ok)
				require.Greater(t, actualHistogram.DataPoints[0].Sum, 0.0)

				expected := metricdata.Metrics{
					Name:        "router.connection.total_duration",
					Description: "Total connection duration",
					Unit:        "s",
					Data: metricdata.Histogram[float64]{
						Temporality: metricdata.CumulativeTemporality,
						DataPoints: []metricdata.HistogramDataPoint[float64]{
							{
								Attributes: attribute.NewSet(
									otel.WgHost.String(hostAttribute),
									otel.WgDnsLookup.Bool(false),
									otel.WgTlsHandshake.Bool(false),
								),
							},
						},
					},
				}

				metricdatatest.AssertEqual(t, expected, scopeMetric.Metrics[2], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			})

			t.Run("verify connection acquire duration", func(t *testing.T) {
				actualHistogram, ok := scopeMetric.Metrics[3].Data.(metricdata.Histogram[float64])
				require.True(t, ok)
				require.Greater(t, actualHistogram.DataPoints[0].Sum, 0.0)

				expected := metricdata.Metrics{
					Name:        "router.connection.acquire_duration",
					Description: "Connection acquire duration",
					Unit:        "s",
					Data: metricdata.Histogram[float64]{
						Temporality: metricdata.CumulativeTemporality,
						DataPoints: []metricdata.HistogramDataPoint[float64]{
							{
								Attributes: attribute.NewSet(
									otel.WgHost.String(hostAttribute),
								),
							},
						},
					},
				}

				metricdatatest.AssertEqual(t, expected, scopeMetric.Metrics[3], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			})

			t.Run("verify connections active", func(t *testing.T) {
				expected := metricdata.Metrics{
					Name:        "router.connection.active",
					Description: "Connections active",
					Unit:        "",
					Data: metricdata.Gauge[int64]{
						DataPoints: []metricdata.DataPoint[int64]{
							{
								Attributes: attribute.NewSet(
									otel.WgHost.String(hostAttribute),
								),
								Value: 1,
							},
						},
					},
				}

				metricdatatest.AssertEqual(t, expected, scopeMetric.Metrics[4], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			})
		})
	})

	t.Run("validate connection reuse on multiple connections", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			MetricOptions: testenv.MetricOptions{
				EnableOTLPConnectionMetrics: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			requestCount := 20
			for i := 0; i < requestCount; i++ {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id } }`,
				})
			}

			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.connection")

			hostAttribute := getHost(t, scopeMetric, 0)

			t.Run("verify connection total exists", func(t *testing.T) {
				// The connections after the first one should be reused
				expectedReusedConnections := int64(requestCount - 1)

				expected := metricdata.Metrics{
					Name:        "router.connection.total",
					Description: "Total number of connections with reused attribute",
					Unit:        "",
					Data: metricdata.Sum[int64]{
						Temporality: metricdata.CumulativeTemporality,
						IsMonotonic: true,
						DataPoints: []metricdata.DataPoint[int64]{
							{
								Value: 1,
								Attributes: attribute.NewSet(
									otel.WgHost.String(hostAttribute),
									otel.WgConnReused.Bool(false),
								),
							},
							{
								Value: expectedReusedConnections,
								Attributes: attribute.NewSet(
									otel.WgHost.String(hostAttribute),
									otel.WgConnReused.Bool(true),
								),
							},
						},
					},
				}
				metricdatatest.AssertEqual(t, expected, scopeMetric.Metrics[0], metricdatatest.IgnoreTimestamp())
			})
		})
	})
}

// Since we cannot really predict the host and port we use this to get the host
func getHost(t *testing.T, scopeMetric metricdata.ScopeMetrics, index int) string {
	t.Helper()

	actualDataPoint := scopeMetric.Metrics[index].Data.(metricdata.Sum[int64]).DataPoints[0]
	hostAttribute, retrieved := actualDataPoint.Attributes.Get(0)
	require.True(t, retrieved)

	require.True(t, hostAttribute.Valid())

	return hostAttribute.Value.AsString()
}
