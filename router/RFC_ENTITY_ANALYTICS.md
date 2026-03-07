# RFC: Entity Analytics for Cosmo Router

## Context

Entity caching is being added to the Cosmo Router. The router already has 6 basic OTEL metrics (hit/miss counters, latency histogram, invalidation/population counts). These are useful for operational dashboards but tell users almost nothing about their entities, their API behavior, or where caching can actually help.

The engine's `CacheAnalyticsSnapshot` exposes far richer data than what current metrics consume. In particular, the engine already computes **per-field xxhash values** for every entity (`EntityFieldHash`), tracks **entity cardinality** (`EntityTypeInfo` with count + unique keys), records **mutation impact with hash comparison** (`MutationEvent`), performs **shadow staleness detection with cache age** (`ShadowComparisonEvent`), and captures **header-based cache key differentiation** (`HeaderImpactEvent`). Most of this data is currently unused.

This RFC proposes **Entity Analytics** — a system that turns this raw observable data into actionable intelligence about entity behavior, API access patterns, caching opportunities, and cost optimization. The scope is the router side only; the backend collector and Studio UI are separate concerns.

---

## What Data Is Already Available (Unused)

The engine already emits these events per request via `CacheAnalyticsSnapshot`. Most are **not consumed** by the current OTEL metrics:

| Event Type | Key Fields | Currently Used? |
|---|---|---|
| `EntityFieldHash` | EntityType, FieldName, FieldHash (xxhash), KeyHash, Source (L1/L2/Subgraph) | **No** |
| `EntityTypeInfo` | TypeName, Count (instances), UniqueKeys (distinct @key values) | **No** |
| `FetchTimingEvent` | DataSource, EntityType, DurationMs, Source, ItemCount, HTTPStatusCode, ResponseBytes, TTFBMs | Partially (L2 latency only) |
| `ShadowComparisonEvent` | EntityType, IsFresh, CachedHash, FreshHash, CacheAgeMs, ConfiguredTTL, DataSource | Partially (stale count only) |
| `MutationEvent` | MutationRootField, EntityType, HadCachedValue, IsStale, CachedHash, FreshHash | Partially (invalidation count only) |
| `HeaderImpactEvent` | EntityType, DataSource, BaseKey, HeaderHash, ResponseHash | **No** |
| `SubgraphErrorEvent` | DataSource, EntityType, Message, Code | **No** |
| `CacheKeyEvent` | EntityType, DataSource, Kind, ByteSize, CacheAgeMs | Partially (hit/miss count only) |
| `CacheWriteEvent` | EntityType, DataSource, ByteSize, TTL | Partially (count only) |

The key insight: **the engine already does the expensive work** (hashing fields, comparing cached vs fresh data, tracking cardinality). We're throwing away the results.

---

## End-User Capabilities

### 1. Entity Behavior Intelligence

By collecting `EntityFieldHash` data over time, users gain deep understanding of how their entities behave:

**"How volatile are my entities?"**
- Field hashes reveal which entity types change frequently vs remain stable
- A `User.email` that never changes its hash across thousands of requests is a prime caching target
- A `Product.inventory` that changes its hash every few seconds needs short TTLs or no caching
- The backend can compute a **volatility score** per entity type per field by tracking hash change frequency

**"What are my entity access patterns?"**
- Entity cardinality data (`EntityTypeInfo.UniqueKeys`) reveals concentration: are 90% of requests hitting 10% of entities?
- High concentration → small cache, high hit rate. Low concentration → large cache, diminishing returns
- Combined with field hashes: are the "hot" entities also the stable ones? If yes, caching ROI is excellent

**"Which fields drive entity changes?"**
- Field-level hashes pinpoint exactly which fields make entities volatile
- `Product.price` changes hourly but `Product.name`, `Product.description`, `Product.imageUrl` never change
- This informs **field-level caching strategies**: cache the stable fields, skip the volatile ones (future optimization)

**"Are my entities consistent across subgraphs?"**
- When the same entity type is served by multiple subgraphs, field hashes from different data sources can be compared
- Inconsistent hashes for the same entity key across subgraphs indicate a data consistency issue

### 2. Caching Opportunity Discovery

**"Where should I enable caching that I'm not currently using?"**
- For operations where entity caching is disabled, we still collect entity type and field data through schema usage tracking
- By correlating schema usage data (which entity types are queried) with entity analytics (how stable those entities are), the backend can recommend which entity types to cache
- Example: "Your `Product` entity is fetched 50,000 times/hour across 12 operations, has 2,000 unique keys, and its field hashes indicate 95% stability over 5 minutes. Enabling a 5-minute TTL would eliminate ~47,500 subgraph calls/hour."

**"What's the right TTL for each entity type?"**
- Shadow mode comparisons provide ground truth: `CacheAgeMs` at the moment of staleness detection tells you exactly when cached data went stale
- If shadow comparisons show entities become stale at ~120s but TTL is 300s, you're serving stale data for 180s
- If shadow comparisons show entities are still fresh at TTL expiry, you can safely increase TTL
- The backend can compute **optimal TTL recommendations** per entity type from this data

**"Is my invalidation strategy working?"**
- `MutationEvent.IsStale` (hash comparison: was the cached value actually different from the mutation result?) reveals invalidation effectiveness
- If `HadCachedValue=true` but `IsStale=false` (hashes match), the invalidation was unnecessary — the mutation didn't change the entity
- If mutations frequently don't change the entity, the invalidation is wasteful
- Conversely, if entities go stale between mutations, TTL is too long or invalidation coverage is incomplete

### 3. Latency Impact & Customer Experience

This is where entity analytics directly connects to customer-facing outcomes. Every `FetchTimingEvent` records the full timing breakdown per entity type: subgraph latency (`DurationMs`), time to first byte (`TTFBMs`), HTTP status, response size, and whether the data came from cache or subgraph. This gives us precise, per-entity-type latency attribution.

**"How much latency does caching eliminate for my customers?"**
- For each entity type, we have both the subgraph fetch latency (on cache misses) and the L2 cache fetch latency (on cache hits)
- The **latency savings per cache hit** = avg subgraph latency − avg L2 latency for that entity type
- Total latency savings = latency savings per hit × number of cache hits
- Example: "Caching `Product` entities saves 45ms per hit (subgraph avg: 48ms, L2 avg: 3ms). With 120,000 hits/hour, that's 1,500 seconds of customer-facing latency eliminated per hour."

**"What latency improvement would I get by enabling caching on entity type X?"**
- For uncached entity types, we already track subgraph fetch timing via `FetchTimingEvent`
- Combined with entity behavior data (volatility, cardinality, access patterns), the backend can project: "Enabling caching on `Order` (avg subgraph latency: 85ms, ~70% predicted hit rate based on cardinality and stability) would reduce p50 latency by ~60ms for the `GetOrderDetails` operation."
- This turns entity analytics into a **what-if simulator** for caching decisions

**"Which entity types are the biggest latency bottlenecks?"**
- Rank entity types by: (subgraph latency × request count) — shows where caching would have the most customer impact
- Correlated with `TTFBMs` (time to first byte): high TTFB indicates network/connection overhead that caching completely eliminates
- Correlated with `ResponseBytes`: large entities benefit more from caching because they avoid both network transfer and deserialization

**"How does caching affect my error rate?"**
- `SubgraphErrorEvent` per entity type tracks error codes and rates from subgraphs
- Cache hits bypass subgraph calls entirely, so caching inherently improves reliability
- The backend can compute: "Your `Inventory` subgraph has a 2.3% error rate. Caching `Inventory` entities with a 60s TTL would shield 85% of requests from those errors."
- During subgraph outages, cached data continues serving (within TTL) — entity analytics can quantify this resilience: "During the 12-minute Inventory outage, cache served 45,000 requests that would have failed."

**"What's the end-to-end latency breakdown per operation?"**
- Since `FetchTimingEvent` includes entity type and data source, we can show per-operation latency waterfalls:
  - Operation `GetProductPage`: `Product` entity (3ms from L2 cache) + `Review` entity (65ms from subgraph) + `User` entity (2ms from L2 cache)
  - This immediately shows: cache `Review` entities next for the biggest latency win on this operation

### 4. Cost & Infrastructure Attribution

**"How much is entity caching saving me?"**
- `FetchTimingEvent` records subgraph fetch duration and L2 cache fetch duration per entity type
- `ResponseBytes` on subgraph fetches × cache hit count = estimated bandwidth savings
- `ItemCount` on batch fetches shows how many subgraph calls were avoided
- The backend can translate this into dollar estimates when users provide subgraph infrastructure cost per request

**"What's the actual cost of each entity type?"**
- Per-entity-type breakdown of: subgraph call count, average latency, total bytes transferred, error rate
- Enables prioritization: cache the most expensive entities first
- Shows which subgraphs are the bottleneck per entity type

**"What's the ROI of my cache infrastructure?"**
- Cache population cost (L2 writes × byte size) vs cache hit savings (subgraph calls avoided × avg subgraph latency)
- Redis memory usage estimation from `ByteSize` data
- Net savings = (subgraph costs avoided) - (Redis infrastructure cost)

### 5. Operational & API Design Insights

**"How does header-based isolation affect my cache?"**
- `HeaderImpactEvent` data shows how many distinct cache key variants exist per entity due to header hashing
- If the same entity (`User:123`) has 500 different header hashes, the cache is fragmented — most variants will miss
- This reveals whether `includeHeaders` is too broad (forwarding auth headers that vary per user)
- The backend can recommend which headers to exclude from cache key computation

**"Which operations share entity data?"**
- By correlating operation hash with entity types accessed, the backend can build an **entity-operation graph**
- Shows which operations fetch the same entity types → cache populated by one operation benefits others
- Identifies entity types that are "hot" across many operations vs isolated to a single use case

**"Does caching mask subgraph instability?"**
- `SubgraphErrorEvent` per entity type reveals which entities/subgraphs are unreliable
- Combined with cache hit data: when a subgraph has errors, are cached entities serving as a fallback?
- This is valuable — it shows caching as a **reliability layer**, not just a performance optimization

### Business Value Summary

| Capability | Business Impact |
|---|---|
| **Latency savings attribution** | **Quantify ms saved per entity type, per operation — directly maps to customer experience** |
| **Caching what-if projections** | **Predict latency improvement before enabling caching — data-driven decisions** |
| **Error shielding quantification** | **Show how caching protects customers from subgraph failures** |
| **Operation latency waterfall** | **Pinpoint which entity types to cache for maximum latency reduction per operation** |
| Entity volatility analysis | Right-size TTLs, avoid serving stale data |
| Caching opportunity discovery | Reduce subgraph costs by identifying uncached stable entities |
| Per-entity-type cost attribution | Prioritize caching investment by actual savings |
| TTL optimization recommendations | Eliminate guesswork from cache configuration |
| Invalidation effectiveness analysis | Stop wasteful invalidations, fix incomplete ones |
| Header isolation analysis | Prevent cache fragmentation from overly broad header forwarding |
| Entity-operation mapping | Understand cross-operation cache sharing benefits |
| Mutation impact tracking | Know which mutations actually change data vs trigger unnecessary invalidation |
| Field-level stability tracking | Foundation for future field-level caching |
| API access pattern analysis | Inform API design (hot entities, co-fetch patterns, cardinality) |

---

## Architecture Decision: Separate Concern vs. Schema Usage Extension

### Recommendation: Separate data pipeline, reuse exporter infrastructure

Entity analytics should be a **separate data pipeline** from schema usage tracking, reusing the generic `Exporter[T]` infrastructure.

**Reasons to keep separate:**

1. **Different data shape** — Schema usage tracks field/argument/input usage per operation. Entity analytics tracks entity behavior (field hashes, volatility, cache interactions, timing, cardinality). Fundamentally different aggregation keys and processing logic.

2. **Different cardinality** — Schema usage is bounded by unique operations × clients. Entity analytics adds entity type × subgraph × field dimensions. Mixing them would complicate aggregation and overwhelm the schema usage pipeline.

3. **Independent lifecycle** — Entity analytics is valuable even without schema usage tracking enabled, and vice versa. Different audiences: entity analytics serves platform engineers optimizing caching; schema usage serves API designers managing schema evolution.

4. **Different backend processing** — Schema usage feeds breaking change detection and field coverage. Entity analytics feeds time-series analysis, TTL recommendations, and cost attribution. The backend processing is completely different.

5. **Additive to existing OTEL metrics** — The current 6 OTEL metrics remain for real-time Grafana dashboards. Entity analytics exports richer data to Cosmo Studio for deeper analysis. No conflict.

**What to reuse:**

- `internal/exporter/exporter.go` — Generic batch exporter (queue, time/size batching, buffer pools, retry with backoff, graceful shutdown). Instantiate as `Exporter[*EntityAnalyticsInfo]`.
- Connect RPC transport pattern from `GraphQLMetricsSink` — New `EntityAnalyticsSink` following same pattern.
- Aggregation pattern from `aggregate.go` — New `AggregateEntityAnalyticsBatch()`.

---

## Resource Efficiency Design

### Principles

1. **The engine already does the expensive work** — Field hashing (xxhash), shadow comparison, mutation impact detection all happen during resolution. The snapshot is already collected for OTEL metrics. Entity analytics adds zero resolution overhead.

2. **Aggregate in-router, export summaries** — Don't export per-entity-key events. Aggregate by (operation hash, entity type, subgraph, field name) before export. Field hashes are aggregated into stability scores, not exported raw.

3. **Async, non-blocking export** — Reuse the exporter's queue-based async pattern. Drop items on queue full rather than block requests.

4. **Batch and aggregate before sending** — Time/size-based batching (1024 items or 10s), then deduplicate identical records in the batch, incrementing counts and merging statistics.

5. **Bounded cardinality** — Aggregation keys are operation hash × entity type × subgraph × field name. All low-cardinality. Never export entity key values or raw field values.

6. **Configurable detail level** — Allow users to control how much data is collected:
   - **Basic**: Cache hit/miss/timing per entity type (low overhead)
   - **Standard**: Basic + field hash stability + cardinality + mutation impact (default)
   - **Full**: Standard + header impact + shadow comparison details + error details

### Overhead per Request

| Step | Where | Cost |
|---|---|---|
| Snapshot collection | Already happens for OTEL | Zero additional |
| Analytics record construction | Request goroutine | ~1-5μs (iterate small event slices, no I/O) |
| Queue enqueue | Channel send | ~10ns |
| Aggregation + export | Background goroutine | Zero request path impact |

---

## Detailed Implementation Plan

### Step 1: Define Protobuf Messages

**New file**: `proto/wg/cosmo/entityanalytics/v1/entityanalytics.proto`

```protobuf
syntax = "proto3";
package wg.cosmo.entityanalytics.v1;

service EntityAnalyticsService {
  rpc PublishEntityAnalytics(PublishEntityAnalyticsRequest)
      returns (PublishEntityAnalyticsResponse) {}
}

message PublishEntityAnalyticsRequest {
  repeated EntityAnalyticsAggregation aggregations = 1;
}

message PublishEntityAnalyticsResponse {}

message EntityAnalyticsAggregation {
  EntityAnalyticsInfo analytics = 1;
  uint64 request_count = 2;
}

// One record per request, aggregated before export
message EntityAnalyticsInfo {
  // Operation context
  OperationInfo operation = 1;
  ClientInfo client = 2;
  SchemaInfo schema = 3;

  // Per entity-type analytics
  repeated EntityTypeAnalytics entity_types = 4;

  // Request-level summary
  RequestSummary summary = 5;
}

message OperationInfo {
  string hash = 1;
  string name = 2;
  OperationType type = 3;
}

enum OperationType {
  QUERY = 0;
  MUTATION = 1;
  SUBSCRIPTION = 2;
}

message ClientInfo {
  string name = 1;
  string version = 2;
}

message SchemaInfo {
  string version = 1;
}

// Core analytics per entity type within a single request
message EntityTypeAnalytics {
  string entity_type = 1;        // e.g. "Product", "User"
  string subgraph_id = 2;        // which subgraph serves this entity

  // --- Cache interaction ---
  CacheStats cache = 3;

  // --- Entity behavior ---
  EntityBehavior behavior = 4;

  // --- Fetch performance ---
  FetchPerformance fetch = 5;

  // --- Mutation impact (only for mutation operations) ---
  MutationImpact mutation_impact = 6;

  // --- Shadow mode analysis ---
  ShadowAnalysis shadow = 7;

  // --- Header isolation analysis ---
  HeaderImpact header_impact = 8;

  // --- Errors ---
  repeated SubgraphError errors = 9;
}

message CacheStats {
  uint32 l1_hits = 1;
  uint32 l1_misses = 2;
  uint32 l2_hits = 3;
  uint32 l2_misses = 4;
  uint32 l2_writes = 5;
  uint32 invalidations = 6;
  uint32 populations = 7;
  uint64 cached_bytes_served = 8;   // total bytes served from cache
  double avg_cache_age_ms = 9;      // average age of cache entries served
}

// Field-level stability data derived from EntityFieldHash events
message EntityBehavior {
  uint32 instance_count = 1;          // how many instances of this entity type
  uint32 unique_keys = 2;            // how many distinct @key values

  // Per-field hash data: aggregated into field stability info
  // FieldName → hash from this request. Backend compares across requests
  // to compute volatility scores.
  repeated FieldSnapshot field_snapshots = 3;
}

message FieldSnapshot {
  string field_name = 1;
  uint64 field_hash = 2;        // xxhash of the field value
  FieldSource source = 3;       // where this field came from
}

enum FieldSource {
  SUBGRAPH = 0;
  L1_CACHE = 1;
  L2_CACHE = 2;
}

message FetchPerformance {
  double subgraph_latency_ms = 1;   // time for subgraph fetch (0 if fully cached)
  double l2_latency_ms = 2;         // time for L2 cache operations
  uint32 subgraph_item_count = 3;   // entities fetched from subgraph
  uint32 cached_item_count = 4;     // entities served from cache
  int32 http_status_code = 5;       // subgraph HTTP response status
  uint64 response_bytes = 6;        // subgraph response size
  double ttfb_ms = 7;               // time to first byte from subgraph

  // Latency impact: enables "what-if" projections and ROI calculations
  // latency_saved_ms = (subgraph_latency_ms - l2_latency_ms) × cached_item_count
  // On cache miss: subgraph_latency_ms is the actual cost customers pay
  // On cache hit: l2_latency_ms is the actual cost (typically 1-5ms vs 50-200ms)
  double latency_saved_ms = 8;      // computed: total latency saved by cache hits in this request

  // Error shielding: subgraph errors that cache hits would have avoided
  uint32 subgraph_errors = 9;       // errors from SubgraphErrorEvent for this entity type
}

message MutationImpact {
  string mutation_field = 1;          // e.g. "updateUser"
  bool had_cached_value = 2;         // was there a cached entry?
  bool entity_changed = 3;           // did the mutation actually change the entity?
                                     // (CachedHash != FreshHash)
  uint64 cached_hash = 4;           // xxhash of cached ProvidesData
  uint64 fresh_hash = 5;            // xxhash of mutation response
}

message ShadowAnalysis {
  uint32 comparisons = 1;           // total shadow comparisons
  uint32 fresh_count = 2;           // times cached data was still fresh
  uint32 stale_count = 3;           // times cached data was stale
  double avg_cache_age_at_stale_ms = 4;  // average cache age when staleness detected
  double configured_ttl_ms = 5;    // TTL setting for this entity type
}

message HeaderImpact {
  uint32 distinct_header_variants = 1;  // how many header hash variants seen
  // If high, header isolation is fragmenting the cache
}

message SubgraphError {
  string message = 1;
  string code = 2;
}

// Request-level summary
message RequestSummary {
  uint32 total_entities_resolved = 1;
  uint32 total_cache_hits = 2;
  uint32 total_cache_misses = 3;
  uint32 subgraph_fetches_avoided = 4;
  double total_l2_latency_ms = 5;
  double total_subgraph_latency_ms = 6;
  uint64 total_cached_bytes = 7;
  uint64 total_fetched_bytes = 8;
  bool had_errors = 9;

  // Latency impact for this entire request
  double total_latency_saved_ms = 10;   // sum of all entity type latency savings
  uint32 total_subgraph_errors = 11;    // total subgraph errors across all entity types
}
```

### Step 2: Build Analytics Record from Snapshot

**New file**: `router/internal/entityanalytics/builder.go`

Transforms `resolve.CacheAnalyticsSnapshot` + `operationContext` into `EntityAnalyticsInfo`:

```go
func BuildEntityAnalyticsInfo(snapshot resolve.CacheAnalyticsSnapshot, opCtx *operationContext) *entityanalyticsv1.EntityAnalyticsInfo {
    // 1. Group all events by (entityType, subgraphID) key
    // 2. For each group, build EntityTypeAnalytics:
    //    - Aggregate CacheKeyEvents → CacheStats
    //    - Aggregate EntityFieldHash events → EntityBehavior.FieldSnapshots
    //    - Aggregate EntityTypeInfo → EntityBehavior.instance_count, unique_keys
    //    - Aggregate FetchTimingEvents → FetchPerformance
    //    - Aggregate MutationEvents → MutationImpact
    //    - Aggregate ShadowComparisonEvents → ShadowAnalysis
    //    - Aggregate HeaderImpactEvents → HeaderImpact
    //    - Collect SubgraphErrorEvents → Errors
    // 3. Compute RequestSummary from totals
    // 4. Attach operation/client/schema context
}
```

This is a pure transformation — iterate event slices, group by entity type, fill proto fields. No I/O, no allocations beyond the proto message itself.

### Step 3: Create Aggregation Logic

**New file**: `router/internal/entityanalytics/aggregate.go`

Follow `graphqlmetrics/aggregate.go` pattern:

```go
func AggregateEntityAnalyticsBatch(batch []*entityanalyticsv1.EntityAnalyticsInfo) *entityanalyticsv1.PublishEntityAnalyticsRequest {
    // Aggregate by: operation hash + schema version + client name/version
    // For matching records: increment request_count
    // Field hashes within EntityBehavior are kept as-is (backend aggregates across time)
    // CacheStats, FetchPerformance counters are summed
    // MutationImpact, ShadowAnalysis are kept per-record (not summed — they're per-request events)
}
```

Aggregation equality check: operation hash + schema version + client name + client version (same as schema usage).

### Step 4: Create Sink and Exporter

**New files**: `router/internal/entityanalytics/sink.go`, `router/internal/entityanalytics/exporter.go`

Follow exact patterns from `graphqlmetrics/`:

- **Sink**: Implements `exporter.Sink[*entityanalyticsv1.EntityAnalyticsInfo]`. Calls `AggregateEntityAnalyticsBatch()`, then sends via Connect RPC with Bearer auth.
- **Exporter**: Thin wrapper around `exporter.Exporter[*entityanalyticsv1.EntityAnalyticsInfo]`. Provides `RecordAnalytics(info, synchronous)` and `Shutdown(ctx)`.

Reuse `IsRetryableError` classification from `graphqlmetrics` (same Connect error handling).

### Step 5: Integration into Request Lifecycle

**Modify**: `router/core/graphql_handler.go`

After existing `recordEntityCacheMetrics()` call (line 253), add:

```go
h.recordEntityAnalytics(resolveCtx, reqCtx.operation)
```

New method:
```go
func (h *GraphQLHandler) recordEntityAnalytics(resolveCtx *resolve.Context, opCtx *operationContext) {
    if h.entityAnalyticsExporter == nil {
        return
    }
    snapshot := resolveCtx.GetCacheStats()
    info := entityanalytics.BuildEntityAnalyticsInfo(snapshot, opCtx)
    h.entityAnalyticsExporter.RecordAnalytics(info, false)
}
```

Note: `GetCacheStats()` is already called by `recordEntityCacheMetrics()`. If both are enabled, the snapshot should be fetched once and shared. Refactor to:

```go
snapshot := resolveCtx.GetCacheStats()
h.recordEntityCacheMetrics(ctx, snapshot)
h.recordEntityAnalytics(snapshot, reqCtx.operation)
```

### Step 6: Register in Graph Server

**Modify**: `router/core/graph_server.go`

When entity analytics is enabled:
1. Create Connect RPC client for `EntityAnalyticsService`
2. Create `EntityAnalyticsSink`
3. Create `EntityAnalyticsExporter` with exporter settings
4. Pass to `GraphQLHandler` constructor
5. Add to shutdown sequence

### Step 7: Configuration

**Modify**: `router/pkg/config/config.go`

```yaml
entity_caching:
  analytics:
    enabled: true
    hash_entity_keys: false    # existing: privacy for logs/traces
    detail_level: "standard"   # "basic" | "standard" | "full"
    export:
      enabled: true
      endpoint: ""             # defaults to graphql metrics collector endpoint
      batch_size: 1024
      queue_size: 10240
      interval: "10s"
      retry:
        enabled: true
        max_retries: 5
        max_duration: "10s"
        interval: "5s"
```

**Detail levels control which snapshot events are processed:**

| Level | Events Processed | Overhead |
|---|---|---|
| `basic` | CacheKeyEvent, CacheWriteEvent, FetchTimingEvent | Minimal |
| `standard` | Basic + EntityFieldHash, EntityTypeInfo, MutationEvent | Default |
| `full` | Standard + ShadowComparisonEvent, HeaderImpactEvent, SubgraphErrorEvent | Complete |

---

## Files to Create/Modify

| Action | File | Purpose |
|--------|------|---------|
| Create | `proto/wg/cosmo/entityanalytics/v1/entityanalytics.proto` | Protobuf definitions |
| Create | `router/internal/entityanalytics/builder.go` | Snapshot → EntityAnalyticsInfo transformation |
| Create | `router/internal/entityanalytics/aggregate.go` | Batch aggregation |
| Create | `router/internal/entityanalytics/sink.go` | Connect RPC sink |
| Create | `router/internal/entityanalytics/exporter.go` | Exporter wrapper |
| Modify | `router/core/graphql_handler.go` | Call analytics builder after resolution |
| Modify | `router/core/graph_server.go` | Register analytics exporter |
| Modify | `router/pkg/config/config.go` | Add analytics configuration |

---

## Verification

1. **Unit tests**: `builder.go` (snapshot → proto conversion), `aggregate.go` (batch deduplication)
2. **Integration test**: Enable entity analytics, run queries with cache activity, verify exporter receives correct records with all event types
3. **Benchmark**: `BuildEntityAnalyticsInfo` should be <10μs per request
4. **Cardinality check**: No entity key values or field values in exported data — only hashes and type names
5. **Detail level test**: Verify `basic`/`standard`/`full` control which fields are populated
6. **Backward compatibility**: Existing OTEL metrics unchanged, schema usage tracking unchanged

---

## What This RFC Does NOT Cover

- Backend collector service for entity analytics data
- Cosmo Studio UI (dashboards, TTL recommendations, caching opportunity suggestions)
- Alerting rules based on entity analytics
- Historical trend analysis engine
- Field-level caching implementation (entity analytics provides the data foundation for this future feature)
