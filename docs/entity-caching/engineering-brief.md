# Entity Caching: Engineering Brief

**Branch:** `jensneuse/entity-caching` (cosmo) + [graphql-go-tools PR #1259](https://github.com/wundergraph/graphql-go-tools/pull/1259)
**Scope:** ~40,000 lines added across 266 files spanning composition, proto, router, and the GraphQL engine

---

## Table of Contents

1. [Why Entity Caching](#1-why-entity-caching)
2. [Key Features](#2-key-features)
3. [Schema Directives](#3-schema-directives)
4. [Key Design Decisions](#4-key-design-decisions)
5. [Architecture](#5-architecture)
6. [Composition Layer (TypeScript)](#6-composition-layer-typescript)
7. [Engine Layer (graphql-go-tools)](#7-engine-layer-graphql-go-tools)
8. [Router Layer (Go)](#8-router-layer-go)
9. [Proto Changes](#9-proto-changes)
10. [Configuration](#10-configuration)
11. [Observability](#11-observability)
12. [Test Coverage](#12-test-coverage)
13. [Review Focus Areas](#13-review-focus-areas)

---

## 1. Why Entity Caching

High-traffic websites running federated GraphQL pay a steep price in cost, latency, and reliability because every request fans out to subgraphs. A single page load can trigger dozens of entity resolution calls across multiple subgraphs -- and most of that data hasn't changed since the last request.

Entity caching eliminates redundant subgraph calls by caching individual entities at the router level. Instead of caching full query responses (which are different for every query shape), we cache entities by their `@key` fields. This means a `Product` entity cached by one query is reused by every other query that needs that same product -- regardless of which fields are selected or which subgraphs are involved.

The result: dramatically reduced subgraph load, lower latency, lower infrastructure cost, and improved reliability (the graph keeps serving even when a subgraph is slow).

---

## 2. Key Features

### Two-Layer Caching (L1 + L2)

**L1 (per-request deduplication):** Within a single GraphQL request, the same entity is often resolved multiple times -- through aliases, nested references, or list items pointing to the same object. L1 is an in-memory `sync.Map` scoped to the request. It deduplicates these calls so each entity is fetched from a subgraph at most once per request, even without L2 enabled.

**L2 (cross-request shared cache):** The persistent cache layer, backed by Redis or in-process memory (ristretto). When a user queries `Product(id: "123")` and the next user queries a different page that also needs `Product(id: "123")`, L2 serves it without touching the subgraph. TTLs are set per-entity via `@entityCache(maxAge)`.

### Shadow Mode

You cannot just flip caching on in production and hope it works. Shadow mode provides a scientific approach to cache rollout:

1. **Enable shadow mode** -- the cache reads and writes happen normally, but cached data is **never served** to clients. Every request still hits the subgraph.
2. **Measure** -- the engine compares cached data against fresh subgraph responses, hashing each field individually. Staleness events are recorded in metrics.
3. **Fine-tune** -- adjust TTLs, invalidation rules, and entity coverage based on real production data in dashboards. See exactly which entities go stale and how quickly.
4. **Go live** -- once the data shows TTLs and invalidation are working correctly, disable shadow mode. Clients start seeing cached data with confidence that it's fresh.

This eliminates the risk of serving stale data during initial rollout. You get production-grade validation before a single user sees cached content.

### Partial Cache Loads

Consider a list query that needs to resolve 50 entities from a subgraph. Without partial cache loads, if even one entity is missing from the cache, all 50 are re-fetched -- wasting the 49 cache hits.

With `partialCacheLoad` enabled, the router tracks which entities are cached and which aren't. It serves the cached ones directly and only sends the missing ones to the subgraph. If 48 out of 50 entities are cached, only 2 go to the subgraph.

For high-cardinality list queries, this dramatically reduces subgraph load even when cache coverage isn't 100%.

### Negative Caching

Imagine a list query that loads 50 entities, but 10 of them have been deleted. Without negative caching, those 10 deletions produce null responses that are never cached. Every subsequent request re-fetches those 10 non-existent entities, hitting the subgraph for data that will never exist.

Negative caching stores a null sentinel in the cache with a separate (shorter) TTL. Now all 50 lookups are cache hits -- 40 returning data, 10 returning "this entity doesn't exist." The subgraph is only called when the negative cache TTL expires, giving the system a chance to check if the entity has been recreated.

### Cache Invalidation (Three Mechanisms)

**Mutation-triggered (`@cacheInvalidate`):** A subgraph team annotates mutations that modify entities. When `updateProduct(id: "1")` completes, the router automatically evicts `Product(id: "1")` from the cache using the `@key` fields from the mutation response. The next query fetches fresh data.

**Extension-based invalidation:** Sometimes a mutation has side effects beyond its return type. For example, updating a product might affect related inventory counts, category rankings, or recommendation lists. The subgraph can return all affected entity keys in the response extensions:
```json
{"extensions":{"cacheInvalidation":{"keys":[
  {"typename":"Product","key":{"id":"1"}},
  {"typename":"Category","key":{"id":"electronics"}},
  {"typename":"Inventory","key":{"id":"warehouse-1"}}
]}}}
```
The router batch-deletes all these entries in a single operation. This is extremely powerful for correlated invalidations that the subgraph understands but the router cannot infer from the mutation return type alone.

**Subscription-triggered:** Real-time events can both invalidate and populate the cache. A subscription for `itemUpdated` with `@cacheInvalidate` evicts stale entities as events arrive. A subscription for `itemCreated` with `@cachePopulate` pre-warms the cache with new entities before any query asks for them.

### Cache Populate on Mutations

The flip side of invalidation: `@cachePopulate` on a mutation tells the router to write the returned entity into the cache. When `createProduct(name: "Widget")` returns the new product, it's immediately cached. The first query for that product is a cache hit.

### Per-Subgraph and Per-Entity Cache Routing

By default, all entities share a single Redis instance. But in high-traffic scenarios, one subgraph can dominate the cache, evicting entries from other subgraphs.

Example: A music streaming service pre-computes personalized playlists for millions of users. That's millions of cache keys for a single entity type. If they share Redis with the rest of the graph, playlist entries evict product catalog entries, recommendation entries, and everything else.

Cache routing solves this with a three-tier provider model:
1. **Entity-level override:** `Product` on the `catalog` subgraph uses `redis-catalog`
2. **Subgraph-level override:** Everything on the `playlist` subgraph uses `redis-playlist`
3. **Global default:** Everything else uses `redis-default`

Each Redis instance is sized independently. The playlist cache can have 100GB without affecting anyone else.

### Circuit Breaker

Redis is usually reliable, but maintenance windows, network issues, or resource exhaustion happen. Without protection, a Redis outage causes a cascade of errors and timeouts across the entire graph.

The circuit breaker wraps the cache layer with three states:
- **Closed (normal):** All cache operations pass through.
- **Open (tripped):** After N consecutive failures, the breaker opens. All cache operations are skipped -- the router falls back to subgraph fetches as if caching didn't exist. No errors, no timeouts, just slightly higher latency.
- **Half-open (probing):** After a cooldown period, one probe request tests the cache. If it succeeds, the breaker closes and caching resumes. If it fails, the breaker stays open.

The graph never goes down because of a cache failure.

### Root Field Caching with `@is`

Entity caching works through `_entities` calls (federation entity resolution). But many queries start with a root field like `product(id: "123")` that fetches directly from a subgraph. The `@queryCache` directive enables caching these root field results.

The key insight: if a root field returns a `Product` and takes `id` as an argument, the cache key should be the same as the entity key `Product(id: "123")`. This way, a product fetched via `product(id: "123")` shares its cache entry with the same product resolved via `_entities`.

But sometimes argument names don't match entity key fields. A subgraph might expose `productByPid(pid: ID!)` where `pid` maps to the entity's `id` key field. The `@is` directive makes this explicit:

```graphql
type Query {
  productByPid(pid: ID! @is(field: "id")): Product @queryCache(maxAge: 300)
}
```

This tells composition: "the argument `pid` maps to the `@key` field `id`." The router uses this mapping to construct entity-compatible cache keys from root field arguments.

---

## 3. Schema Directives

Subgraph teams control caching through five directives in their schemas:

```graphql
# Mark an entity as cacheable (300-second TTL)
type Product @key(fields: "id") @entityCache(maxAge: 300) {
  id: ID!
  name: String!
  price: Float!
}

# Enable root field caching with argument-to-key mapping
type Query {
  product(id: ID!): Product @queryCache(maxAge: 300)
  productByPid(pid: ID! @is(field: "id")): Product @queryCache(maxAge: 300)
  products: [Product!]! @queryCache(maxAge: 300)
}

# Invalidate cache on mutations
type Mutation {
  updateProduct(id: ID!, name: String!): Product @cacheInvalidate
  deleteProduct(id: ID!): Product @cacheInvalidate
  createProduct(name: String!): Product! @cachePopulate(maxAge: 60)
}

# Real-time cache management via subscriptions
type Subscription {
  productUpdated: Product @cacheInvalidate
  productCreated: Product @cachePopulate
}
```

### Directive Reference

| Directive | Target | Arguments | Purpose |
|-----------|--------|-----------|---------|
| `@entityCache` | `OBJECT` | `maxAge: Int!`, `includeHeaders: Boolean`, `partialCacheLoad: Boolean`, `shadowMode: Boolean` | Marks an entity type as cacheable with TTL and behavior flags |
| `@queryCache` | `FIELD_DEFINITION` | `maxAge: Int!`, `includeHeaders: Boolean`, `shadowMode: Boolean` | Enables cache reads for Query root fields returning cached entities |
| `@cacheInvalidate` | `FIELD_DEFINITION` | (none) | Evicts the returned entity from cache after Mutation/Subscription |
| `@cachePopulate` | `FIELD_DEFINITION` | `maxAge: Int` (optional override) | Writes the returned entity to cache after Mutation/Subscription |
| `@is` | `ARGUMENT_DEFINITION` | `field: String!` | Maps a query argument to an entity `@key` field name |

---

## 4. Key Design Decisions

### Why per-entity caching instead of per-query response caching?

Every GraphQL query is different. Different clients select different fields, use different variables, combine different fragments. Caching full query responses means almost no cache sharing -- a mobile client's query and a web client's query for the same product generate different cache keys.

Per-entity caching solves this by caching at the entity level using `@key` fields as the cache key. `Product(id: "123")` is cached once and served to any query that needs it, regardless of which fields are selected. The entity gets resolved from different subgraphs independently -- the `details` subgraph's contribution is cached separately from the `inventory` subgraph's contribution.

This also respects team ownership. Every subgraph team can independently decide which entities to cache, what TTLs to use, and when to invalidate -- without coordinating with other teams.

### Why schema directives instead of router-side configuration?

The router is owned by the platform team. Entities are owned by subgraph teams. Subgraph teams know their data best -- they know how often a product changes, when a user profile goes stale, which mutations affect which entities.

Putting cache rules in the schema means the people who understand the data define the caching behavior. The platform team configures infrastructure (which Redis, circuit breaker thresholds, L1/L2 toggles) while subgraph teams configure semantics (what to cache, for how long, when to invalidate).

This separation also means cache rules travel with the schema through composition. When a subgraph is published with new caching directives, the composition engine validates them, and the next router config update picks them up automatically.

### Why two cache layers (L1 + L2)?

They solve different problems:

**L1** solves an intra-request problem. A single GraphQL query often resolves the same entity multiple times (aliases like `a: product(id: "1") { ... } b: product(id: "1") { ... }`, or nested references). L1 deduplicates within a request using a `sync.Map`. It's zero-config, always useful, and has no external dependencies.

**L2** solves a cross-request problem. Different users querying the same product should share cached data. L2 is backed by Redis or in-process memory and persists across requests. It requires configuration (storage provider, TTLs) and infrastructure.

You can enable each independently. L1-only gives you deduplication with no infra. L2-only gives you shared caching. Both together give you the full benefit.

### Why graceful degradation everywhere?

Cache failures must never break the graph. If Redis is down, the query should still work -- it just takes longer because it hits the subgraph directly. This is implemented at every level:

- The `LoaderCache` interface returns errors, but the engine treats them as cache misses
- The circuit breaker stops trying the cache after repeated failures, eliminating timeout overhead
- Shadow mode serves fresh data even when the cache has entries
- Memory pressure in ristretto triggers eviction, not errors

The graph's correctness never depends on the cache. The cache is purely a performance optimization.

### Why extension-based invalidation?

Mutation return types only tell part of the story. When you update a product's price, the mutation returns the updated `Product`. But that price change might affect `Category` aggregates, `Recommendation` rankings, and `Cart` totals across the graph.

The subgraph knows about these correlations. Extension-based invalidation lets the subgraph declare all affected entities in the response, and the router invalidates them in a single batch. This gives subgraph teams the power to express complex invalidation relationships without router-side configuration.

---

## 5. Architecture

### System Overview

```
                                    Subgraph Schema
                                         |
                              @entityCache, @queryCache,
                           @cacheInvalidate, @cachePopulate, @is
                                         |
                                         v
                              ┌─────────────────────┐
                              │   Composition (TS)   │  Validates directives,
                              │                      │  generates cache configs
                              └──────────┬──────────┘
                                         │ Proto (EntityCacheConfiguration,
                                         │  RootFieldCacheConfiguration, ...)
                                         v
                              ┌─────────────────────┐
                              │   Router Config      │  L1/L2 flags, storage
                              │   (config.yaml)      │  providers, circuit breaker
                              └──────────┬──────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    v                    v                    v
          ┌─────────────┐    ┌──────────────────┐   ┌───────────────┐
          │  L1 Cache    │    │    L2 Cache       │   │  Invalidation │
          │ (per-request)│    │ (cross-request)   │   │               │
          │  sync.Map    │    │ Redis / Memory    │   │ Mutation      │
          │  dedup only  │    │ + Circuit Breaker │   │ Subscription  │
          └─────────────┘    └──────────────────┘   │ Extension     │
                                                     └───────────────┘
```

### Cache Flow Per Request

```
Query arrives
  │
  ├─ prepareCacheKeys()     Build keys from @key fields + arguments
  │
  ├─ tryL1CacheLoad()       sync.Map lookup (request-scoped)
  │    ├─ HIT  → skip fetch entirely (even skips goroutine in parallel mode)
  │    └─ MISS ↓
  │
  ├─ tryL2CacheLoad()       Redis/Memory lookup
  │    ├─ HIT  → serve from cache, populate L1
  │    ├─ PARTIAL HIT → fetch only missing entities (if partialCacheLoad=true)
  │    └─ MISS ↓
  │
  ├─ Fetch from subgraph
  │
  ├─ populateL1Cache()      Store for intra-request dedup
  ├─ updateL2Cache()        Store for cross-request serving
  │    └─ Merges with existing cached data (preserves other argument variants)
  │
  └─ Cache invalidation     Process mutation results + response extensions
```

### Cache Key Format

**Entity keys** (used for `_entities` resolution and root fields with key mappings):
```json
{"__typename":"Product","key":{"id":"123"}}
```

**Root field keys** (used when no argument-to-key mapping exists):
```json
{"__typename":"Query","field":"topProducts","args":{"first":5}}
```

When `@queryCache` + `@is` mappings are configured, root fields produce entity-format keys. This means `product(id: "123")` and the `_entities` fetch for `Product(id: "123")` share the same cache entry.

**Key prefix pipeline** (applied in order):
1. `GlobalCacheKeyPrefix` (e.g., multi-tenant isolation)
2. Subgraph header hash prefix (when `includeHeaders = true`)
3. User-provided `L2CacheKeyInterceptor` (custom module transform)

### Parallel Resolution Model

4-phase model for parallel entity fetches:

1. **Phase 1 (main thread):** `prepareCacheKeys` + `tryL1CacheLoad` for all fetches. L1 hits set `cacheSkipFetch = true`, skipping the goroutine entirely.
2. **Phase 2 (goroutines via errgroup):** `tryL2CacheLoad` + subgraph fetch for L1 misses. Analytics accumulated per-result (goroutine-safe).
3. **Phase 3 (main thread):** Merge analytics events from goroutine-local slices.
4. **Phase 4 (main thread):** `mergeResult` + `populateL1Cache` + `updateL2Cache` + cache invalidation.

### L2 Write Merging

Different queries select different fields from the same entity. When query A caches `Product { id, name }` and later query B fetches `Product { id, price }`, the engine merges both field sets into the existing cache entry via `astjson.MergeValues`. The cache entry grows to contain `Product { id, name, price }`, serving both query shapes.

Fields with arguments (e.g., `friends(first:5)` vs `friends(first:10)`) coexist in the same entity via xxhash suffixes on the field name. No collisions, no overwriting.

### Alias Normalization

`normalizeForCache` transforms aliased field names to their original schema names before L2 storage. `denormalizeFromCache` reverses this on load. This ensures that `myProduct: product(id:"1") { ... }` and `product(id:"1") { ... }` share the same cache entry.

---

## 6. Composition Layer (TypeScript)

### Files Changed
- `composition/src/v1/constants/directive-definitions.ts` -- 5 new directive AST definitions
- `composition/src/v1/normalization/normalization-factory.ts` -- ~500 lines: `validateAndExtractEntityCachingConfigs()` + helpers
- `composition/src/router-configuration/types.ts` -- 6 new config output types
- `composition/src/errors/errors.ts` -- 12 new error message functions
- `composition/src/v1/warnings/warnings.ts` -- 2 new warning types

### Three-Phase Validation

**Phase 1 -- Entity types:** Collects `@entityCache` from object types, validates `@key` presence and positive `maxAge`, builds `entityCacheConfigByTypeName` lookup.

**Phase 2 -- Root type fields:** Processes `@queryCache`, `@cacheInvalidate`, `@cachePopulate`, `@is` on Query/Mutation/Subscription fields. Key rules:
- `@queryCache` only on Query fields
- `@cacheInvalidate` / `@cachePopulate` only on Mutation/Subscription
- `@cacheInvalidate` + `@cachePopulate` are mutually exclusive
- Return type must be an entity with `@entityCache`
- `@is` field must reference a `@key` field; `@is` without `@queryCache` is an error

**Phase 3 -- Config attachment:** Validated configs attached to `ConfigurationData` entries for the proto serialization layer.

### `@is` Directive and Key Mapping

Two strategies for mapping query arguments to `@key` fields:
1. **Explicit:** `@is(field: "keyFieldName")` on an argument
2. **Auto-mapping:** Argument name matches a `@key` field name

Example: `product(pid: ID! @is(field: "id")): Product @queryCache(maxAge: 30)` maps argument `pid` to `@key(fields: "id")`.

List-returning fields skip key mapping entirely (no key-based lookups, only cache population). Incomplete mappings produce warnings, not errors. Nested `@key` fields (e.g., `store { id }`) are filtered out since they can't map to flat arguments.

### Validation Rules Summary

| # | Rule | Severity |
|---|------|----------|
| 1 | `@entityCache` requires `@key` | Error |
| 2 | `maxAge` must be positive integer | Error |
| 3 | `@queryCache` only on Query fields | Error |
| 4 | `@queryCache` return type must be entity with `@entityCache` | Error |
| 5 | `@is` requires `@queryCache` on the field | Error |
| 6 | `@is(field)` must reference a `@key` field | Error |
| 7 | Duplicate key field mappings (two args map to same key) | Error |
| 8 | Incomplete key mapping (non-list) | Warning |
| 9 | Redundant `@is` (arg name already matches key field) | Warning |
| 10-13 | `@cacheInvalidate`/`@cachePopulate` operation type + return type checks | Error |
| 14 | `@cacheInvalidate` + `@cachePopulate` mutual exclusion | Error |

---

## 7. Engine Layer (graphql-go-tools)

This is the core implementation in `v2/pkg/engine/resolve/`.

### Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `loader_cache.go` | ~1,900 | Core L1/L2 cache operations, invalidation, populate |
| `caching.go` | ~395 | CacheKeyTemplate, key rendering, prefix pipeline |
| `cache_analytics.go` | ~918 | Analytics collector and snapshot |
| `cache_fetch_info.go` | ~63 | Debug context enrichment |
| `fetch.go` | -- | FetchCacheConfiguration, MutationEntityImpactConfig |
| `plan/federation_metadata.go` | -- | All plan-time config types |

### Data Validation

`validateItemHasRequiredData` recursively checks that a cached entity has all fields required by the current query. Uses `cacheFieldName()` to handle argument-suffixed fields. Missing fields trigger a cache miss and subgraph re-fetch -- the cache never serves incomplete data.

### Self-Referential Entity Safety

`shallowCopyProvidedFields()` creates shallow copies when loading from L1 to prevent pointer aliasing. When `User.friends` returns `User` entities, arena-allocated objects could point back to the same memory. The copy prevents mutation of cached L1 entries.

---

## 8. Router Layer (Go)

### Cache Infrastructure (`router/pkg/entitycache/`)

Three `resolve.LoaderCache` implementations:

**`MemoryEntityCache`** (ristretto-backed):
- `dgraph-io/ristretto/v2` with cost = byte length
- Tracks entry count via `atomic.Int64` with eviction callback
- Tracks `RemainingTTL` on cache entries

**`RedisEntityCache`**:
- `redis.UniversalClient` (supports single, sentinel, cluster)
- Key-prefixed (`keyPrefix + ":" + key`)
- Batch reads via `MGet`, writes via pipeline
- Implements `io.Closer` to close the Redis connection on shutdown

**`CircuitBreakerCache`** (wrapper):
- Three states: closed / open / half-open (atomic, lock-free)
- On failure: swallows errors, returns empty results (graceful degradation)
- On open: bypasses cache entirely
- Half-open: single probe request via `CompareAndSwap`
- Implements `io.Closer`, delegates to inner cache

### Executor Integration (`router/core/`)

| File | Role |
|------|------|
| `executor.go` | Builds invalidation config map (`subgraphName -> typeName -> config`), three-tier provider resolution |
| `factoryresolver.go` | Populates `FederationMetaData` with all cache configs from proto, resolves per-subgraph/entity provider IDs |
| `graphql_handler.go` | Constructs per-request `CachingOptions`, chains key interceptor modules, records cache metrics |
| `router.go` | Creates named cache instances from storage providers, handles circuit breaker wrapping, closes caches on shutdown |
| `graph_server.go` | Validates subgraph/entity override references at startup, wires metrics, passes config to executor |

### Module Extension Point (`modules.go`)

```go
type EntityCacheKeyInterceptor interface {
    OnEntityCacheKeys(keys [][]byte, ctx RequestContext) [][]byte
}
```
Custom modules can transform cache keys before L2 operations. Use case: multi-tenant key prefixing based on request context. Auto-discovered during `initModules()`.

---

## 9. Proto Changes

**File:** `proto/wg/cosmo/node/v1/node.proto`

New fields on `DataSourceConfiguration` (field numbers 17-20):

```protobuf
repeated EntityCacheConfiguration entity_cache_configurations = 17;
repeated RootFieldCacheConfiguration root_field_cache_configurations = 18;
repeated CachePopulateConfiguration cache_populate_configurations = 19;
repeated CacheInvalidateConfiguration cache_invalidate_configurations = 20;
```

Supporting messages: `EntityKeyMapping`, `EntityCacheFieldMapping`.

---

## 10. Configuration

### Router Config (`config.yaml`)

```yaml
entity_caching:
  enabled: true
  l1:
    enabled: true              # Per-request deduplication (default: true)
    max_size_bytes: 100MB
  l2:
    enabled: true              # Cross-request caching (default: true)
    storage:
      provider_id: "redis-default"     # References a storage provider
      key_prefix: "cosmo_entity_cache"
    circuit_breaker:
      enabled: true
      failure_threshold: 5
      cooldown_period: 10s
  global_cache_key_prefix: ""          # Optional, e.g. tenant isolation
  subgraph_cache_overrides:            # Three-tier routing
    - name: "products"
      storage_provider_id: "redis-hot"
      entities:
        - type: "Product"
          storage_provider_id: "redis-dedicated"
```

All settings are env-overridable with `ENTITY_CACHING_*` prefix.

**Ownership split:** Subgraph teams define *what* to cache and *when* to invalidate (via schema directives). Platform teams define *where* to cache and *how* to protect it (via router config).

---

## 11. Observability

### Metrics (`router/pkg/metric/entity_cache_metrics.go`)

Seven OTEL instruments:

| Metric | Type | Description |
|--------|------|-------------|
| `router.entity_cache.requests.stats` | Counter | L1/L2 hits and misses |
| `router.entity_cache.keys.stats` | Counter | Key lifecycle (added) |
| `router.entity_cache.latency` | Histogram | L2 operation latency (ms) |
| `router.entity_cache.invalidations` | Counter | By source (mutation/subscription/extension) |
| `router.entity_cache.populations` | Counter | By source (mutation/subscription) |
| `router.entity_cache.shadow.staleness` | Counter | Shadow mode stale data events |
| `router.entity_cache.operation_errors` | Counter | Cache operation errors |

Attributes: `cache_level`, `source`, `cache_name`, `entity_type`.

These metrics power the shadow mode workflow: monitor `shadow.staleness` to validate TTLs before going live, watch `requests.stats` to measure hit rates, track `invalidations` to verify mutation/subscription triggers work.

---

## 12. Test Coverage

### Summary: ~15,500 lines across 20 test files

| Layer | Files | Lines | What's Covered |
|-------|-------|-------|----------------|
| **Engine (graphql-go-tools)** | 13 | ~12,300 | L1/L2 interaction, parallel resolution, shadow mode, negative cache, alias normalization, partial loads, mutation/subscription/extension invalidation, analytics |
| **Composition (TypeScript)** | 1 | ~1,130 | All 14 validation rules, config extraction, federation, @is mapping |
| **Router unit tests** | 4 | ~790 | Memory/Redis/CircuitBreaker cache ops, executor config builders |
| **Router integration tests** | 2 | ~1,300 | 25 end-to-end scenarios with real subgraphs |

### Integration Test Scenarios (25 tests)

**Core caching:**
- L2 miss then hit, different entities produce separate entries
- List query caching (5 entities cached individually)
- Multi-subgraph caching (details + inventory subgraphs)
- Cross-subgraph combined queries
- Root field caching with key mappings
- `@is` directive cache key mapping (`pid` -> `id`)

**Cache behavior:**
- TTL expiry (1s TTL + sleep verification)
- Header-varied cache keys (`includeHeaders`)
- Per-subgraph cache routing (custom Redis per entity type)
- Disabled caching (verify no caching occurs)
- L1 dedup (aliases in single request) + L1+L2 together

**Advanced features:**
- Shadow mode (always fetches, populates cache, compares)
- Partial cache load (warm subset, fetch only missing)
- Negative caching (null responses cached, TTL expiry)
- Shadow mode with failing cache (graceful degradation)

**Invalidation + population:**
- Mutation invalidation + population via `@cacheInvalidate` / `@cachePopulate`
- Delete mutation invalidation
- Subscription invalidation via WebSocket
- Subscription population via WebSocket
- Extension-based invalidation (subgraph response extensions)

**Resilience:**
- Circuit breaker full lifecycle (healthy -> failure -> open -> recovery -> closed)
- Circuit breaker half-open probe

---

## 13. Review Focus Areas

### Architecture & Correctness

1. **L2 write merging is not atomic.** On L2 write, existing cached data is read, merged with fresh fields via `astjson.MergeValues`, then written back. Concurrent requests for the same entity could race. This is acceptable in a best-effort cache model (worst case: one write wins, some fields are re-fetched next time), but verify the engine handles merge conflicts gracefully.

2. **Parallel resolution phases.** The 4-phase model (L1 on main thread -> L2+fetch in goroutines -> merge on main thread -> write on main thread) is subtle. Verify that arena memory is never accessed from goroutines and that analytics merge is complete before snapshot.

3. **Argument-aware field caching growth.** The xxhash suffix approach (`friends_AAA...`) means cached entities grow over time as different argument combinations are cached. There's no per-field TTL -- the entire entity expires together. Consider whether large entities with many argument variants could cause memory pressure.

4. **Subscription `FindByTypeName` collision.** Both `@cachePopulate` and `@cacheInvalidate` on subscriptions create `SubscriptionEntityPopulationConfiguration` entries. `FindByTypeName` returns the first match, which can shadow one config if both exist for the same entity type. There's a workaround in tests (`removeSubscriptionPopulateConfigs`). Review whether this needs a fix.

### Cache Key Integrity

5. **`extractKeyFieldNames` tokenizer.** Splitting `normalizedFieldSet` by whitespace and filtering tokens containing `{` is naive. For compound keys like `@key(fields: "a b { c }")`, the token `b` could be incorrectly extracted. Verify the engine's normalized field set format guarantees safety.

6. **Redis vs Memory TTL asymmetry.** `MemoryEntityCache.Get` populates `RemainingTTL` on cache entries; `RedisEntityCache.Get` does not. If any engine logic depends on `RemainingTTL`, behavior differs between providers.

### Operational

7. **Circuit breaker scope.** The breaker wraps the entire cache, not individual operations. A burst of `Set` failures trips the breaker, which blocks `Get` calls too. This is intentional (failing cache = skip entirely) but worth confirming is the right trade-off.

8. **Memory cache `Len()` is approximate.** The ristretto-backed counter can drift under concurrent access. Integration tests use `require.Equal` on `Len()` -- verify these don't flake under CI load.

9. **`negativeCacheTtlSeconds` source.** Present in proto but not extracted from `@entityCache` directive arguments by the composition layer. Only set via runtime config mutations in tests. Clarify: is this intentionally a runtime-only setting?

### Coverage Gaps

10. **No integration test for `EntityCacheKeyInterceptor`.** The module extension point exists but has no end-to-end test with a custom module.

11. **No integration test for multi-provider storage.** Unit tests cover provider resolution logic, and one integration test uses per-subgraph cache names, but there's no test with two actual Redis instances verifying correct key routing.

12. **Analytics export pipeline.** Metrics instruments and the `CacheAnalyticsCollector`/`CacheAnalyticsSnapshot` are implemented, but the full export pipeline is marked as future work.
