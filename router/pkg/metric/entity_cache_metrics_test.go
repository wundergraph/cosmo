package metric

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.uber.org/zap"
)

func TestEntityCacheMetricsRecordSnapshot(t *testing.T) {
	t.Parallel()

	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	metrics, err := NewEntityCacheMetrics(zap.NewNop(), []attribute.KeyValue{attribute.String("router.config.version", "v1")}, provider, true)
	require.NoError(t, err)

	metrics.RecordSnapshot(context.Background(), resolve.CacheAnalyticsSnapshot{
		L1Reads: []resolve.CacheKeyEvent{
			{Key: "l1-hit-1", EntityType: "User", Hit: true, Bytes: 11},
			{Key: "l1-hit-2", EntityType: "User", Hit: true, Bytes: 13},
			{Key: "l1-miss-1", EntityType: "User", Hit: false},
		},
		L2Reads: []resolve.CacheKeyEvent{
			{Key: "l2-hit-1", EntityType: "User", Hit: true, Bytes: 17},
			{Key: "l2-miss-1", EntityType: "User", Hit: false},
		},
		L1Writes: []resolve.CacheWriteEvent{
			{Key: "l1-write-1", EntityType: "User", Bytes: 19, CacheLevel: resolve.CacheLevelL1, Reason: resolve.CacheWriteReasonRefresh, Source: resolve.CacheSourceQuery},
		},
		L2Writes: []resolve.CacheWriteEvent{
			{Key: "l2-write-1", EntityType: "User", Bytes: 23, CacheLevel: resolve.CacheLevelL2, Reason: resolve.CacheWriteReasonBackfill, Source: resolve.CacheSourceQuery},
			{Key: "l2-write-2", EntityType: "User", Bytes: 29, CacheLevel: resolve.CacheLevelL2, Reason: resolve.CacheWriteReasonRefresh, Source: resolve.CacheSourceMutation},
		},
		FetchTimings: []resolve.FetchTimingEvent{
			{SubgraphName: "accounts", CacheName: "default", Operation: "load", Duration: 7 * time.Millisecond, Bytes: 31},
		},
		MutationEvents: []resolve.MutationEvent{
			{EntityType: "User", Operation: "updateUser", Key: "user:1", Deleted: true},
			{EntityType: "User", Operation: "updateUser", Key: "user:1", Written: true},
		},
		ShadowComparisons: []resolve.ShadowComparisonEvent{
			{Key: "shadow-fresh", EntityType: "User", Matched: true},
			{Key: "shadow-stale", EntityType: "User", Matched: false},
		},
		CacheOpErrors: []resolve.CacheOperationError{
			{Operation: "get", CacheName: "default", Key: "user:1", Error: "redis timeout"},
			{Operation: "set", CacheName: "default", Key: "user:2", Error: "redis timeout"},
		},
	})

	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &rm))

	require.Equal(t, int64(2), sumForAttributes(t, rm, EntityCacheReads, "cache_level", "l1", "outcome", "hit"))
	require.Equal(t, int64(1), sumForAttributes(t, rm, EntityCacheReads, "cache_level", "l1", "outcome", "miss"))
	require.Equal(t, int64(1), sumForAttributes(t, rm, EntityCacheReads, "cache_level", "l2", "outcome", "hit"))
	require.Equal(t, int64(1), sumForAttributes(t, rm, EntityCacheReads, "cache_level", "l2", "outcome", "miss"))
	require.Equal(t, int64(1), sumForAttributes(t, rm, EntityCacheWrites, "cache_level", "l1"))
	require.Equal(t, int64(2), sumForAttributes(t, rm, EntityCacheWrites, "cache_level", "l2"))
	require.Equal(t, int64(41), sumForAttributes(t, rm, EntityCacheCachedBytesServed))
	require.Equal(t, int64(1), sumForAttributes(t, rm, EntityCacheMutations, "result", "invalidation"))
	require.Equal(t, int64(1), sumForAttributes(t, rm, EntityCacheMutations, "result", "population"))
	require.Equal(t, int64(1), sumForAttributes(t, rm, EntityCacheShadowComparisons, "result", "fresh"))
	require.Equal(t, int64(1), sumForAttributes(t, rm, EntityCacheShadowComparisons, "result", "stale"))
	require.Equal(t, int64(1), sumForAttributes(t, rm, EntityCacheOperationErrors, "operation", "get", "cache_name", "default"))
	require.Equal(t, int64(1), sumForAttributes(t, rm, EntityCacheOperationErrors, "operation", "set", "cache_name", "default"))

	histogram := histogramForMetric(t, rm, EntityCacheFetchDuration)
	require.Len(t, histogram.DataPoints, 1)
	require.Equal(t, uint64(1), histogram.DataPoints[0].Count)
	require.Equal(t, 7.0, histogram.DataPoints[0].Sum)
}

func TestEntityCacheMetricsDisabledDoesNotInitializeInstruments(t *testing.T) {
	t.Parallel()

	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	metrics, err := NewEntityCacheMetrics(zap.NewNop(), nil, provider, false)
	require.NoError(t, err)

	metrics.RecordSnapshot(context.Background(), resolve.CacheAnalyticsSnapshot{
		L1Reads: []resolve.CacheKeyEvent{{Key: "l1-hit", Hit: true}},
	})

	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &rm))
	require.Empty(t, rm.ScopeMetrics)
}

func sumForAttributes(t *testing.T, rm metricdata.ResourceMetrics, name string, attrs ...string) int64 {
	t.Helper()
	require.Equal(t, 0, len(attrs)%2)

	points := sumDataPoints(t, rm, name)
	for _, point := range points {
		if attributeSetMatches(point.Attributes, attrs...) {
			return point.Value
		}
	}
	t.Fatalf("metric %q with attributes %v not found", name, attrs)
	return 0
}

func sumDataPoints(t *testing.T, rm metricdata.ResourceMetrics, name string) []metricdata.DataPoint[int64] {
	t.Helper()
	for _, scope := range rm.ScopeMetrics {
		for _, metric := range scope.Metrics {
			if metric.Name != name {
				continue
			}
			sum, ok := metric.Data.(metricdata.Sum[int64])
			require.True(t, ok, "metric %q has type %T", name, metric.Data)
			return sum.DataPoints
		}
	}
	t.Fatalf("metric %q not found", name)
	return nil
}

func histogramForMetric(t *testing.T, rm metricdata.ResourceMetrics, name string) metricdata.Histogram[float64] {
	t.Helper()
	for _, scope := range rm.ScopeMetrics {
		for _, metric := range scope.Metrics {
			if metric.Name != name {
				continue
			}
			histogram, ok := metric.Data.(metricdata.Histogram[float64])
			require.True(t, ok, "metric %q has type %T", name, metric.Data)
			return histogram
		}
	}
	t.Fatalf("metric %q not found", name)
	return metricdata.Histogram[float64]{}
}

func attributeSetMatches(set attribute.Set, attrs ...string) bool {
	for i := 0; i < len(attrs); i += 2 {
		value, ok := set.Value(attribute.Key(attrs[i]))
		if !ok || value.AsString() != attrs[i+1] {
			return false
		}
	}
	return true
}

var _ = otelmetric.WithAttributes
