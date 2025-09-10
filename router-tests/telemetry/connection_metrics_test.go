package telemetry

import (
	"context"
	"testing"
	"time"

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
			excludePortFromMetrics(t, rm.ScopeMetrics)

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
								),
								Value: 1,
							},
							{
								Attributes: attribute.NewSet(
									otel.ServerAddress.String("127.0.0.1"),
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
									otel.WgClientReusedConnection.Bool(false),
									otel.WgSubgraphName.String("employees"),
								),
							},
							{
								Attributes: attribute.NewSet(
									otel.ServerAddress.String("127.0.0.1"),
									otel.WgClientReusedConnection.Bool(true),
									otel.WgSubgraphName.String("employees"),
								),
							},
							{
								Attributes: attribute.NewSet(
									otel.ServerAddress.String("127.0.0.1"),
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
			Subgraphs: map[string]config.GlobalSubgraphRequestRule{
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
			excludePortFromMetrics(t, rm.ScopeMetrics)

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
								),
								Value: 1,
							},
							{
								Attributes: attribute.NewSet(
									otel.ServerAddress.String("127.0.0.1"),
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

	t.Run("validate recording connection stats for subscriptions", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			MetricOptions: testenv.MetricOptions{
				EnableOTLPConnectionMetrics: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			defer func() {
				_ = conn.Close()
			}()

			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { countEmp2(max: 2, intervalMilliseconds: 100) }"}`),
			})
			require.NoError(t, err)

			var msg testenv.WebSocketMessage
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "next", msg.Type)
			require.Equal(t, `{"data":{"countEmp2":0}}`, string(msg.Payload))

			rm := metricdata.ResourceMetrics{}
			err = metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			scopeMetric := *integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.connections")
			excludePortFromMetrics(t, rm.ScopeMetrics)

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
								),
								Value: 1,
							},
						},
					},
				}

				metricdatatest.AssertEqual(t, expected, metrics, metricdatatest.IgnoreTimestamp())
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
									otel.WgClientReusedConnection.Bool(false),
									otel.WgSubgraphName.String("employees"),
								),
							},
						},
					},
				}

				metricdatatest.AssertEqual(t, expected, metrics, metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			})
		})
	})
}

// Checking for the port introduced flakiness in the tests, as we cannot really map the correct port to the datapoint.
// Instead we should exclude the port from the assertions as the otel package also
// doesn't support checking only for the existence of an attribute in their assertions.
func excludePortFromMetrics(t *testing.T, scopeMetrics []metricdata.ScopeMetrics) {
	t.Helper()
	for _, sm := range scopeMetrics {
		for _, metric := range sm.Metrics {
			data := metric.Data

			switch d := data.(type) {
			case metricdata.Histogram[float64]:
				for i, dp := range d.DataPoints {
					attrs, _ := dp.Attributes.Filter(func(attr attribute.KeyValue) bool {
						return attr.Key != otel.ServerPort
					})

					d.DataPoints[i].Attributes = attrs
				}
			case metricdata.Gauge[int64]:
				for i, dp := range d.DataPoints {
					attrs, _ := dp.Attributes.Filter(func(attr attribute.KeyValue) bool {
						return attr.Key != otel.ServerPort
					})

					d.DataPoints[i].Attributes = attrs
				}
			}
		}
	}

}
