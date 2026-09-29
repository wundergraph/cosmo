package metric

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/otel"
)

func responseCacheScope(t *testing.T, reader *metric.ManualReader) *metricdata.ScopeMetrics {
	t.Helper()

	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &rm))
	for i := range rm.ScopeMetrics {
		if rm.ScopeMetrics[i].Scope.Name == cosmoRouterResponseCacheMeterName {
			return &rm.ScopeMetrics[i]
		}
	}
	return nil
}

func responseCacheMetric(t *testing.T, scope *metricdata.ScopeMetrics, name string) metricdata.Metrics {
	t.Helper()

	require.NotNil(t, scope)
	for _, m := range scope.Metrics {
		if m.Name == name {
			return m
		}
	}
	require.FailNowf(t, "metric not found", "no metric named %q", name)
	return metricdata.Metrics{}
}

func newOtlpResponseCacheStore(t *testing.T) (*ResponseCacheMetrics, *metric.ManualReader) {
	t.Helper()

	reader := metric.NewManualReader()
	cfg := testOtlpConfig(reader, 0)
	cfg.OpenTelemetry.ResponseCache = true

	mp, err := NewOtlpMeterProvider(context.Background(), zap.NewNop(), cfg, "test-instance")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, mp.Shutdown(context.Background())) })

	store, err := NewResponseCacheMetricStore(zap.NewNop(), nil, mp, nil, cfg, "redis")
	require.NoError(t, err)

	return store, reader
}

func TestResponseCacheMetricStore(t *testing.T) {
	t.Parallel()

	ctx := context.Background()

	t.Run("operations are counted by outcome and timed in seconds", func(t *testing.T) {
		t.Parallel()

		store, reader := newOtlpResponseCacheStore(t)

		store.MeasureOperation(ctx, ResponseCacheOperationLookup, 2*time.Millisecond, "")
		store.MeasureOperation(ctx, ResponseCacheOperationLookup, 3*time.Millisecond, ResponseCacheErrorTimeout)
		store.MeasureEngineError(ctx, "mood", ResponseCacheErrorInvalidEntry)

		scope := responseCacheScope(t, reader)

		operations, ok := responseCacheMetric(t, scope, "router.response_cache.operations").Data.(metricdata.Sum[int64])
		require.True(t, ok)

		counts := map[string]int64{}
		for _, dp := range operations.DataPoints {
			provider, _ := dp.Attributes.Value(otel.WgResponseCacheProvider)
			require.Equal(t, "redis", provider.AsString())

			operation, _ := dp.Attributes.Value(otel.WgResponseCacheOperation)
			errorType, _ := dp.Attributes.Value(otel.WgErrorType)
			counts[operation.AsString()+"/"+errorType.AsString()] += dp.Value
		}
		require.Equal(t, map[string]int64{
			"lookup/":              1,
			"lookup/timeout":       1,
			"engine/invalid_entry": 1,
		}, counts)

		duration := responseCacheMetric(t, scope, "router.response_cache.operation.duration_seconds")
		require.Equal(t, "s", duration.Unit)
		hist, ok := duration.Data.(metricdata.Histogram[float64])
		require.True(t, ok)
		require.Len(t, hist.DataPoints, 1, "the duration is not split by outcome")
		require.EqualValues(t, 2, hist.DataPoints[0].Count)
		require.InDelta(t, 0.005, hist.DataPoints[0].Sum, 1e-9)
		require.Equal(t, 0.00025, hist.DataPoints[0].Bounds[0], "the buckets of the instrument survive the views of the meter provider")
	})

	t.Run("keys and writes are counted", func(t *testing.T) {
		t.Parallel()

		store, reader := newOtlpResponseCacheStore(t)

		store.MeasureKeys(ctx, ResponseCacheOperationLookup, ResponseCacheResultFound, 3)
		store.MeasureKeys(ctx, ResponseCacheOperationLookup, ResponseCacheResultMissing, 0)
		store.MeasureKeys(ctx, ResponseCacheOperationWrite, ResponseCacheResultStored, 2)
		store.MeasureWrite(ctx, 128, time.Minute)

		scope := responseCacheScope(t, reader)

		keys, ok := responseCacheMetric(t, scope, "router.response_cache.keys").Data.(metricdata.Sum[int64])
		require.True(t, ok)
		counts := map[string]int64{}
		for _, dp := range keys.DataPoints {
			operation, _ := dp.Attributes.Value(otel.WgResponseCacheOperation)
			result, _ := dp.Attributes.Value(otel.WgResponseCacheResult)
			counts[operation.AsString()+"/"+result.AsString()] += dp.Value
		}
		require.Equal(t, map[string]int64{"lookup/found": 3, "write/stored": 2}, counts)

		bytes, ok := responseCacheMetric(t, scope, "router.response_cache.write.bytes").Data.(metricdata.Sum[int64])
		require.True(t, ok)
		require.EqualValues(t, 128, bytes.DataPoints[0].Value)

		ttl, ok := responseCacheMetric(t, scope, "router.response_cache.write.ttl_seconds").Data.(metricdata.Histogram[float64])
		require.True(t, ok)
		require.InDelta(t, 60, ttl.DataPoints[0].Sum, 1e-9)
		require.Equal(t, float64(86400), ttl.DataPoints[0].Bounds[len(ttl.DataPoints[0].Bounds)-1])
	})

	t.Run("fetches are counted by status, decision and type", func(t *testing.T) {
		t.Parallel()

		store, reader := newOtlpResponseCacheStore(t)

		store.MeasureFetch(ctx, "mood", "Employee", "miss", "no_store")
		store.MeasureFetch(ctx, "mood", "Employee", "miss", "no_store")
		store.MeasureFetch(ctx, "mood", "", "not_cacheable", "")

		fetches, ok := responseCacheMetric(t, responseCacheScope(t, reader), "router.response_cache.fetches").Data.(metricdata.Sum[int64])
		require.True(t, ok)
		require.Len(t, fetches.DataPoints, 2)

		for _, dp := range fetches.DataPoints {
			status, _ := dp.Attributes.Value(otel.WgResponseCacheStatus)
			if status.AsString() == "not_cacheable" {
				require.EqualValues(t, 1, dp.Value)
				_, hasType := dp.Attributes.Value(otel.WgEntityType)
				_, hasDecision := dp.Attributes.Value(otel.WgResponseCacheStoreDecision)
				require.False(t, hasType)
				require.False(t, hasDecision)
				continue
			}

			require.EqualValues(t, 2, dp.Value)
			require.Equal(t, attribute.NewSet(
				otel.WgResponseCacheProvider.String("redis"),
				otel.WgSubgraphName.String("mood"),
				otel.WgResponseCacheStatus.String("miss"),
				otel.WgEntityType.String("Employee"),
				otel.WgResponseCacheStoreDecision.String("no_store"),
			), dp.Attributes)
		}
	})

	t.Run("nothing is recorded while both exporters are off", func(t *testing.T) {
		t.Parallel()

		reader := metric.NewManualReader()
		cfg := testOtlpConfig(reader, 0)

		mp, err := NewOtlpMeterProvider(ctx, zap.NewNop(), cfg, "test-instance")
		require.NoError(t, err)
		t.Cleanup(func() { require.NoError(t, mp.Shutdown(context.Background())) })

		store, err := NewResponseCacheMetricStore(zap.NewNop(), nil, mp, nil, cfg, "redis")
		require.NoError(t, err)

		store.MeasureOperation(ctx, ResponseCacheOperationLookup, time.Millisecond, "")
		require.Nil(t, responseCacheScope(t, reader))
	})

	t.Run("prometheus gets its own scope and keeps the buckets", func(t *testing.T) {
		t.Parallel()

		cfg := testPrometheusConfig(0)
		cfg.Prometheus.ResponseCache = true

		mp, registry, err := NewPrometheusMeterProvider(ctx, cfg, "test-instance")
		require.NoError(t, err)
		t.Cleanup(func() { require.NoError(t, mp.Shutdown(context.Background())) })

		store, err := NewResponseCacheMetricStore(zap.NewNop(), nil, nil, mp, cfg, "redis")
		require.NoError(t, err)

		store.MeasureOperation(ctx, ResponseCacheOperationWrite, time.Millisecond, ResponseCacheErrorPartialWrite)
		store.MeasureKeys(ctx, ResponseCacheOperationWrite, ResponseCacheResultFailed, 2)

		require.Equal(t, 1, gatherMetricCount(t, registry, "router_response_cache_operations_total"))
		require.Equal(t, 1, gatherMetricCount(t, registry, "router_response_cache_keys_total"))

		families, err := registry.Gather()
		require.NoError(t, err)
		for _, family := range families {
			if family.GetName() != "router_response_cache_operation_duration_seconds" {
				continue
			}
			buckets := family.GetMetric()[0].GetHistogram().GetBucket()
			require.Equal(t, 0.00025, buckets[0].GetUpperBound())
			return
		}
		require.FailNow(t, "router_response_cache_operation_duration_seconds not found")
	})
}
