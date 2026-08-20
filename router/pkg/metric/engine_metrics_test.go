package metric

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
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
	names := make(map[string]bool)
	for _, scope := range resourceMetrics.ScopeMetrics {
		for _, metric := range scope.Metrics {
			names[metric.Name] = true
		}
	}
	require.True(t, names[subscriptionDeliveryAttemptsKey])
	require.True(t, names[subscriptionDeliveryFailuresKey])
	require.True(t, names[subscriptionDisconnectsKey])
}
