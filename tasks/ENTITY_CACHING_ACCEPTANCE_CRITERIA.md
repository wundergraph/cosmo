# Entity Caching — Acceptance Criteria

Checklist to validate the entity caching implementation matches the specification across all layers: proto, composition, router config, cache backends, runtime behavior, and observability.

---

## 1. Proto Schema

- [x] 6 new messages exist in `proto/wg/cosmo/node/v1/node.proto`: `EntityCacheConfiguration`, `RootFieldCacheConfiguration`, `EntityKeyMapping`, `FieldMapping`, `CachePopulateConfiguration`, `CacheInvalidateConfiguration`
- [x] `EntityCacheConfiguration` includes `negative_cache_ttl_seconds` field (int64, field number 6)
- [x] `DataSourceConfiguration` has 4 new repeated fields at numbers 16-19
- [x] `buf lint` passes with no errors
- [x] `buf breaking --against '.git#branch=main'` reports only additions (no breaking changes)
- [x] Go codegen succeeds (`make generate-go`) and structs exist in `router/gen/proto/`
- [x] TypeScript codegen succeeds (`pnpm generate`) and classes exist in `connect/src/wg/cosmo/node/v1/node_pb.ts`
- [x] `CachePopulateConfiguration.max_age_seconds` is `optional int64` (generates pointer `*int64` in Go)
- [x] Existing router builds: `cd router && go build ./...`
- [x] Existing tests pass: `cd router && go test ./...`

---

## 2. Composition — Directive Registration

- [x] All 5 directives are recognized by the composition pipeline (no "unknown directive" errors)
- [x] `@entityCache(maxAge: Int!, includeHeaders: Boolean = false, partialCacheLoad: Boolean = false, shadowMode: Boolean = false)` on OBJECT — **Note**: `negativeCacheTTL` is omitted from the directive by design; it is set via router config (`NegativeCacheTtlSeconds` proto field) rather than schema directive
- [x] `@queryCache(maxAge: Int!, includeHeaders: Boolean = false, shadowMode: Boolean = false)` on FIELD_DEFINITION
- [x] `@is(field: String!)` on ARGUMENT_DEFINITION
- [x] `@cacheInvalidate` (no args) on FIELD_DEFINITION
- [x] `@cachePopulate(maxAge: Int)` on FIELD_DEFINITION
- [x] None are repeatable
- [x] Directives are stripped from the federated/client schema (not visible to clients)
- [x] `npx tsc --noEmit` in `composition/` passes
- [x] Existing composition tests pass

---

## 3. Composition — Validation Rules (20 rules)

### `@entityCache`

- [x] **Rule 1**: Error when `@entityCache` is on a type without `@key` — message: `"Type 'X' has @entityCache but no @key directive."`
- [x] **Rule 2**: Error when a type has multiple `@entityCache` directives — message: `"Type 'X' has multiple @entityCache directives."`
- [x] **Rule 3**: Error when `maxAge` is zero or negative — message: `"@entityCache maxAge must be a positive integer, got 'N'."`
- [x] **Rule 3a**: N/A — `negativeCacheTTL` is not a directive argument (set via router config)
- [x] Valid: `@entityCache(maxAge: 300)` on a type with `@key` composes successfully
- [x] Valid: negative cache TTL is set via proto config, not directive

### `@queryCache`

- [x] **Rule 4**: Error when `@queryCache` is on a Mutation or Subscription field
- [x] **Rule 5**: Error when return type is not an entity (no `@key`)
- [x] **Rule 6**: Error when return entity type lacks `@entityCache`
- [x] **Rule 7**: Warning (not error) when a `@key` field cannot be mapped to any argument on a non-list return
- [x] **Rule 7 — write-only mode**: Incomplete mapping emits warning; graphql-go-tools handles the write-only behavior internally (no explicit `cacheReadEnabled` proto field needed)
- [x] **Rule 8**: List returns do NOT require argument-to-key mapping (no error, no warning). Entity keys are extracted per-entity from the response data.
- [x] **Rule 9**: Error when `maxAge` is zero or negative

### `@is`

- [x] **Rule 10**: Error when `@is` is on an argument of a field without `@queryCache`
- [x] **Rule 11**: Error when `@is(field)` references a non-existent `@key` field
- [x] **Rule 12**: Error when two arguments map to the same `@key` field
- [x] **Rule 13**: Warning (not error) when `@is` is redundant (argument name already matches `@key` field) — **Note**: implemented as warning instead of error for leniency; acceptable divergence

### `@cacheInvalidate`

- [x] **Rule 14**: Error when on a Query field
- [x] **Rule 15**: Error when return type is not an entity with `@key` and `@entityCache`
- [x] **Rule 16**: Error when both `@cacheInvalidate` and `@cachePopulate` on same field

### `@cachePopulate`

- [x] **Rule 17**: Error when on a Query field
- [x] **Rule 18**: Error when return type is not an entity with `@key` and `@entityCache`
- [x] **Rule 19**: Mutual exclusivity with `@cacheInvalidate` (same error as rule 16)
- [x] **Rule 20**: Error when `maxAge` is provided but not a positive integer

---

## 4. Composition — Argument-to-Key Mapping

- [x] Auto-mapping: argument name `id` matches `@key(fields: "id")` automatically
- [x] Explicit mapping: `@is(field: "upc")` on argument `productUpc` produces correct `EntityKeyMapping`/`FieldMapping`
- [x] Composite keys: `@key(fields: "orderId itemId")` — both fields must be mapped for cache reads
- [x] No-argument field (e.g., `me: User`) — uses root field cache key format, no mapping needed
- [x] List return field — no mapping required, entity keys extracted per-entity from response data
- [x] Incomplete mapping on non-list return — warning emitted (write-only mode handled by graphql-go-tools)
- [x] Complete mapping on non-list return — full cache read/write enabled
- [x] Composition output JSON contains correct `entity_key_mappings` array in `root_field_cache_configurations`

---

## 5. Composition — Config Output (Proto Serialization)

- [x] `entity_cache_configurations` array populated per datasource with: `type_name`, `max_age_seconds`, `include_headers`, `partial_cache_load`, `shadow_mode`, `negative_cache_ttl_seconds`
- [x] `root_field_cache_configurations` array populated with: `field_name`, `max_age_seconds`, `include_headers`, `shadow_mode`, `entity_type_name`, `entity_key_mappings[]`
- [x] `cache_populate_configurations` array populated with: `field_name`, `operation_type` ("Mutation" or "Subscription"), optional `max_age_seconds`
- [x] `cache_invalidate_configurations` array populated with: `field_name`, `operation_type`, `entity_type_name`
- [x] Each datasource/subgraph gets only its own entity types' cache configs (not all entities from all subgraphs)
- [x] Field names match proto snake_case convention
- [x] `max_age_seconds` values are correct integers (seconds)
- [x] Boolean defaults (false) are correctly represented

---

## 6. Cache Backends

### RedisEntityCache

- [x] Implements `resolve.LoaderCache` interface (compile-time guard)
- [x] `Get`: uses `MGET` — single round trip for batch retrieval
- [x] `Get`: returns `nil` at miss positions (positional correspondence)
- [x] `Get`: prepends `keyPrefix:` to each key before Redis lookup
- [x] `Set`: uses pipeline `SET` with TTL for batch writes
- [x] `Set`: prepends `keyPrefix:` to each key
- [x] `Delete`: uses pipeline `DEL` for batch deletes
- [x] `Delete`: prepends `keyPrefix:` to each key
- [x] Empty key/entry slices return nil/no error (no panic, no Redis call)
- [x] Nil entries in `Set` batch are skipped (no panic)
- [x] Thread-safe for concurrent use (go-redis client is safe)
- [x] Key prefix isolation: two caches with different prefixes on same Redis don't collide

### MemoryEntityCache

- [x] Implements `resolve.LoaderCache` interface (compile-time guard)
- [x] `Get`: returns `nil` at miss positions
- [x] `Get`: returns `nil` for expired entries (lazy expiry on read)
- [x] `Get`: returns `RemainingTTL` for non-expired entries
- [x] `Set`: stores entries with correct expiry time
- [x] `Set`: with `ttl == 0` stores entries with no expiry
- [x] `Delete`: removes entries
- [x] `Delete`: non-existent key — no error
- [x] Empty key/entry slices — no error, no panic
- [x] Nil entries in `Set` batch — no panic
- [x] TTL expiry: short TTL + sleep → entry returns nil
- [x] Overwrite: second `Set` for same key replaces value and TTL
- [x] `Len()` helper returns correct count
- [x] Thread-safe: concurrent goroutines with `-race` flag — no races
- [x] Unit tests pass: `go test -race ./router/pkg/entitycache/...`

---

## 7. Router YAML Config

- [x] `entity_caching` key parses correctly in router YAML
- [x] Default values: `enabled=false`, `global_cache_key_prefix=""`, `l1.enabled=true`, `l2.enabled=true`, `l2.storage.key_prefix="cosmo_entity_cache"`, `l2.circuit_breaker.enabled=false`, `l2.circuit_breaker.failure_threshold=5`, `l2.circuit_breaker.cooldown_period=10s`, `analytics.enabled=false`, `analytics.hash_entity_keys=false`
- [x] Environment variable overrides work for all fields:
  - [x] `ENTITY_CACHING_ENABLED`
  - [x] `ENTITY_CACHING_GLOBAL_CACHE_KEY_PREFIX`
  - [x] `ENTITY_CACHING_L1_ENABLED`
  - [x] `ENTITY_CACHING_L2_ENABLED`
  - [x] `ENTITY_CACHING_L2_STORAGE_PROVIDER_ID`
  - [x] `ENTITY_CACHING_L2_STORAGE_KEY_PREFIX`
  - [x] `ENTITY_CACHING_L2_CIRCUIT_BREAKER_ENABLED`
  - [x] `ENTITY_CACHING_L2_CIRCUIT_BREAKER_FAILURE_THRESHOLD`
  - [x] `ENTITY_CACHING_L2_CIRCUIT_BREAKER_COOLDOWN_PERIOD`
  - [x] `ENTITY_CACHING_ANALYTICS_ENABLED`
  - [x] `ENTITY_CACHING_ANALYTICS_HASH_ENTITY_KEYS`
- [x] `subgraphs` array parses with `name`, `entities[].type`, `entities[].cache_name`
- [x] `provider_id` correctly references `storage_providers.redis[].id`
- [x] `cache_name` correctly references `storage_providers.redis[].id`
- [x] Missing/empty `entity_caching` block — router starts normally with caching disabled
- [x] Invalid `provider_id` (not in `storage_providers`) — clear error at startup
- [x] Existing config tests pass: `cd router && go test ./pkg/config/...`

---

## 8. Router Module — EntityCacheKeyInterceptor

- [x] `EntityCacheKeyInterceptor` interface defined in `router/core/modules.go`
- [x] Interface signature: `OnEntityCacheKeys(keys [][]byte, ctx RequestContext) [][]byte`
- [x] Modules implementing the interface are discovered during `initModules()`
- [x] Multiple modules are called in priority order (lower priority = earlier)
- [x] Output of one interceptor is input to the next (chaining)
- [x] Returned slice must have same length as input
- [x] No interceptor registered — cache keys used as-is (no error)
- [x] Example TenantCacheIsolation module from spec compiles against the interface

---

## 9. Router Wiring — Cache Instance Building

- [x] With `entity_caching.enabled: true` + valid `l2.storage.provider_id` → Redis cache instance created
- [x] Default cache created from `l2.storage.provider_id`
- [x] Per-subgraph `cache_name` creates additional cache instances from `storage_providers.redis`
- [x] `cache_name: "default"` uses the default cache (no duplicate instance)
- [x] Cache instances passed to executor as `map[string]resolve.LoaderCache`
- [x] Caches wrapped with circuit breakers in `buildEntityCacheInstances()` when `circuit_breaker.enabled: true` — **Note**: wrapping happens at cache build time (decorator pattern) rather than via separate `CacheCircuitBreakers` map on ResolverOptions
- [x] With `entity_caching.enabled: false` → no cache instances created, no Redis connections
- [x] With `l2.enabled: false` → no L2 cache instances, L1 still works

---

## 10. Runtime — Query Execution (L1 + L2 Flow)

### Basic L2 Cache

- [x] First query for an entity → L2 miss → subgraph fetch → entity returned → L2 populated
- [x] Second identical query → L2 hit → no subgraph fetch → cached entity returned
- [x] Different entity (different key) → separate cache entry → subgraph fetch
- [x] Entity data returned is identical whether from cache or subgraph (JSON match)

### L1 Cache (Per-Request Deduplication)

- [x] Single request requiring same entity twice → entity fetched once from subgraph
- [x] L1 covers entity fetches only (not root fields)
- [x] L1 is per-request — different requests don't share L1

### TTL

- [x] Entity expires after `maxAge` seconds → next request is a cache miss
- [x] Different entities can have different TTLs (per `@entityCache(maxAge)`)

### Cache Key Format

- [x] Entity key format: `{"__typename":"User","key":{"id":"123"}}`
- [x] Composite key format: `{"__typename":"OrderItem","key":{"itemId":"42","orderId":"1"}}` (fields sorted alphabetically)
- [x] Root field key format: `{"__typename":"Query","field":"me"}`
- [x] Cache keys use ONLY `@key` fields — `@requires` and `@provides` never included
- [x] Field argument values hashed and appended as suffix when entity fields have arguments

---

## 11. Runtime — `@queryCache` Behavior

### Single Entity Return with Mapped Args

- [x] `user(id: "123")` with `@queryCache` → cache key uses entity format `{"__typename":"User","key":{"id":"123"}}`
- [x] Cache shared with `_entities` fetch: `@queryCache` hit also serves subsequent `_entities` fetch for same User
- [x] `@entityCache` write also serves subsequent `@queryCache` query for same User

### Explicit Mapping with `@is`

- [x] `userById(userId: "123")` with `@is(field: "id")` → cache key `{"__typename":"User","key":{"id":"123"}}`
- [x] Shares cache with `user(id: "123")` and `_entities` User fetch

### Composite Key Mapping

- [x] `orderItem(orderId: "1", itemId: "42")` → cache key `{"__typename":"OrderItem","key":{"itemId":"42","orderId":"1"}}`

### List Return

- [x] `topProducts(first: 5): [Product!]!` → each Product cached individually with entity key
- [x] Subsequent `product(upc: "top-1")` is a cache hit (shared via entity key)

### No-Argument Field

- [x] `me: User` → cache key `{"__typename":"Query","field":"me"}` — **Note**: tested via `items` no-argument list query which uses root field cache format; a dedicated `me`-style single-entity field was not added to test subgraphs
- [x] Uses root field cache key format (no entity key sharing)

---

## 12. Runtime — `@entityCache` Arguments

### `includeHeaders`

- [x] With `includeHeaders: false` (default) — same entity, different headers → same cache entry
- [x] With `includeHeaders: true` — same entity, different forwarded headers → different cache entries
- [x] Header hash is prepended to cache key: `{headerHash}:{"__typename":"User","key":{"id":"123"}}`

### `partialCacheLoad`

- [x] With `partialCacheLoad: false` (default) — any miss in a batch → ALL entities refetched from subgraph
- [x] With `partialCacheLoad: true` — only missing entities fetched, cached ones served from cache

### `shadowMode`

- [x] Fresh data always fetched from subgraph (never served from cache)
- [x] L2 reads still happen (to measure hit rates)
- [x] L2 writes still happen (to populate cache for metrics)
- [x] L1 cache works normally (unaffected by shadow mode)
- [x] Shadow mode staleness counter incremented when cached data differs from fresh data

---

## 13. Runtime — Mutation Behavior

### Default (no cache directives on mutation)

- [x] Mutations always skip L2 reads (always fetch fresh data)
- [x] Mutations skip L2 writes by default

### `@cacheInvalidate`

- [x] After mutation completes and returns entity data → L2 cache entry deleted
- [x] Cache key built from `@key` fields in mutation response
- [x] Subsequent query for same entity is a cache miss → subgraph fetch

### `@cachePopulate`

- [x] Mutation enables L2 writes for entity fetches during execution
- [x] L2 reads remain skipped (mutation always fetches fresh)
- [x] After mutation, freshly fetched entities written to L2
- [x] Subsequent query for written entity is a cache hit
- [x] With `maxAge` override — entries written with overridden TTL instead of entity's TTL
- [x] Without `maxAge` — entries written with entity's `@entityCache(maxAge)` TTL

---

## 14. Runtime — Subscription Behavior

### `@cachePopulate` on Subscription

- [x] When subscription event arrives with entity data → entity written to L2 cache
- [x] Uses entity's `@entityCache(maxAge)` TTL (or `@cachePopulate(maxAge)` override)
- [x] Subsequent query for that entity is a cache hit

### `@cacheInvalidate` on Subscription

- [x] When subscription event arrives → L2 cache entry deleted
- [x] Cache key built from `@key` fields in subscription event data
- [x] Subsequent query for that entity is a cache miss

---

## 15. Runtime — Extension-Based Invalidation

- [x] Router inspects `extensions.cacheInvalidation.keys` in every subgraph response
- [x] Each entry `{ "typename": "User", "key": { "id": "1" } }` → corresponding L2 entry deleted
- [x] Invalidation is **scoped to the responding subgraph** — only that subgraph's cache backend is targeted
- [x] Full key transformation pipeline applied (key prefix, header hash, interceptor modules)
- [x] Entity type must have `@entityCache` in the responding subgraph — unknown types skipped
- [x] `key` object must contain all `@key` fields
- [x] Works regardless of operation type (query, mutation, subscription)
- [x] Multiple entities invalidated in single response
- [x] Malformed `extensions` JSON → logged, request not failed
- [x] Unknown entity type in extension → entry skipped, others processed
- [x] Missing key fields → entry skipped, others processed
- [x] Cache delete failure → logged, request not failed

---

## 16. Runtime — Key Transformation Pipeline

Applied in order for all L2 operations:

- [x] **Step 1**: Base key (JSON entity or root field key)
- [x] **Step 2**: Global cache key prefix (when `global_cache_key_prefix` set): `{global}:{baseKey}`
- [x] **Step 3**: Header hash prefix (when `includeHeaders: true`): `{global}:{headerHash}:{baseKey}`
- [x] **Step 4**: EntityCacheKeyInterceptor modules (batch transform): `{modulePrefix}:{global}:{headerHash}:{baseKey}`
- [x] **Step 5**: Redis key prefix (applied by RedisEntityCache internally): `cosmo_entity_cache:{modulePrefix}:{global}:{headerHash}:{baseKey}`
- [x] Extension-based invalidation applies same pipeline (steps 1-4, step 5 by cache impl)
- [x] Mutation-triggered invalidation applies same pipeline
- [x] Subscription cache populate/invalidate applies same pipeline

---

## 17. Runtime — Per-Request Configuration

- [x] `CachingOptions.EnableL1Cache` set from `entity_caching.l1.enabled` (when `entity_caching.enabled`)
- [x] `CachingOptions.EnableL2Cache` set from `entity_caching.l2.enabled` (when `entity_caching.enabled`)
- [x] `CachingOptions.EnableCacheAnalytics` set from `entity_caching.analytics.enabled` (when `entity_caching.enabled`)
- [x] `CachingOptions.L2CacheKeyInterceptor` wraps registered `EntityCacheKeyInterceptor` modules
- [x] `CachingOptions.GlobalCacheKeyPrefix` set from `entity_caching.global_cache_key_prefix`
- [x] With `entity_caching.enabled: false` — all CachingOptions fields false/nil/empty
- [x] WebSocket/subscription handler sets same CachingOptions as HTTP handler

---

## 18. Runtime — Cross-Subgraph Behavior

- [x] Same entity type in multiple subgraphs with different `@entityCache` configs → each subgraph's config applies independently
- [x] Entity data cached per-subgraph with subgraph-specific TTL
- [x] Entity key format consistent across subgraphs (derived from `@key` fields)
- [x] Different subgraphs can route to different Redis backends via `cache_name`

---

## 19. Runtime — Per-Subgraph Cache Routing

- [x] `cache_name: "fast-cache"` routes to the `storage_providers.redis` entry with `id: "fast-cache"`
- [x] `cache_name: "default"` or no `cache_name` routes to `l2.storage.provider_id` backend
- [x] Different entity types in same subgraph can use different cache backends
- [x] Different subgraphs can use different cache backends for same entity type

---

## 20. Observability — Metrics

All metrics gated by `entity_caching.analytics.enabled`:

- [x] `router.entity_cache.requests.stats` (Counter) — labels: `type` (hits/misses), `cache_level` (l1/l2), `cache_type` (entity/root_field)
- [x] `router.entity_cache.keys.stats` (Counter) — labels: `operation` (added/updated/evicted), `cache_type`
- [x] `router.entity_cache.latency` (Histogram) — labels: `cache_level` (l2), `operation` (get/set/delete) — unit: ms
- [x] `router.entity_cache.invalidations` (Counter) — labels: `source` (mutation/subscription/extension)
- [x] `router.entity_cache.populations` (Counter) — labels: `source` (mutation/subscription/query)
- [x] `router.entity_cache.shadow.staleness` (Counter) — labels: `cache_type`
- [x] `router.entity_cache.operation_errors` (Counter) — labels: `operation` (get/set/set_negative/delete), `cache_name`, `entity_type`
- [x] Metrics exported via OTLP exporter
- [x] Metrics exported via Prometheus `/metrics` endpoint
- [x] With `analytics.enabled: false` — no metrics created or recorded
- [x] With `analytics.hash_entity_keys: true` — entity keys hashed in log messages and trace attributes
- [x] Metric cardinality is bounded (no entity key or user data in labels)

---

## 21. Observability — Cache Stats After Execution

- [x] `ctx.GetCacheStats()` returns snapshot with L1/L2 hit/miss counts
- [x] `snapshot.L1HitRate()` returns correct float64 [0, 1]
- [x] `snapshot.L2HitRate()` returns correct float64 [0, 1]
- [x] `snapshot.CachedBytesServed()` returns correct byte count
- [x] `snapshot.CacheOpErrors` contains recorded cache operation errors (when analytics enabled)

---

## 22. Thread Safety

- [x] `RedisEntityCache` safe for concurrent use (go-redis guarantee)
- [x] `MemoryEntityCache` safe for concurrent use (sync.RWMutex)
- [x] All cache operations (`Get`, `Set`, `Delete`) callable from multiple goroutines
- [x] All unit and integration tests pass with `-race` flag
- [x] `EntityCacheKeyInterceptor` called from per-request goroutine — no shared mutable state
- [x] L2 cache allocations use per-goroutine arenas (`l2ArenaPool`) — no shared `jsonArena` access in Phase 2 goroutines
- [x] Per-goroutine arenas released in `Loader.Free()` (not inside goroutine) due to cross-arena `MergeValues` references
- [x] Circuit breaker state uses atomic operations — no locks needed for state transitions

---

## 23. Backward Compatibility

- [x] Adding new proto repeated fields is backward-compatible — old routers ignore unknown fields
- [x] New routers see empty arrays when caching not configured — no errors
- [x] No `RouterCompatibilityVersionThreshold` bump needed
- [x] Existing router tests pass without modification
- [x] Existing composition tests pass without modification
- [x] Router starts normally without `entity_caching` in YAML config

---

## 24. Negative Caching

- [x] With `negativeCacheTTL: 10` on entity type, null entity response stored as `"null"` sentinel in L2
- [x] Subsequent request for same entity returns null from cache without calling subgraph
- [x] With `negativeCacheTTL: 0` (default), null entity responses are NOT cached — subgraph called every time
- [x] Negative cache entries use `NegativeCacheTTL` (not regular entity `TTL`) for cache `Set` call
- [x] Different entity types can have different negative cache TTLs
- [x] Negative cache sentinel recognized during L2 validation (treated as cache hit, skips re-fetch)
- [x] Negative cache works with partial cache loading (cached null entities not re-fetched)
- [x] Negative cache works with batch entity fetches (individual null entities in batch cached separately)
- [x] `NegativeCacheHit` flag set on `CacheKey` during `mergeResult` when subgraph returns null
- [x] `cacheKeysToNegativeEntries` only collects entries with `NegativeCacheHit=true`
- [x] Negative sentinels stored via separate `cache.Set()` call with `NegativeCacheTTL` duration

---

## 25. Global Cache Key Prefix

- [x] `global_cache_key_prefix` in router YAML config parsed correctly
- [x] `ENTITY_CACHING_GLOBAL_CACHE_KEY_PREFIX` env var overrides YAML value
- [x] When set, prefix prepended to all L2 cache keys: `{prefix}:{rest_of_key}`
- [x] When empty (default), no prefix applied (no extra colon)
- [x] Global prefix applied before header hash prefix: `{global}:{headerHash}:{jsonKey}`
- [x] Global prefix applied in `prepareCacheKeys()` for L2 reads/writes
- [x] Global prefix applied in `buildMutationEntityCacheKey()` for mutation invalidation
- [x] Global prefix applied in `processExtensionsCacheInvalidation()` for extension-based invalidation
- [x] Global prefix applied in `handleTriggerEntityCache()` for subscription populate/invalidate
- [x] Changing the prefix effectively invalidates all old cache entries (different keys, cache misses)
- [x] Global prefix set on `CachingOptions.GlobalCacheKeyPrefix` per-request from router config

---

## 26. Circuit Breaker

- [x] `CircuitBreakerConfig` with `Enabled`, `FailureThreshold`, `CooldownPeriod` fields
- [x] Circuit breaker wraps `LoaderCache` as decorator (`CircuitBreakerCache`) — **Note**: wrapping happens in `buildEntityCacheInstances()` at cache build time, not via separate `CacheCircuitBreakers` map on ResolverOptions
- [x] **Closed state**: All L2 operations (Get/Set/Delete) pass through to underlying cache
- [x] **Open state**: All L2 operations return nil/no-op (fall back to subgraph fetch)
- [x] Transition Closed → Open: after `FailureThreshold` consecutive failures
- [x] **Half-Open state**: After `CooldownPeriod` elapses, one probe request allowed through
- [x] Transition Half-Open → Closed: probe request succeeds
- [x] Transition Half-Open → Open: probe request fails
- [x] `IsOpen()` method returns current breaker state
- [x] State transitions use atomic operations (goroutine-safe)
- [x] Default `FailureThreshold`: 5
- [x] Default `CooldownPeriod`: 10s

---

## 27. Cache Operation Error Tracking

- [x] `CacheOperationError` struct with: `Operation`, `CacheName`, `EntityType`, `DataSource`, `Message`, `ItemCount`
- [x] L2 `Get` errors recorded with operation `"get"`
- [x] L2 `Set` errors recorded with operation `"set"`
- [x] L2 `Set` errors for negative sentinels recorded with operation `"set_negative"`
- [x] L2 `Delete` errors (mutation invalidation) recorded with operation `"delete"`
- [x] L2 `Delete` errors (extension invalidation) recorded with operation `"delete"`
- [x] Error messages truncated to 256 characters for safety
- [x] Errors only recorded when analytics are enabled (`EnableCacheAnalytics = true`)
- [x] Goroutine-collected errors merged on main thread via `MergeL2CacheOpErrors()`
- [x] `CacheAnalyticsSnapshot.CacheOpErrors` contains all recorded errors
- [x] Cache errors remain non-fatal — engine falls back to subgraph fetch on error

---

## 28. Integration Test Scenarios (22)

- [x] **1. Basic L2 miss-then-hit**: First request → subgraph call; second request → no subgraph call
- [x] **2. Different entities**: User(1) and User(2) → separate cache entries, separate subgraph calls
- [x] **3. L1 deduplication**: Single request fetches same entity twice → subgraph called once
- [x] **4. Mutation invalidation**: Query (cached) → mutate → query again (cache miss, subgraph called)
- [x] **5. Mutation population**: Mutate with `@cachePopulate` → subsequent query is cache hit
- [x] **6. Mutual exclusivity**: Composition rejects `@cacheInvalidate` + `@cachePopulate` on same field
- [x] **7. Multi-subgraph cache**: User from accounts and Product from products cached independently
- [x] **8. Root field caching**: `@queryCache` result cached with entity key sharing
- [x] **9. `@is` argument mapping**: `userById(userId)` with `@is(field: "id")` shares cache with User entity
- [x] **10. List return caching**: `topProducts` caches each Product individually; `product(upc)` is cache hit
- [x] **11. Extension-based invalidation**: Subgraph sends `cacheInvalidation` extension → cache cleared
- [x] **12. Subscription invalidation**: `productDeleted` event → cache entry deleted
- [x] **13. Subscription population**: `productPriceChanged` event → cache populated
- [x] **14. TTL expiry**: Short TTL + wait → cache miss
- [x] **15. Shadow mode**: Fresh data always served, cache reads/writes happen, subgraph always called
- [x] **16. Analytics**: Cache hit/miss metrics collected when analytics enabled
- [x] **17. No-argument query cache**: `items` (no args) uses root field cache format — covered by `root_field_list_caching` test
- [x] **18. Per-subgraph cache name**: Different entities route to different cache instances
- [x] **19. Negative caching**: Null entity response cached as sentinel → subsequent request returns null from cache, no subgraph call
- [x] **20. Global cache key prefix**: Cache keys include global prefix; changing prefix → all old entries missed
- [x] **21. Circuit breaker**: Redis fails repeatedly → L2 ops skip, subgraph fallback; after cooldown → probe succeeds, breaker closes
- [x] **22. Cache operation errors**: Get/Set/Delete failures recorded in `CacheAnalyticsSnapshot.CacheOpErrors` when analytics enabled

---

## 29. Build & Test Gates

- [x] `buf lint` — no errors
- [x] `make generate-go` — succeeds
- [x] `pnpm generate` — succeeds
- [x] `cd router && go build ./...` — compiles
- [x] `cd router && go test -race ./...` — all pass
- [x] `cd router && go test -race ./pkg/entitycache/...` — cache backend tests pass
- [x] `cd composition && npx tsc --noEmit` — no type errors
- [x] `cd composition && npm test` — all pass
- [x] `cd router-tests && go test -race ./...` — integration tests pass
- [x] No new dependencies added (go-redis v9 and graphql-go-tools already in go.mod)
