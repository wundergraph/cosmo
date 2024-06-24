package testutils

import (
	"context"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/metric/metricdata/metricdatatest"
	"testing"
)

func RequireMetricsToContain(t *testing.T, metricReader metric.Reader, expectedMetric metricdata.Metrics) {
	var rm metricdata.ResourceMetrics
	err := metricReader.Collect(context.Background(), &rm)
	require.NoError(t, err)
	require.Equal(t, 1, len(rm.ScopeMetrics), "expected ScopeMetrics to exist")
	require.GreaterOrEqualf(t, len(rm.ScopeMetrics[0].Metrics), 1, "expected at least 1 metric, got %d", len(rm.ScopeMetrics[0].Metrics))
	receivedMetric := FindScopeMetricByName(rm, expectedMetric.Name)
	require.NotNil(t, receivedMetric, "%s metric wasn't found", expectedMetric.Name)
	metricdatatest.AssertEqual(t, expectedMetric, *receivedMetric, metricdatatest.IgnoreTimestamp())

}

func GetSubscriptionCountMetric(val int64) metricdata.Metrics {
	return metricdata.Metrics{
		Name:        "router.graph.active_subscriptions",
		Description: "Number of active subscriptions",
		Unit:        "",
		Data: metricdata.Sum[int64]{
			Temporality: metricdata.CumulativeTemporality,
			DataPoints: []metricdata.DataPoint[int64]{
				{
					Attributes: attribute.NewSet(
						otel.WgFederatedGraphID.String("graph"),
						otel.WgRouterClusterName.String(""),
						otel.WgRouterConfigVersion.String(""),
						otel.WgRouterVersion.String("dev"),
					),
					Value: val,
				},
			},
		},
	}
}

func FindScopeMetricByName(rm metricdata.ResourceMetrics, name string) *metricdata.Metrics {
	var metric *metricdata.Metrics
	for _, m := range rm.ScopeMetrics[0].Metrics {
		if m.Name == name {
			metric = &m
			break
		}
	}

	return metric
}
