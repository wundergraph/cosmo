package metric

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
)

const (
	cosmoEntityCacheMeterName    = "cosmo.router.entity_cache"
	cosmoEntityCacheMeterVersion = "0.0.1"

	entityCacheMetricBaseKey = "router.entity_cache."

	EntityCacheReads             = entityCacheMetricBaseKey + "reads"
	EntityCacheWrites            = entityCacheMetricBaseKey + "writes"
	EntityCacheCachedBytesServed = entityCacheMetricBaseKey + "cached_bytes_served"
	EntityCacheFetchDuration     = entityCacheMetricBaseKey + "fetch.duration_milliseconds"
	EntityCacheMutations         = entityCacheMetricBaseKey + "mutations"
	EntityCacheShadowComparisons = entityCacheMetricBaseKey + "shadow_comparisons"
	EntityCacheOperationErrors   = entityCacheMetricBaseKey + "operation_errors"
)

type EntityCacheMetrics interface {
	RecordSnapshot(ctx context.Context, snapshot resolve.CacheAnalyticsSnapshot)
	Shutdown() error
}

type entityCacheInstruments struct {
	reads             otelmetric.Int64Counter
	writes            otelmetric.Int64Counter
	cachedBytesServed otelmetric.Int64Counter
	fetchDuration     otelmetric.Float64Histogram
	mutations         otelmetric.Int64Counter
	shadowComparisons otelmetric.Int64Counter
	operationErrors   otelmetric.Int64Counter
}

type entityCacheMetrics struct {
	instruments    *entityCacheInstruments
	baseAttributes []attribute.KeyValue
}

type NoopEntityCacheMetrics struct{}

type entityCacheMetricStore struct {
	otlp       EntityCacheMetrics
	prometheus EntityCacheMetrics
}

func NewEntityCacheMetricStore(
	logger *zap.Logger,
	baseAttributes []attribute.KeyValue,
	otlpProvider *sdkmetric.MeterProvider,
	prometheusProvider *sdkmetric.MeterProvider,
	cfg *Config,
) (EntityCacheMetrics, error) {
	if cfg == nil || (!cfg.OpenTelemetry.EntityCachingStats && !cfg.Prometheus.EntityCachingStats) {
		return NoopEntityCacheMetrics{}, nil
	}

	otlpMetrics, err := NewEntityCacheMetrics(logger, baseAttributes, otlpProvider, cfg.OpenTelemetry.EntityCachingStats)
	if err != nil {
		return nil, fmt.Errorf("failed to create OTLP entity cache metrics: %w", err)
	}

	prometheusMetrics, err := NewEntityCacheMetrics(logger, baseAttributes, prometheusProvider, cfg.Prometheus.EntityCachingStats)
	if err != nil {
		return nil, fmt.Errorf("failed to create Prometheus entity cache metrics: %w", err)
	}

	return &entityCacheMetricStore{
		otlp:       otlpMetrics,
		prometheus: prometheusMetrics,
	}, nil
}

func NewEntityCacheMetrics(
	_ *zap.Logger,
	baseAttributes []attribute.KeyValue,
	provider *sdkmetric.MeterProvider,
	enabled bool,
) (EntityCacheMetrics, error) {
	if !enabled {
		return NoopEntityCacheMetrics{}, nil
	}

	meter := provider.Meter(cosmoEntityCacheMeterName, otelmetric.WithInstrumentationVersion(cosmoEntityCacheMeterVersion))
	instruments, err := setupEntityCacheInstruments(meter)
	if err != nil {
		return nil, err
	}

	return &entityCacheMetrics{
		instruments:    instruments,
		baseAttributes: baseAttributes,
	}, nil
}

func setupEntityCacheInstruments(meter otelmetric.Meter) (*entityCacheInstruments, error) {
	reads, err := meter.Int64Counter(
		EntityCacheReads,
		otelmetric.WithDescription("Entity cache read count split by cache level and outcome."),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create entity cache reads counter: %w", err)
	}

	writes, err := meter.Int64Counter(
		EntityCacheWrites,
		otelmetric.WithDescription("Entity cache write count split by cache level."),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create entity cache writes counter: %w", err)
	}

	cachedBytesServed, err := meter.Int64Counter(
		EntityCacheCachedBytesServed,
		otelmetric.WithUnit(unitBytes),
		otelmetric.WithDescription("Entity cache bytes served from cache hits."),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create entity cache cached bytes counter: %w", err)
	}

	fetchDuration, err := meter.Float64Histogram(
		EntityCacheFetchDuration,
		otelmetric.WithUnit(unitMilliseconds),
		otelmetric.WithDescription("Entity cache fetch duration in milliseconds."),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create entity cache fetch duration histogram: %w", err)
	}

	mutations, err := meter.Int64Counter(
		EntityCacheMutations,
		otelmetric.WithDescription("Entity cache mutation events split by invalidation and population result."),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create entity cache mutations counter: %w", err)
	}

	shadowComparisons, err := meter.Int64Counter(
		EntityCacheShadowComparisons,
		otelmetric.WithDescription("Entity cache shadow comparison count split by fresh or stale result."),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create entity cache shadow comparisons counter: %w", err)
	}

	operationErrors, err := meter.Int64Counter(
		EntityCacheOperationErrors,
		otelmetric.WithDescription("Entity cache operation error count."),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create entity cache operation errors counter: %w", err)
	}

	return &entityCacheInstruments{
		reads:             reads,
		writes:            writes,
		cachedBytesServed: cachedBytesServed,
		fetchDuration:     fetchDuration,
		mutations:         mutations,
		shadowComparisons: shadowComparisons,
		operationErrors:   operationErrors,
	}, nil
}

func (m *entityCacheMetrics) RecordSnapshot(ctx context.Context, snapshot resolve.CacheAnalyticsSnapshot) {
	m.recordReads(ctx, resolve.CacheLevelL1, snapshot.L1Reads)
	m.recordReads(ctx, resolve.CacheLevelL2, snapshot.L2Reads)
	m.recordWrites(ctx, resolve.CacheLevelL1, snapshot.L1Writes)
	m.recordWrites(ctx, resolve.CacheLevelL2, snapshot.L2Writes)

	if cachedBytes := snapshot.CachedBytesServed(); cachedBytes > 0 {
		m.instruments.cachedBytesServed.Add(ctx, int64(cachedBytes), m.addOptions())
	}

	for _, event := range snapshot.FetchTimings {
		m.instruments.fetchDuration.Record(ctx, durationMilliseconds(event.Duration), m.recordOptions(
			attribute.String("subgraph_name", event.SubgraphName),
			attribute.String("cache_name", event.CacheName),
			attribute.String("operation", event.Operation),
		))
	}

	for _, event := range snapshot.MutationEvents {
		if event.Deleted {
			m.instruments.mutations.Add(ctx, 1, m.addOptions(
				attribute.String("entity_type", event.EntityType),
				attribute.String("operation", event.Operation),
				attribute.String("result", "invalidation"),
			))
		}
		if event.Written {
			m.instruments.mutations.Add(ctx, 1, m.addOptions(
				attribute.String("entity_type", event.EntityType),
				attribute.String("operation", event.Operation),
				attribute.String("result", "population"),
			))
		}
	}
	for _, event := range snapshot.CacheInvalidations {
		if event.Deleted {
			m.instruments.mutations.Add(ctx, 1, m.addOptions(
				attribute.String("entity_type", event.EntityType),
				attribute.String("operation", event.Source),
				attribute.String("result", "invalidation"),
			))
		}
	}

	for _, event := range snapshot.ShadowComparisons {
		result := "stale"
		if event.Matched {
			result = "fresh"
		}
		m.instruments.shadowComparisons.Add(ctx, 1, m.addOptions(
			attribute.String("entity_type", event.EntityType),
			attribute.String("result", result),
		))
	}

	for _, event := range snapshot.CacheOpErrors {
		m.instruments.operationErrors.Add(ctx, 1, m.addOptions(
			attribute.String("operation", event.Operation),
			attribute.String("cache_name", event.CacheName),
		))
	}
}

func (m *entityCacheMetrics) recordReads(ctx context.Context, level resolve.CacheLevel, events []resolve.CacheKeyEvent) {
	for _, event := range events {
		outcome := "miss"
		if event.Hit {
			outcome = "hit"
		}
		m.instruments.reads.Add(ctx, 1, m.addOptions(
			attribute.String("cache_level", string(level)),
			attribute.String("outcome", outcome),
			attribute.String("entity_type", event.EntityType),
		))
	}
}

func (m *entityCacheMetrics) recordWrites(ctx context.Context, level resolve.CacheLevel, events []resolve.CacheWriteEvent) {
	for _, event := range events {
		m.instruments.writes.Add(ctx, 1, m.addOptions(
			attribute.String("cache_level", string(level)),
			attribute.String("entity_type", event.EntityType),
		))
	}
}

func (m *entityCacheMetrics) addOptions(attrs ...attribute.KeyValue) otelmetric.AddOption {
	return otelmetric.WithAttributeSet(attribute.NewSet(m.attributes(attrs...)...))
}

func (m *entityCacheMetrics) recordOptions(attrs ...attribute.KeyValue) otelmetric.RecordOption {
	return otelmetric.WithAttributeSet(attribute.NewSet(m.attributes(attrs...)...))
}

func (m *entityCacheMetrics) attributes(attrs ...attribute.KeyValue) []attribute.KeyValue {
	merged := make([]attribute.KeyValue, 0, len(m.baseAttributes)+len(attrs))
	merged = append(merged, m.baseAttributes...)
	merged = append(merged, attrs...)
	return merged
}

func (m *entityCacheMetrics) Shutdown() error {
	return nil
}

func (NoopEntityCacheMetrics) RecordSnapshot(context.Context, resolve.CacheAnalyticsSnapshot) {}

func (NoopEntityCacheMetrics) Shutdown() error {
	return nil
}

func (s *entityCacheMetricStore) RecordSnapshot(ctx context.Context, snapshot resolve.CacheAnalyticsSnapshot) {
	s.otlp.RecordSnapshot(ctx, snapshot)
	s.prometheus.RecordSnapshot(ctx, snapshot)
}

func (s *entityCacheMetricStore) Shutdown() error {
	var err error
	if shutdownErr := s.otlp.Shutdown(); shutdownErr != nil {
		err = shutdownErr
	}
	if shutdownErr := s.prometheus.Shutdown(); shutdownErr != nil {
		err = errors.Join(err, shutdownErr)
	}
	return err
}

func durationMilliseconds(duration time.Duration) float64 {
	return float64(duration) / float64(time.Millisecond)
}
