package metric

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	rotel "github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/statistics"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.uber.org/zap"
)

func TestEngineMetricsExportsSubscriptionDeliveryAndDisconnectCounters(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	stats := statistics.NewEngineStats(t.Context(), zap.NewNop(), false)
	metrics, err := NewEngineMetrics(zap.NewNop(), nil, provider, stats, &EngineStatsConfig{Subscription: true}, false)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, metrics.Shutdown()) })

	stats.ObserveSubscription(statistics.SubscriptionObservation{
		Kind:      statistics.SubscriptionObservationDeliveryAttempt,
		Transport: "sse",
		FrameType: "next",
	})
	stats.ObserveSubscription(statistics.SubscriptionObservation{
		Kind:          statistics.SubscriptionObservationDeliveryFailure,
		Transport:     "sse",
		FrameType:     "next",
		FailureStage:  "flush",
		FailureReason: "timeout",
	})
	stats.ObserveSubscription(statistics.SubscriptionObservation{
		Kind:             statistics.SubscriptionObservationDisconnect,
		Transport:        "sse",
		Initiator:        "router",
		DisconnectReason: "write_timeout",
	})

	var resourceMetrics metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &resourceMetrics))
	type metricPoint struct {
		value      int64
		attributes map[string]string
	}
	points := make(map[string]metricPoint)
	for _, scope := range resourceMetrics.ScopeMetrics {
		for _, metric := range scope.Metrics {
			sum, ok := metric.Data.(metricdata.Sum[int64])
			if !ok || len(sum.DataPoints) == 0 {
				continue
			}
			attrs := make(map[string]string)
			for _, attr := range sum.DataPoints[0].Attributes.ToSlice() {
				attrs[string(attr.Key)] = attr.Value.AsString()
			}
			points[metric.Name] = metricPoint{value: sum.DataPoints[0].Value, attributes: attrs}
		}
	}
	require.Equal(t, metricPoint{value: 1, attributes: map[string]string{
		string(rotel.WgSubscriptionTransport): "sse",
		string(rotel.WgSubscriptionFrameType): "next",
	}}, points[subscriptionDeliveryAttemptsKey])
	require.Equal(t, metricPoint{value: 1, attributes: map[string]string{
		string(rotel.WgSubscriptionTransport):     "sse",
		string(rotel.WgSubscriptionFrameType):     "next",
		string(rotel.WgSubscriptionFailureStage):  "flush",
		string(rotel.WgSubscriptionFailureReason): "timeout",
	}}, points[subscriptionDeliveryFailuresKey])
	require.Equal(t, metricPoint{value: 1, attributes: map[string]string{
		string(rotel.WgSubscriptionTransport):           "sse",
		string(rotel.WgSubscriptionDisconnectInitiator): "router",
		string(rotel.WgSubscriptionDisconnectReason):    "write_timeout",
	}}, points[subscriptionDisconnectsKey])
}
