package metric

import (
	"context"
	"slices"

	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

const (
	cosmoEntityCacheMeterName    = "cosmo.router.entity_cache"
	cosmoEntityCacheMeterVersion = "0.0.1"

	entityCacheMetricBase         = "router.entity_cache."
	entityCacheRequestsStatsKey   = entityCacheMetricBase + "requests.stats"
	entityCacheKeysStatsKey       = entityCacheMetricBase + "keys.stats"
	entityCacheLatencyKey         = entityCacheMetricBase + "latency"
	entityCacheInvalidationsKey   = entityCacheMetricBase + "invalidations"
	entityCachePopulationsKey     = entityCacheMetricBase + "populations"
	entityCacheShadowStalenessKey    = entityCacheMetricBase + "shadow.staleness"
	entityCacheOperationErrorsKey   = entityCacheMetricBase + "operation_errors"
)

var (
	attrKeyType       = attribute.Key("type")
	attrKeyCacheLevel = attribute.Key("cache_level")
	attrKeyCacheType  = attribute.Key("cache_type")
	attrKeyOperation  = attribute.Key("operation")
	attrKeySource     = attribute.Key("source")
	attrKeyCacheName  = attribute.Key("cache_name")
	attrKeyEntityType = attribute.Key("entity_type")
)

type entityCacheInstruments struct {
	requestsStats   otelmetric.Int64Counter
	keysStats       otelmetric.Int64Counter
	latency         otelmetric.Float64Histogram
	invalidations   otelmetric.Int64Counter
	populations     otelmetric.Int64Counter
	shadowStaleness otelmetric.Int64Counter
	operationErrors otelmetric.Int64Counter
}

type EntityCacheMetrics struct {
	instruments    *entityCacheInstruments
	baseAttributes []attribute.KeyValue
}

func NewEntityCacheMetrics(
	baseAttributes []attribute.KeyValue,
	provider *metric.MeterProvider,
) (*EntityCacheMetrics, error) {
	meter := provider.Meter(cosmoEntityCacheMeterName, otelmetric.WithInstrumentationVersion(cosmoEntityCacheMeterVersion))

	instruments, err := setupEntityCacheInstruments(meter)
	if err != nil {
		return nil, err
	}

	return &EntityCacheMetrics{
		instruments:    instruments,
		baseAttributes: slices.Clone(baseAttributes),
	}, nil
}

func setupEntityCacheInstruments(m otelmetric.Meter) (*entityCacheInstruments, error) {
	requestsStats, err := m.Int64Counter(
		entityCacheRequestsStatsKey,
		otelmetric.WithDescription("Entity cache request statistics (hits/misses)"),
	)
	if err != nil {
		return nil, err
	}

	keysStats, err := m.Int64Counter(
		entityCacheKeysStatsKey,
		otelmetric.WithDescription("Entity cache key lifecycle statistics"),
	)
	if err != nil {
		return nil, err
	}

	latency, err := m.Float64Histogram(
		entityCacheLatencyKey,
		otelmetric.WithDescription("L2 cache operation latency in milliseconds"),
		otelmetric.WithUnit("ms"),
	)
	if err != nil {
		return nil, err
	}

	invalidations, err := m.Int64Counter(
		entityCacheInvalidationsKey,
		otelmetric.WithDescription("Cache invalidation counts by trigger source"),
	)
	if err != nil {
		return nil, err
	}

	populations, err := m.Int64Counter(
		entityCachePopulationsKey,
		otelmetric.WithDescription("Cache population counts by trigger source"),
	)
	if err != nil {
		return nil, err
	}

	shadowStaleness, err := m.Int64Counter(
		entityCacheShadowStalenessKey,
		otelmetric.WithDescription("Shadow mode: count where cached data differed from fresh data"),
	)
	if err != nil {
		return nil, err
	}

	operationErrors, err := m.Int64Counter(
		entityCacheOperationErrorsKey,
		otelmetric.WithDescription("Cache operation errors (get/set/delete failures)"),
	)
	if err != nil {
		return nil, err
	}

	return &entityCacheInstruments{
		requestsStats:   requestsStats,
		keysStats:       keysStats,
		latency:         latency,
		invalidations:   invalidations,
		populations:     populations,
		shadowStaleness: shadowStaleness,
		operationErrors: operationErrors,
	}, nil
}

func (m *EntityCacheMetrics) attrs(extra ...attribute.KeyValue) otelmetric.MeasurementOption {
	return otelmetric.WithAttributes(slices.Concat(m.baseAttributes, extra)...)
}

func (m *EntityCacheMetrics) RecordSnapshot(ctx context.Context, snapshot resolve.CacheAnalyticsSnapshot) {
	for _, event := range snapshot.L1Reads {
		cacheType := cacheTypeFromEntityType(event.EntityType)
		switch event.Kind {
		case resolve.CacheKeyHit:
			m.recordRequestStat(ctx, "hits", "l1", cacheType)
		case resolve.CacheKeyMiss:
			m.recordRequestStat(ctx, "misses", "l1", cacheType)
		}
	}

	for _, event := range snapshot.L2Reads {
		cacheType := cacheTypeFromEntityType(event.EntityType)
		switch event.Kind {
		case resolve.CacheKeyHit:
			m.recordRequestStat(ctx, "hits", "l2", cacheType)
		case resolve.CacheKeyMiss:
			m.recordRequestStat(ctx, "misses", "l2", cacheType)
		}
	}

	for range snapshot.L1Writes {
		m.instruments.keysStats.Add(ctx, 1,
			m.attrs(attrKeyOperation.String("added"), attrKeyCacheLevel.String("l1")),
		)
	}

	for range snapshot.L2Writes {
		m.instruments.keysStats.Add(ctx, 1,
			m.attrs(attrKeyOperation.String("added"), attrKeyCacheLevel.String("l2")),
		)
		m.instruments.populations.Add(ctx, 1,
			m.attrs(attrKeySource.String("query")),
		)
	}

	for _, event := range snapshot.FetchTimings {
		if event.Source == resolve.FieldSourceL2 {
			m.instruments.latency.Record(ctx, float64(event.DurationMs),
				m.attrs(attrKeyCacheLevel.String("l2"), attrKeyOperation.String("get")),
			)
		}
	}

	for _, event := range snapshot.ShadowComparisons {
		if !event.IsFresh {
			m.instruments.shadowStaleness.Add(ctx, 1,
				m.attrs(attrKeyCacheType.String(cacheTypeFromEntityType(event.EntityType))),
			)
		}
	}

	for _, event := range snapshot.MutationEvents {
		if event.HadCachedValue {
			m.instruments.invalidations.Add(ctx, 1,
				m.attrs(attrKeySource.String("mutation")),
			)
		}
	}

	for _, opErr := range snapshot.CacheOpErrors {
		m.instruments.operationErrors.Add(ctx, 1,
			m.attrs(
				attrKeyOperation.String(opErr.Operation),
				attrKeyCacheName.String(opErr.CacheName),
				attrKeyEntityType.String(opErr.EntityType),
			),
		)
	}
}

func cacheTypeFromEntityType(entityType string) string {
	if entityType != "" {
		return "entity"
	}
	return "root_field"
}

func (m *EntityCacheMetrics) recordRequestStat(ctx context.Context, typ, cacheLevel, cacheType string) {
	m.instruments.requestsStats.Add(ctx, 1,
		m.attrs(attrKeyType.String(typ), attrKeyCacheLevel.String(cacheLevel), attrKeyCacheType.String(cacheType)),
	)
}
