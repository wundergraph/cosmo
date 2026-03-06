# Task 10: Entity Cache Metrics / Observability

## Objective

Implement OTEL metrics for entity caching: cache hit/miss counters, key lifecycle counters, L2 latency histogram, invalidation/population counters, and shadow mode staleness counter. Integrate with the existing router telemetry system.

## Scope

- New file: `router/pkg/metric/entity_cache_metrics.go`
- Define 6 OTEL metrics with appropriate labels
- Register metrics in the graph server's metric setup
- Collect per-request cache stats after execution

## Dependencies

| Task | What it provides |
|------|-----------------|
| Task 00 | **Upgraded graphql-go-tools with `resolve.CacheAnalyticsSnapshot` and `resolve.Context.GetCacheStats()`** |
| Task 09 | `CachingOptions.EnableCacheAnalytics` set per-request; resolve context with cache stats after execution |

## Metrics Reference

From ENTITY_CACHING_CONFIGURATION.md analytics section:

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `router.entity_cache.requests.stats` | Counter | `type` (hits/misses), `cache_level` (l1/l2), `cache_type` (entity/root_field) | Cache request statistics |
| `router.entity_cache.keys.stats` | Counter | `operation` (added/updated/evicted), `cache_type` | Key lifecycle statistics |
| `router.entity_cache.latency` | Histogram | `cache_level` (l2), `operation` (get/set/delete) | L2 operation latency in ms |
| `router.entity_cache.invalidations` | Counter | `source` (mutation/subscription/extension) | Invalidation counts by trigger source |
| `router.entity_cache.populations` | Counter | `source` (mutation/subscription/query) | Population counts by trigger source |
| `router.entity_cache.shadow.staleness` | Counter | `cache_type` | Shadow mode: cached data differs from fresh data |

## Files to Create/Modify

### New File: `router/pkg/metric/entity_cache_metrics.go`

Follow the existing `EngineMetrics` pattern from `engine_metrics.go` (lines 55-61):

```go
package metric

import (
    "go.opentelemetry.io/otel/attribute"
    otelmetric "go.opentelemetry.io/otel/metric"
    "go.uber.org/zap"
)

// Attribute keys
var (
    entityCacheTypeAttr      = attribute.Key("type")       // hits, misses
    entityCacheLevelAttr     = attribute.Key("cache_level") // l1, l2
    entityCacheCacheTypeAttr = attribute.Key("cache_type")  // entity, root_field
    entityCacheOperationAttr = attribute.Key("operation")   // get, set, delete / added, updated, evicted
    entityCacheSourceAttr    = attribute.Key("source")      // mutation, subscription, extension, query
)

type entityCacheInstruments struct {
    requestsStats    otelmetric.Int64Counter
    keysStats        otelmetric.Int64Counter
    latency          otelmetric.Float64Histogram
    invalidations    otelmetric.Int64Counter
    populations      otelmetric.Int64Counter
    shadowStaleness  otelmetric.Int64Counter
}

type EntityCacheMetrics struct {
    instruments    *entityCacheInstruments
    meter          otelmetric.Meter
    baseAttributes []attribute.KeyValue
    logger         *zap.Logger
}

func NewEntityCacheMetrics(
    meter otelmetric.Meter,
    baseAttributes []attribute.KeyValue,
    logger *zap.Logger,
) (*EntityCacheMetrics, error) {
    instruments, err := setupEntityCacheInstruments(meter)
    if err != nil {
        return nil, err
    }
    return &EntityCacheMetrics{
        instruments:    instruments,
        meter:          meter,
        baseAttributes: baseAttributes,
        logger:         logger,
    }, nil
}

func setupEntityCacheInstruments(m otelmetric.Meter) (*entityCacheInstruments, error) {
    requestsStats, err := m.Int64Counter(
        "router.entity_cache.requests.stats",
        otelmetric.WithDescription("Entity cache request statistics (hits/misses)"),
    )
    if err != nil {
        return nil, err
    }

    keysStats, err := m.Int64Counter(
        "router.entity_cache.keys.stats",
        otelmetric.WithDescription("Entity cache key lifecycle statistics"),
    )
    if err != nil {
        return nil, err
    }

    latency, err := m.Float64Histogram(
        "router.entity_cache.latency",
        otelmetric.WithDescription("L2 cache operation latency in milliseconds"),
        otelmetric.WithUnit("ms"),
    )
    if err != nil {
        return nil, err
    }

    invalidations, err := m.Int64Counter(
        "router.entity_cache.invalidations",
        otelmetric.WithDescription("Cache invalidation counts by trigger source"),
    )
    if err != nil {
        return nil, err
    }

    populations, err := m.Int64Counter(
        "router.entity_cache.populations",
        otelmetric.WithDescription("Cache population counts by trigger source"),
    )
    if err != nil {
        return nil, err
    }

    shadowStaleness, err := m.Int64Counter(
        "router.entity_cache.shadow.staleness",
        otelmetric.WithDescription("Shadow mode: count where cached data differed from fresh data"),
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
    }, nil
}
```

**Recording methods**:

```go
func (m *EntityCacheMetrics) RecordCacheHit(ctx context.Context, cacheLevel, cacheType string) {
    m.instruments.requestsStats.Add(ctx, 1,
        otelmetric.WithAttributes(
            append(m.baseAttributes,
                entityCacheTypeAttr.String("hits"),
                entityCacheLevelAttr.String(cacheLevel),
                entityCacheCacheTypeAttr.String(cacheType),
            )...,
        ),
    )
}

func (m *EntityCacheMetrics) RecordCacheMiss(ctx context.Context, cacheLevel, cacheType string) {
    m.instruments.requestsStats.Add(ctx, 1,
        otelmetric.WithAttributes(
            append(m.baseAttributes,
                entityCacheTypeAttr.String("misses"),
                entityCacheLevelAttr.String(cacheLevel),
                entityCacheCacheTypeAttr.String(cacheType),
            )...,
        ),
    )
}

func (m *EntityCacheMetrics) RecordL2Latency(ctx context.Context, durationMs float64, operation string) {
    m.instruments.latency.Record(ctx, durationMs,
        otelmetric.WithAttributes(
            append(m.baseAttributes,
                entityCacheLevelAttr.String("l2"),
                entityCacheOperationAttr.String(operation),
            )...,
        ),
    )
}

// ... similar methods for keysStats, invalidations, populations, shadowStaleness
```

### Modify: `router/core/graph_server.go`

**Register entity cache metrics** in the graph server initialization, alongside existing `EngineMetrics`:

```go
// In newGraphServer() or metric setup section:
if gs.entityCachingConfig.Enabled && gs.entityCachingConfig.Analytics.Enabled {
    gs.entityCacheMetrics, err = rmetric.NewEntityCacheMetrics(
        meter, baseAttributes, gs.logger,
    )
    if err != nil {
        return nil, fmt.Errorf("entity cache metrics: %w", err)
    }
}
```

**New field on `graphServer`**:

```go
entityCacheMetrics *rmetric.EntityCacheMetrics
```

### Modify: `router/core/graphql_handler.go`

**Collect per-request stats after execution**. After the resolver completes, read the cache statistics snapshot:

```go
// After resolver execution:
if h.entityCacheMetrics != nil {
    snapshot := resolveCtx.GetCacheStats()
    h.entityCacheMetrics.RecordSnapshot(ctx, snapshot)
}
```

**`RecordSnapshot` method** (on `EntityCacheMetrics`):

The actual snapshot type from the upgraded graphql-go-tools is `resolve.CacheAnalyticsSnapshot`, which contains detailed event arrays:

```go
type CacheAnalyticsSnapshot struct {
    L1Reads            []CacheKeyEvent
    L2Reads            []CacheKeyEvent
    L1Writes           []CacheWriteEvent
    L2Writes           []CacheWriteEvent
    FetchTimings       []FetchTimingEvent
    ErrorEvents        []SubgraphErrorEvent
    FieldHashes        []EntityFieldHash
    EntityTypes        []EntityTypeInfo
    ShadowComparisons  []ShadowComparisonEvent
    MutationEvents     []MutationEvent
    HeaderImpactEvents []HeaderImpactEvent
}
```

Each `CacheKeyEvent` has a `Kind` field (`CacheKeyHit`, `CacheKeyMiss`, `CacheKeyPartialHit`), a `DataSource` field (subgraph name), and `EntityType`.

```go
func (m *EntityCacheMetrics) RecordSnapshot(ctx context.Context, snapshot resolve.CacheAnalyticsSnapshot) {
    // L1 reads
    for _, event := range snapshot.L1Reads {
        switch event.Kind {
        case resolve.CacheKeyHit:
            m.RecordCacheHit(ctx, "l1", "entity")
        case resolve.CacheKeyMiss:
            m.RecordCacheMiss(ctx, "l1", "entity")
        }
    }
    // L2 reads
    for _, event := range snapshot.L2Reads {
        switch event.Kind {
        case resolve.CacheKeyHit:
            m.RecordCacheHit(ctx, "l2", "entity")
        case resolve.CacheKeyMiss:
            m.RecordCacheMiss(ctx, "l2", "entity")
        }
    }
    // Shadow comparisons → staleness counter
    for _, event := range snapshot.ShadowComparisons {
        if !event.IsFresh {
            m.RecordShadowStaleness(ctx, "entity")
        }
    }
    // L2 writes → population counter
    for range snapshot.L2Writes {
        m.RecordPopulation(ctx, "query")
    }
    // Mutation events → invalidation/population counters
    for _, event := range snapshot.MutationEvents {
        if event.HadCachedValue {
            m.RecordInvalidation(ctx, "mutation")
        }
    }
}
```

## Cardinality Considerations

- **`type`**: 2 values (hits, misses) — low
- **`cache_level`**: 2 values (l1, l2) — low
- **`cache_type`**: 2 values (entity, root_field) — low
- **`operation`**: 3 values (get, set, delete) or (added, updated, evicted) — low
- **`source`**: 3-4 values (mutation, subscription, extension, query) — low

Total cardinality is bounded and safe for production use.

## `hash_entity_keys` Configuration

The `analytics.hash_entity_keys` flag from router YAML config applies to log messages and trace attributes that include entity key values. The metrics above use aggregate counters and don't include key values in labels, so `hash_entity_keys` doesn't affect metric recording. It only affects:
- Log messages that include cache keys (e.g., debug logging of cache hits/misses)
- Trace span attributes that include entity keys

## Verification

1. **Compilation**: `cd router && go build ./...` succeeds
2. **Metric registration**: With analytics enabled, all 6 metrics register without errors
3. **Metric recording**: After a request with cache activity, metrics have correct values
4. **Disabled analytics**: With `analytics.enabled: false`, no metrics are created or recorded
5. **OTLP export**: Metrics appear in OTLP exporter output
6. **Prometheus export**: Metrics appear in `/metrics` endpoint
7. **Existing tests pass**: `cd router && go test ./...` — no regressions

## Out of Scope

- Per-request CachingOptions setup (Task 09)
- Cache backend implementations (Task 03)
- Integration tests (Task 11)
