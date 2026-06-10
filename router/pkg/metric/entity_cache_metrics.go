package metric

import (
	"context"
	"slices"

	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/otel"
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
	entityCacheShadowStalenessKey = entityCacheMetricBase + "shadow.staleness"
	entityCacheOperationErrorsKey = entityCacheMetricBase + "operation_errors"
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

// EntityCacheMetrics is a struct that holds the metrics for the entity cache.
type EntityCacheMetrics struct {
	instruments    *entityCacheInstruments
	baseAttributes []attribute.KeyValue
	logger         *zap.Logger
}

// NewEntityCacheMetrics creates a new EntityCacheMetrics instance.
func NewEntityCacheMetrics(
	logger *zap.Logger,
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
		logger:         logger,
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

// Shutdown performs cleanup of entity cache metrics resources.
// EntityCacheMetrics uses synchronous instruments, so there are no callbacks to unregister.
func (m *EntityCacheMetrics) Shutdown() error {
	return nil
}

func (m *EntityCacheMetrics) RecordSnapshot(ctx context.Context, snapshot resolve.CacheAnalyticsSnapshot) {
	for _, event := range snapshot.L1Reads {
		cacheType := cacheTypeFromEntityType(event.EntityType)
		switch event.Kind {
		case resolve.CacheKeyHit:
			m.recordRequestStat(ctx, otel.CacheMetricsRequestTypeHits, otel.EntityCacheLevelL1, cacheType)
		case resolve.CacheKeyMiss:
			m.recordRequestStat(ctx, otel.CacheMetricsRequestTypeMisses, otel.EntityCacheLevelL1, cacheType)
		}
	}

	for _, event := range snapshot.L2Reads {
		cacheType := cacheTypeFromEntityType(event.EntityType)
		switch event.Kind {
		case resolve.CacheKeyHit:
			m.recordRequestStat(ctx, otel.CacheMetricsRequestTypeHits, otel.EntityCacheLevelL2, cacheType)
		case resolve.CacheKeyMiss:
			m.recordRequestStat(ctx, otel.CacheMetricsRequestTypeMisses, otel.EntityCacheLevelL2, cacheType)
		}
	}

	for range snapshot.L1Writes {
		m.instruments.keysStats.Add(ctx, 1,
			m.attrs(
				otel.CacheMetricsOperationAttribute.String(otel.EntityCacheOperationAdded),
				otel.EntityCacheCacheLevelAttribute.String(otel.EntityCacheLevelL1),
			),
		)
	}

	for _, event := range snapshot.L2Writes {
		m.instruments.keysStats.Add(ctx, 1,
			m.attrs(
				otel.CacheMetricsOperationAttribute.String(otel.EntityCacheOperationAdded),
				otel.EntityCacheCacheLevelAttribute.String(otel.EntityCacheLevelL2),
			),
		)
		m.instruments.populations.Add(ctx, 1,
			m.attrs(otel.EntityCacheSourceAttribute.String(populationSource(event.Source))),
		)
	}

	for _, event := range snapshot.FetchTimings {
		if event.Source == resolve.FieldSourceL2 {
			m.instruments.latency.Record(ctx, float64(event.DurationMs),
				m.attrs(
					otel.EntityCacheCacheLevelAttribute.String(otel.EntityCacheLevelL2),
					otel.CacheMetricsOperationAttribute.String(otel.EntityCacheOperationGet),
				),
			)
		}
	}

	for _, event := range snapshot.ShadowComparisons {
		if !event.IsFresh {
			m.instruments.shadowStaleness.Add(ctx, 1,
				m.attrs(otel.CacheMetricsCacheTypeAttribute.String(cacheTypeFromEntityType(event.EntityType))),
			)
		}
	}

	for _, event := range snapshot.MutationEvents {
		if event.HadCachedValue {
			m.instruments.invalidations.Add(ctx, 1,
				m.attrs(otel.EntityCacheSourceAttribute.String(invalidationSource(event.Source))),
			)
		}
	}

	for _, opErr := range snapshot.CacheOpErrors {
		m.instruments.operationErrors.Add(ctx, 1,
			m.attrs(
				otel.CacheMetricsOperationAttribute.String(opErr.Operation),
				otel.EntityCacheCacheNameAttribute.String(opErr.CacheName),
				otel.EntityCacheEntityTypeAttribute.String(opErr.EntityType),
			),
		)
	}
}

func cacheTypeFromEntityType(entityType string) string {
	if entityType != "" {
		return otel.EntityCacheTypeEntity
	}
	return otel.EntityCacheTypeRootField
}

// populationSource maps a cache write event's trigger source onto the metric
// label. Falls back to "query" when the source is unset (empty string) — that
// matches the pre-existing hardcoded default and keeps older analytics payloads
// from losing their populate counts.
func populationSource(s resolve.CacheOperationSource) string {
	switch s {
	case resolve.CacheSourceMutation:
		return otel.EntityCacheSourceMutation
	case resolve.CacheSourceSubscription:
		return otel.EntityCacheSourceSubscription
	case resolve.CacheSourceQuery:
		return otel.EntityCacheSourceQuery
	default:
		return otel.EntityCacheSourceQuery
	}
}

// invalidationSource maps a mutation/subscription event's trigger source onto
// the metric label. Defaults to "mutation" when unset to preserve the previous
// hardcoded value.
func invalidationSource(s resolve.CacheOperationSource) string {
	switch s {
	case resolve.CacheSourceSubscription:
		return otel.EntityCacheSourceSubscription
	case resolve.CacheSourceQuery:
		return otel.EntityCacheSourceQuery
	case resolve.CacheSourceMutation:
		return otel.EntityCacheSourceMutation
	default:
		return otel.EntityCacheSourceMutation
	}
}

func (m *EntityCacheMetrics) recordRequestStat(ctx context.Context, typ, cacheLevel, cacheType string) {
	m.instruments.requestsStats.Add(ctx, 1,
		m.attrs(otel.CacheMetricsTypeAttribute.String(typ), otel.EntityCacheCacheLevelAttribute.String(cacheLevel), otel.CacheMetricsCacheTypeAttribute.String(cacheType)),
	)
}
