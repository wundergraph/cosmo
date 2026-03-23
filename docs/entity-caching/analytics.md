# Entity Cache Analytics — Available Data from graphql-go-tools

This document describes the cache analytics data that `graphql-go-tools` collects during request
execution and makes available to the router via `resolve.CacheAnalyticsSnapshot`. This data can
be used to build an entity cache analytics pipeline in a future PR.

## How to Enable Collection

Set `EnableCacheAnalytics: true` in `resolve.CachingOptions` when executing a request. After
execution, call `resolveCtx.GetCacheStats()` to obtain a `CacheAnalyticsSnapshot`.

The router already does this when entity cache OTEL metrics are configured (see
`graphql_handler.go:cachingOptions` and `graphql_handler.go:recordEntityCacheMetrics`).

## CacheAnalyticsSnapshot Fields

The snapshot is a read-only struct returned by the analytics collector after request execution.

### Cache Read Events

| Field | Type | Description |
|-------|------|-------------|
| `L1Reads` | `[]CacheKeyEvent` | L1 (in-memory, per-request) cache key lookup results |
| `L2Reads` | `[]CacheKeyEvent` | L2 (external, e.g. Redis) cache key lookup results |

Each `CacheKeyEvent` contains:
- `CacheKey` — the full cache key string
- `EntityType` — entity type name (e.g. `"User"`)
- `Kind` — `CacheKeyHit`, `CacheKeyMiss`, or `CacheKeyPartialHit`
- `DataSource` — subgraph name (e.g. `"accounts"`)
- `ByteSize` — byte size of the cached value (hits only)
- `CacheAgeMs` — age of cached entry in ms (L2 hits only, 0 = unknown)
- `Shadow` — true if this event occurred in shadow mode

### Cache Write Events

| Field | Type | Description |
|-------|------|-------------|
| `L1Writes` | `[]CacheWriteEvent` | L1 cache write operations |
| `L2Writes` | `[]CacheWriteEvent` | L2 cache write operations |

Each `CacheWriteEvent` contains:
- `CacheKey`, `EntityType`, `DataSource` — same as read events
- `ByteSize` — byte size of the value written
- `CacheLevel` — `CacheLevelL1` or `CacheLevelL2`
- `TTL` — configured TTL for this write
- `Shadow` — true if this write occurred in shadow mode

### Fetch Timing Events

| Field | Type | Description |
|-------|------|-------------|
| `FetchTimings` | `[]FetchTimingEvent` | Duration of each subgraph fetch or cache lookup |

Each `FetchTimingEvent` contains:
- `DataSource` — subgraph name
- `EntityType` — entity type (empty for root fetches)
- `DurationMs` — time spent in milliseconds
- `Source` — `FieldSourceSubgraph`, `FieldSourceL1`, `FieldSourceL2`, or `FieldSourceShadowCached`
- `ItemCount` — number of entities in this fetch/lookup
- `IsEntityFetch` — true for `_entities` fetches, false for root fields
- `HTTPStatusCode` — HTTP status from subgraph response (0 for cache hits)
- `ResponseBytes` — response body size in bytes (0 for cache hits)
- `TTFBMs` — time to first byte in milliseconds (0 when unavailable)

### Subgraph Error Events

| Field | Type | Description |
|-------|------|-------------|
| `ErrorEvents` | `[]SubgraphErrorEvent` | Errors encountered during subgraph fetches |

Each `SubgraphErrorEvent` contains:
- `DataSource` — subgraph name
- `EntityType` — entity type (empty for root fetches)
- `Message` — error message (truncated for safety)
- `Code` — error code from `errors[0].extensions.code`

### Field Value Hashes

| Field | Type | Description |
|-------|------|-------------|
| `FieldHashes` | `[]EntityFieldHash` | xxhash of scalar field values on entities |

Each `EntityFieldHash` contains:
- `EntityType`, `FieldName` — which field on which entity
- `FieldHash` — xxhash of the non-key field value
- `KeyRaw` — raw key JSON e.g. `{"id":"1234"}` (when `HashKeys=false`)
- `KeyHash` — xxhash of key JSON (when `HashKeys=true`)
- `Source` — where the entity data came from (L1/L2/Subgraph)

### Entity Type Tracking

| Field | Type | Description |
|-------|------|-------------|
| `EntityTypes` | `[]EntityTypeInfo` | Entity types encountered and their counts |

Each `EntityTypeInfo` contains:
- `TypeName` — entity type name
- `Count` — total instances encountered
- `UniqueKeys` — number of distinct entity keys

### Shadow Mode Events

| Field | Type | Description |
|-------|------|-------------|
| `ShadowComparisons` | `[]ShadowComparisonEvent` | Comparisons between cached and fresh data |

Each `ShadowComparisonEvent` contains:
- `CacheKey`, `EntityType`, `DataSource` — identification
- `IsFresh` — true if ProvidesData fields match between cached and fresh
- `CachedHash`, `FreshHash` — xxhash of ProvidesData fields
- `CachedBytes`, `FreshBytes` — byte sizes
- `CacheAgeMs` — age of the cached entry
- `ConfiguredTTL` — TTL configured for this entity type

### Mutation Events

| Field | Type | Description |
|-------|------|-------------|
| `MutationEvents` | `[]MutationEvent` | Mutations that returned cacheable entities |

Each `MutationEvent` contains:
- `MutationRootField` — e.g. `"updateUsername"`
- `EntityType` — e.g. `"User"`
- `EntityCacheKey` — display key e.g. `{"__typename":"User","key":{"id":"1234"}}`
- `HadCachedValue` — true if L2 had a cached value
- `IsStale` — true if cached value differs from mutation response
- `CachedHash`, `FreshHash` — xxhash of ProvidesData fields
- `CachedBytes`, `FreshBytes` — byte sizes

### Header Impact Events

| Field | Type | Description |
|-------|------|-------------|
| `HeaderImpactEvents` | `[]HeaderImpactEvent` | L2 writes with header-prefixed keys |

Each `HeaderImpactEvent` contains:
- `BaseKey` — cache key WITHOUT header prefix (grouping key)
- `HeaderHash` — hash of forwarded headers for this subgraph
- `ResponseHash` — xxhash of the response value bytes written to L2
- `EntityType`, `DataSource` — identification

**Usage:** When the same `BaseKey` appears with different `HeaderHash` values but identical
`ResponseHash` values, the forwarded headers don't affect the response and
`IncludeSubgraphHeaderPrefix` can be disabled for that subgraph.

## Computed Convenience Methods

The snapshot provides these computed methods:

| Method | Returns | Description |
|--------|---------|-------------|
| `L1HitRate()` | `float64` | L1 hit rate in [0,1] |
| `L2HitRate()` | `float64` | L2 hit rate in [0,1] |
| `CachedBytesServed()` | `int64` | Total bytes served from L1+L2 hits |
| `EventsByEntityType()` | `map[string]EntityTypeCacheStats` | Per-entity-type cache stats |
| `EventsByDataSource()` | `map[string]DataSourceCacheStats` | Per-data-source cache stats |
| `SubgraphCallsAvoided()` | `int64` | Number of subgraph fetches avoided by cache |
| `PartialHitRate()` | `float64` | Fraction of lookups that were partial hits |
| `ErrorsByDataSource()` | `map[string]int` | Error counts grouped by subgraph |
| `ErrorRate()` | `float64` | Fraction of fetches that errored |
| `AvgFetchDurationMs(ds)` | `int64` | Average fetch duration for a data source |
| `TotalTimeSavedMs()` | `int64` | Estimated time saved by cache hits |
| `AvgCacheAgeMs(type)` | `int64` | Average L2 cache entry age |
| `MaxCacheAgeMs()` | `int64` | Max L2 cache entry age |
| `ShadowFreshnessRate()` | `float64` | Fraction of shadow hits where data was fresh |
| `ShadowStaleCount()` | `int64` | Number of stale shadow comparisons |
| `ShadowFreshnessRateByEntityType()` | `map[string]float64` | Per-entity-type freshness rates |

## Integration Points in the Router

The analytics data flows through these points:

1. **`graphql_handler.go:cachingOptions()`** — sets `EnableCacheAnalytics` on `resolve.CachingOptions`
2. **`graphql_handler.go:recordEntityCacheMetrics()`** — after execution, calls `resolveCtx.GetCacheStats()`
   and passes snapshot to OTEL metrics. **This is where an analytics exporter should be added.**
3. **`graph_server.go`** — passes metrics and handler options to the GraphQL handler
4. **`router.go`** — sets up exporters during router initialization

## Implementation Notes for Future Analytics Pipeline

- The snapshot is available per-request; an analytics pipeline should aggregate across requests
  before exporting (e.g. group by operation hash + client + schema version)
- Consider a batched async exporter (similar to `graphqlmetrics`) to avoid adding latency
- The `OperationMeta` (operation hash, name, type, client info, schema version) can be extracted
  from `requestContext` at the same call site
- Field hashes enable cross-request change detection (same entity key, different field hash = data changed)
- Header impact events enable automated detection of unnecessary `IncludeSubgraphHeaderPrefix` configs
- Shadow comparison events are key for validating TTL tuning before going live
