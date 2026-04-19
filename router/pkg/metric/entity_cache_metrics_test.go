package metric

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

func newTestEntityCacheMetrics(t *testing.T) (*EntityCacheMetrics, *metric.ManualReader) {
	t.Helper()
	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	m, err := NewEntityCacheMetrics(
		zap.NewNop(),
		[]attribute.KeyValue{attribute.String("service.name", "test-router")},
		provider,
	)
	require.NoError(t, err)
	require.NotNil(t, m)
	return m, reader
}

// collectMetrics reads all emitted metrics into a flat name → DataPoints map for assertion.
func collectMetrics(t *testing.T, reader *metric.ManualReader) map[string]metricdata.Metrics {
	t.Helper()
	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &rm))
	out := make(map[string]metricdata.Metrics)
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			out[m.Name] = m
		}
	}
	return out
}

// sumForAttrs returns the sum of all int64 counter data points matching every given attribute.
func sumForAttrs(t *testing.T, m metricdata.Metrics, want ...attribute.KeyValue) int64 {
	t.Helper()
	data, ok := m.Data.(metricdata.Sum[int64])
	require.Truef(t, ok, "metric %q is not Sum[int64]", m.Name)
	var total int64
	for _, dp := range data.DataPoints {
		if attrsContainAll(dp.Attributes, want) {
			total += dp.Value
		}
	}
	return total
}

func attrsContainAll(set attribute.Set, want []attribute.KeyValue) bool {
	for _, w := range want {
		got, ok := set.Value(w.Key)
		if !ok || got != w.Value {
			return false
		}
	}
	return true
}

func TestNewEntityCacheMetrics_ShutdownReturnsNil(t *testing.T) {
	t.Parallel()
	m, _ := newTestEntityCacheMetrics(t)
	require.NoError(t, m.Shutdown())
}

func TestCacheTypeFromEntityType(t *testing.T) {
	t.Parallel()
	require.Equal(t, "entity", cacheTypeFromEntityType("User"))
	require.Equal(t, "root_field", cacheTypeFromEntityType(""))
}

func TestRecordSnapshot_L1Reads_CountsHitsAndMisses(t *testing.T) {
	t.Parallel()
	m, reader := newTestEntityCacheMetrics(t)

	snap := resolve.CacheAnalyticsSnapshot{
		L1Reads: []resolve.CacheKeyEvent{
			{Kind: resolve.CacheKeyHit, EntityType: "User"},
			{Kind: resolve.CacheKeyHit, EntityType: "User"},
			{Kind: resolve.CacheKeyMiss, EntityType: "User"},
			{Kind: resolve.CacheKeyHit, EntityType: ""}, // root field
		},
	}
	m.RecordSnapshot(context.Background(), snap)

	ms := collectMetrics(t, reader)
	stats := ms[entityCacheRequestsStatsKey]
	require.Equal(t, int64(2), sumForAttrs(t, stats,
		otel.CacheMetricsTypeAttribute.String("hits"),
		otel.EntityCacheCacheLevelAttribute.String("l1"),
		otel.CacheMetricsCacheTypeAttribute.String("entity"),
	))
	require.Equal(t, int64(1), sumForAttrs(t, stats,
		otel.CacheMetricsTypeAttribute.String("misses"),
		otel.EntityCacheCacheLevelAttribute.String("l1"),
		otel.CacheMetricsCacheTypeAttribute.String("entity"),
	))
	require.Equal(t, int64(1), sumForAttrs(t, stats,
		otel.CacheMetricsTypeAttribute.String("hits"),
		otel.EntityCacheCacheLevelAttribute.String("l1"),
		otel.CacheMetricsCacheTypeAttribute.String("root_field"),
	))
}

func TestRecordSnapshot_L2Reads_CountsHitsAndMisses(t *testing.T) {
	t.Parallel()
	m, reader := newTestEntityCacheMetrics(t)

	snap := resolve.CacheAnalyticsSnapshot{
		L2Reads: []resolve.CacheKeyEvent{
			{Kind: resolve.CacheKeyHit, EntityType: "Product"},
			{Kind: resolve.CacheKeyMiss, EntityType: "Product"},
			{Kind: resolve.CacheKeyMiss, EntityType: "Product"},
		},
	}
	m.RecordSnapshot(context.Background(), snap)

	ms := collectMetrics(t, reader)
	stats := ms[entityCacheRequestsStatsKey]
	require.Equal(t, int64(1), sumForAttrs(t, stats,
		otel.CacheMetricsTypeAttribute.String("hits"),
		otel.EntityCacheCacheLevelAttribute.String("l2"),
	))
	require.Equal(t, int64(2), sumForAttrs(t, stats,
		otel.CacheMetricsTypeAttribute.String("misses"),
		otel.EntityCacheCacheLevelAttribute.String("l2"),
	))
}

func TestRecordSnapshot_WritesIncrementKeysStatsAndPopulations(t *testing.T) {
	t.Parallel()
	m, reader := newTestEntityCacheMetrics(t)

	snap := resolve.CacheAnalyticsSnapshot{
		L1Writes: []resolve.CacheWriteEvent{
			{CacheKey: "k1"}, {CacheKey: "k2"},
		},
		L2Writes: []resolve.CacheWriteEvent{
			{CacheKey: "k1"}, {CacheKey: "k2"}, {CacheKey: "k3"},
		},
	}
	m.RecordSnapshot(context.Background(), snap)

	ms := collectMetrics(t, reader)
	keys := ms[entityCacheKeysStatsKey]
	require.Equal(t, int64(2), sumForAttrs(t, keys,
		otel.CacheMetricsOperationAttribute.String("added"),
		otel.EntityCacheCacheLevelAttribute.String("l1"),
	))
	require.Equal(t, int64(3), sumForAttrs(t, keys,
		otel.CacheMetricsOperationAttribute.String("added"),
		otel.EntityCacheCacheLevelAttribute.String("l2"),
	))

	pops := ms[entityCachePopulationsKey]
	require.Equal(t, int64(3), sumForAttrs(t, pops,
		otel.EntityCacheSourceAttribute.String("query"),
	))
}

func TestRecordSnapshot_FetchTimings_RecordsL2LatencyOnly(t *testing.T) {
	t.Parallel()
	m, reader := newTestEntityCacheMetrics(t)

	snap := resolve.CacheAnalyticsSnapshot{
		FetchTimings: []resolve.FetchTimingEvent{
			{Source: resolve.FieldSourceL2, DurationMs: 12},
			{Source: resolve.FieldSourceL2, DurationMs: 34},
			{Source: resolve.FieldSourceSubgraph, DurationMs: 99}, // ignored
		},
	}
	m.RecordSnapshot(context.Background(), snap)

	ms := collectMetrics(t, reader)
	lat := ms[entityCacheLatencyKey]
	hist, ok := lat.Data.(metricdata.Histogram[float64])
	require.True(t, ok)
	// Only L2 entries recorded → 2 measurements across all data points.
	var count uint64
	var sum float64
	for _, dp := range hist.DataPoints {
		count += dp.Count
		sum += dp.Sum
	}
	require.Equal(t, uint64(2), count)
	require.InDelta(t, 46.0, sum, 0.0001)
}

func TestRecordSnapshot_ShadowComparisons_OnlyStalenessIsCounted(t *testing.T) {
	t.Parallel()
	m, reader := newTestEntityCacheMetrics(t)

	snap := resolve.CacheAnalyticsSnapshot{
		ShadowComparisons: []resolve.ShadowComparisonEvent{
			{IsFresh: true, EntityType: "User"},
			{IsFresh: false, EntityType: "User"},
			{IsFresh: false, EntityType: "Product"},
			{IsFresh: false, EntityType: ""}, // root_field
		},
	}
	m.RecordSnapshot(context.Background(), snap)

	ms := collectMetrics(t, reader)
	staleness := ms[entityCacheShadowStalenessKey]
	require.Equal(t, int64(2), sumForAttrs(t, staleness,
		otel.CacheMetricsCacheTypeAttribute.String("entity"),
	))
	require.Equal(t, int64(1), sumForAttrs(t, staleness,
		otel.CacheMetricsCacheTypeAttribute.String("root_field"),
	))
}

func TestRecordSnapshot_MutationEvents_IncrementsInvalidationsWhenCached(t *testing.T) {
	t.Parallel()
	m, reader := newTestEntityCacheMetrics(t)

	snap := resolve.CacheAnalyticsSnapshot{
		MutationEvents: []resolve.MutationEvent{
			{HadCachedValue: true},
			{HadCachedValue: true},
			{HadCachedValue: false}, // ignored
		},
	}
	m.RecordSnapshot(context.Background(), snap)

	ms := collectMetrics(t, reader)
	inv := ms[entityCacheInvalidationsKey]
	require.Equal(t, int64(2), sumForAttrs(t, inv,
		otel.EntityCacheSourceAttribute.String("mutation"),
	))
}

func TestRecordSnapshot_PopulationSource_CarriedThrough(t *testing.T) {
	t.Parallel()
	m, reader := newTestEntityCacheMetrics(t)

	// L2 writes tagged with distinct sources must land under distinct labels.
	snap := resolve.CacheAnalyticsSnapshot{
		L2Writes: []resolve.CacheWriteEvent{
			{Source: resolve.CacheSourceQuery},
			{Source: resolve.CacheSourceQuery},
			{Source: resolve.CacheSourceMutation},
			{Source: resolve.CacheSourceSubscription},
			{Source: ""}, // unset → default to "query"
		},
	}
	m.RecordSnapshot(context.Background(), snap)

	ms := collectMetrics(t, reader)
	pops := ms[entityCachePopulationsKey]
	require.Equal(t, int64(3), sumForAttrs(t, pops,
		otel.EntityCacheSourceAttribute.String("query"),
	))
	require.Equal(t, int64(1), sumForAttrs(t, pops,
		otel.EntityCacheSourceAttribute.String("mutation"),
	))
	require.Equal(t, int64(1), sumForAttrs(t, pops,
		otel.EntityCacheSourceAttribute.String("subscription"),
	))
}

func TestRecordSnapshot_InvalidationSource_CarriedThrough(t *testing.T) {
	t.Parallel()
	m, reader := newTestEntityCacheMetrics(t)

	snap := resolve.CacheAnalyticsSnapshot{
		MutationEvents: []resolve.MutationEvent{
			{HadCachedValue: true, Source: resolve.CacheSourceMutation},
			{HadCachedValue: true, Source: resolve.CacheSourceMutation},
			{HadCachedValue: true, Source: resolve.CacheSourceSubscription},
			{HadCachedValue: true, Source: ""}, // unset → default to "mutation"
		},
	}
	m.RecordSnapshot(context.Background(), snap)

	ms := collectMetrics(t, reader)
	inv := ms[entityCacheInvalidationsKey]
	require.Equal(t, int64(3), sumForAttrs(t, inv,
		otel.EntityCacheSourceAttribute.String("mutation"),
	))
	require.Equal(t, int64(1), sumForAttrs(t, inv,
		otel.EntityCacheSourceAttribute.String("subscription"),
	))
}

func TestRecordSnapshot_CacheOpErrors_IncrementsOperationErrors(t *testing.T) {
	t.Parallel()
	m, reader := newTestEntityCacheMetrics(t)

	snap := resolve.CacheAnalyticsSnapshot{
		CacheOpErrors: []resolve.CacheOperationError{
			{Operation: "get", CacheName: "default", EntityType: "User"},
			{Operation: "set", CacheName: "default", EntityType: "User"},
			{Operation: "get", CacheName: "default", EntityType: "User"},
		},
	}
	m.RecordSnapshot(context.Background(), snap)

	ms := collectMetrics(t, reader)
	errs := ms[entityCacheOperationErrorsKey]
	require.Equal(t, int64(2), sumForAttrs(t, errs,
		otel.CacheMetricsOperationAttribute.String("get"),
		otel.EntityCacheCacheNameAttribute.String("default"),
		otel.EntityCacheEntityTypeAttribute.String("User"),
	))
	require.Equal(t, int64(1), sumForAttrs(t, errs,
		otel.CacheMetricsOperationAttribute.String("set"),
		otel.EntityCacheCacheNameAttribute.String("default"),
		otel.EntityCacheEntityTypeAttribute.String("User"),
	))
}

func TestRecordSnapshot_EmptySnapshot_NoMetricsEmitted(t *testing.T) {
	t.Parallel()
	m, reader := newTestEntityCacheMetrics(t)

	m.RecordSnapshot(context.Background(), resolve.CacheAnalyticsSnapshot{})

	ms := collectMetrics(t, reader)
	// No instruments should have any data points recorded — the map may contain
	// the instrument metadata but every Sum[int64] should be empty.
	for name, m := range ms {
		if s, ok := m.Data.(metricdata.Sum[int64]); ok {
			require.Lenf(t, s.DataPoints, 0, "instrument %q unexpectedly has data points", name)
		}
	}
}

func TestRecordSnapshot_BaseAttributes_AppliedToAllInstruments(t *testing.T) {
	t.Parallel()
	m, reader := newTestEntityCacheMetrics(t)

	snap := resolve.CacheAnalyticsSnapshot{
		L1Reads: []resolve.CacheKeyEvent{{Kind: resolve.CacheKeyHit, EntityType: "User"}},
	}
	m.RecordSnapshot(context.Background(), snap)

	ms := collectMetrics(t, reader)
	stats := ms[entityCacheRequestsStatsKey]
	require.Equal(t, int64(1), sumForAttrs(t, stats,
		attribute.String("service.name", "test-router"),
		otel.CacheMetricsTypeAttribute.String("hits"),
	))
}
