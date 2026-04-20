# RFC: Entity Cache Analytics for Cosmo Router

## Context

Entity caching is being added to the Cosmo Router (branch `jensneuse/entity-caching`). The router already has 6 basic OTEL metrics for cache operations (hits/misses, key lifecycle, L2 latency, invalidation/population counts, shadow staleness). These are aggregate counters with low-cardinality labels — useful for operational monitoring, but insufficient for users to answer business-level questions about their cache effectiveness.

The router also has a mature **schema usage tracking** system that collects per-request field/argument/input usage data, batches it, aggregates it, and exports it via gRPC to a backend collector service. This system is designed for high throughput with minimal router overhead (plan caching, buffer pools, batch aggregation, async export with backoff).

This RFC proposes **cache analytics** — a richer data collection layer that gives users actionable insights about cache behavior per operation, per entity type, and per subgraph, enabling them to optimize their cache configuration and understand the business impact of caching.

---

## End-User Capabilities

### Questions Users Can Answer

**Cache Effectiveness**
- "What is my overall cache hit rate, broken down by entity type?" — Identify which entity types benefit most from caching and which have poor hit rates
- "Which operations benefit most from caching?" — Rank operations by cache savings (hits × estimated subgraph cost avoided)
- "What's my hit rate per subgraph?" — Understand which subgraph calls are most frequently avoided by caching

**Cost & Performance Impact**
- "How much subgraph traffic is entity caching saving me?" — Quantify the reduction in subgraph calls, enabling cost/benefit analysis
- "What's the latency impact of cache hits vs misses?" — Compare L2 cache fetch latency against subgraph fetch latency per entity type
- "Are my TTLs well-tuned?" — Shadow mode staleness data per entity type reveals if TTLs are too long (stale data) or too short (unnecessary misses)

**Operational Health**
- "Is my cache working correctly after a deployment?" — Track hit rate trends per operation over time
- "Did this schema change affect cache effectiveness?" — Correlate cache metrics with schema version changes
- "Which clients benefit most from caching?" — Break down cache savings by client name/version

**Cache Configuration Optimization**
- "Which entity types should I enable caching for?" — Identify high-frequency entities currently not cached
- "Should I adjust TTLs for specific entity types?" — Use staleness data and hit/miss patterns to tune TTLs
- "How effective is my invalidation strategy?" — See invalidation-to-population ratios per entity type

### Business Value

1. **Cost reduction visibility** — Quantify how much infrastructure spend entity caching saves by reducing subgraph calls
2. **Performance optimization** — Identify which entity types / operations to cache for maximum latency improvement
3. **Configuration confidence** — Data-driven TTL and cache scope decisions instead of guessing
4. **Incident detection** — Spot cache degradation (dropping hit rates, rising staleness) before users notice
5. **ROI justification** — Concrete numbers for stakeholders on the value of the caching layer

---

## Architecture Decision: Separate Concern vs. Schema Usage Extension

### Recommendation: Separate concern, reuse infrastructure

Cache analytics should be a **separate data pipeline** from schema usage tracking, but it should **reuse the existing generic exporter infrastructure** (`internal/exporter/exporter.go`).

**Reasons to keep separate:**

1. **Different data shape** — Schema usage tracks fields/arguments/inputs per operation. Cache analytics tracks hits/misses/latencies per entity type per fetch. These are fundamentally different data structures with different aggregation keys.

2. **Different cardinality profile** — Schema usage is bounded by the number of unique operations × clients. Cache analytics adds the entity type dimension, which could multiply cardinality. Mixing them into one pipeline would complicate aggregation.

3. **Independent lifecycle** — Users should be able to enable/disable cache analytics independently from schema usage tracking. They serve different audiences (platform team vs. API consumers).

4. **Different backend processing** — The schema usage collector backend processes data for breaking change detection, field coverage, etc. Cache analytics needs different backend processing (time-series aggregation, trend analysis, alerting).

5. **Existing OTEL metrics should remain** — The current 6 OTEL metrics are good for real-time operational dashboards (Grafana). Cache analytics via the exporter adds the operation/entity-type/subgraph dimensions needed for deeper analysis in the Cosmo Studio.

**What to reuse:**

- `internal/exporter/exporter.go` — The generic batch exporter with queue, batching, retry, buffer pools, and graceful shutdown. Create a new `Exporter[*CacheAnalyticsInfo]` instance.
- The Connect RPC transport pattern from `GraphQLMetricsSink` — Create a new `CacheAnalyticsSink` following the same pattern.
- The aggregation pattern from `aggregate.go` — Create a new `AggregateCacheAnalyticsBatch()` function.

---

## Resource Efficiency Design

### Principles

1. **Aggregate in-router, export summaries** — Don't export per-entity-key events. Aggregate by (operation hash, entity type, subgraph, cache level, event type) before export.
2. **Reuse the plan cache** — Like schema usage, cache-invariant metadata (which entity types an operation touches, which subgraphs are involved) can be computed once during planning and cached.
3. **Async, non-blocking export** — Use the existing exporter's queue-based async pattern. Drop items rather than block request processing.
4. **Batch before sending** — Use the same time/size-based batching (default: 1024 items or 10s interval).
5. **Aggregate before sending** — Like `AggregateSchemaUsageInfoBatch`, deduplicate identical records in the batch, incrementing counts.
6. **Bounded cardinality** — Only use low-cardinality dimensions as aggregation keys (operation hash, entity type name, subgraph ID, cache level). Never use entity key values.

### Overhead Estimate

The overhead per request is:
- **Snapshot collection**: Already happens for OTEL metrics — zero additional cost
- **Analytics record construction**: One allocation per request to build the `CacheAnalyticsInfo` struct from the snapshot — lightweight, ~microseconds
- **Queue enqueue**: One channel send — nanoseconds
- **Aggregation + export**: Happens asynchronously in background goroutine — no request path impact

---

## Detailed Implementation Plan

### Step 1: Define Protobuf Messages

**New file**: `proto/wg/cosmo/cacheanalytics/v1/cacheanalytics.proto`

```protobuf
syntax = "proto3";
package wg.cosmo.cacheanalytics.v1;

service CacheAnalyticsService {
  rpc PublishCacheAnalytics(PublishCacheAnalyticsRequest)
      returns (PublishCacheAnalyticsResponse) {}
}

message PublishCacheAnalyticsRequest {
  repeated CacheAnalyticsAggregation aggregations = 1;
}

message PublishCacheAnalyticsResponse {}

message CacheAnalyticsAggregation {
  CacheAnalyticsInfo analytics = 1;
  uint64 request_count = 2;
}

// One record per request, aggregated before export
message CacheAnalyticsInfo {
  // Operation context (same dimensions as schema usage)
  OperationInfo operation = 1;
  ClientInfo client = 2;
  SchemaInfo schema = 3;

  // Cache statistics for this request
  repeated EntityCacheStats entity_stats = 4;
  repeated RootFieldCacheStats root_field_stats = 5;

  // Request-level cache summary
  CacheSummary summary = 6;
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

// Per entity-type cache stats within a single request
message EntityCacheStats {
  string entity_type = 1;     // e.g., "Product", "User"
  string subgraph_id = 2;     // which subgraph serves this entity

  uint32 l1_hits = 3;
  uint32 l1_misses = 4;
  uint32 l2_hits = 5;
  uint32 l2_misses = 6;
  uint32 l2_writes = 7;       // cache populations

  // Latency (only for L2 operations in this request)
  double l2_get_latency_ms = 8;   // average L2 GET latency for this entity type

  // Invalidation/population events
  uint32 invalidations = 9;
  uint32 populations = 10;

  // Shadow mode
  uint32 shadow_stale = 11;   // times cached != fresh
  uint32 shadow_fresh = 12;   // times cached == fresh
}

// Per root-field cache stats (non-entity caching)
message RootFieldCacheStats {
  string field_name = 1;
  string subgraph_id = 2;

  uint32 l1_hits = 3;
  uint32 l1_misses = 4;
  uint32 l2_hits = 5;
  uint32 l2_misses = 6;
  uint32 l2_writes = 7;

  double l2_get_latency_ms = 8;
}

// Request-level summary (for quick dashboards without drilling into entity details)
message CacheSummary {
  uint32 total_cache_hits = 1;     // l1 + l2 combined
  uint32 total_cache_misses = 2;
  uint32 total_subgraph_fetches_avoided = 3;  // entity fetches served from cache
  double total_l2_latency_ms = 4;  // total time spent on L2 operations
  bool had_errors = 5;             // any cache backend errors
}
```

### Step 2: Create Cache Analytics Sink

**New file**: `router/internal/cacheanalytics/sink.go`

Follow the exact pattern of `GraphQLMetricsSink`:
- Implement `exporter.Sink[*CacheAnalyticsInfo]`
- `Export()` calls `AggregateBatch()` then sends via Connect RPC
- `IsRetryableError()` reuses the same Connect error classification
- Auth via `Authorization: Bearer <token>` header

### Step 3: Create Cache Analytics Aggregation

**New file**: `router/internal/cacheanalytics/aggregate.go`

Follow the pattern of `graphqlmetrics/aggregate.go`:
- Aggregate by: operation hash + schema version + client name/version + error status
- Increment `request_count` for identical records
- Entity-level stats within a record are already per-entity-type, so they aggregate naturally

### Step 4: Create Cache Analytics Exporter

**New file**: `router/internal/cacheanalytics/exporter.go`

Thin wrapper around `exporter.Exporter[*cacheanalyticsv1.CacheAnalyticsInfo]`:
- `NewCacheAnalyticsExporter(logger, sink, settings)` — creates the generic exporter
- `RecordAnalytics(info, synchronous)` — delegates to exporter.Record()
- `Shutdown(ctx)` — delegates to exporter.Shutdown()

### Step 5: Build Analytics Record from Snapshot

**Modify**: `router/core/graphql_handler.go`

In `recordEntityCacheMetrics()`, after the existing OTEL metric recording, build a `CacheAnalyticsInfo` from the snapshot:

```go
func (h *GraphQLHandler) recordEntityCacheAnalytics(resolveCtx *resolve.Context, opCtx *operationContext) {
    if h.cacheAnalyticsExporter == nil {
        return
    }

    snapshot := resolveCtx.GetCacheStats()
    info := buildCacheAnalyticsInfo(snapshot, opCtx)
    h.cacheAnalyticsExporter.RecordAnalytics(info, false)
}
```

The `buildCacheAnalyticsInfo` function:
1. Groups snapshot events by entity type / subgraph
2. Builds `EntityCacheStats` per group
3. Computes `CacheSummary` totals
4. Attaches operation/client/schema context from `operationContext`

This runs on the request goroutine but is lightweight (iterating small event slices, no I/O).

### Step 6: Register Exporter in Graph Server

**Modify**: `router/core/graph_server.go`

In the graph server setup, when entity caching analytics is enabled:
1. Create the Connect RPC client for the cache analytics service
2. Create the `CacheAnalyticsSink`
3. Create the `CacheAnalyticsExporter` with the generic exporter
4. Pass the exporter to `GraphQLHandler`

### Step 7: Configuration

**Modify**: `router/pkg/config/config.go` (or equivalent)

Add cache analytics export endpoint configuration under the existing entity caching analytics config:

```yaml
entity_caching:
  analytics:
    enabled: true
    export:
      endpoint: "https://cosmo-metrics.example.com"  # defaults to same as graphql metrics
      batch_size: 1024
      queue_size: 10240
      interval: "10s"
      retry:
        enabled: true
        max_retries: 5
        max_duration: "10s"
        interval: "5s"
```

---

## Files to Create/Modify

| Action | File | Purpose |
|--------|------|---------|
| Create | `proto/wg/cosmo/cacheanalytics/v1/cacheanalytics.proto` | Protobuf message definitions |
| Create | `router/internal/cacheanalytics/sink.go` | Connect RPC sink (follows `graphql_metrics_sink.go` pattern) |
| Create | `router/internal/cacheanalytics/aggregate.go` | Batch aggregation (follows `aggregate.go` pattern) |
| Create | `router/internal/cacheanalytics/exporter.go` | Thin wrapper around generic `Exporter` |
| Modify | `router/core/graphql_handler.go` | Build analytics record from snapshot after execution |
| Modify | `router/core/graph_server.go` | Register cache analytics exporter |
| Modify | `router/pkg/config/config.go` | Add export configuration options |

---

## Verification

1. **Unit tests**: Aggregation logic, snapshot-to-analytics-info conversion
2. **Integration test**: Enable cache analytics, run queries with cache hits/misses, verify exporter receives correct records
3. **Benchmark**: Measure per-request overhead of analytics record construction — should be <10μs
4. **Cardinality check**: Verify that aggregation keys are bounded (no entity key values in exported data)
5. **Backward compatibility**: Existing OTEL metrics unchanged, existing schema usage tracking unchanged
6. **Config validation**: Cache analytics can be enabled/disabled independently

---

## What This RFC Does NOT Cover (Backend)

- Backend service that receives and stores cache analytics data
- Cosmo Studio UI for cache analytics dashboards
- Alerting rules based on cache analytics
- Historical trend analysis and recommendations engine
