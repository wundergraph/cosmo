# Entity Caching — Acceptance Criteria

Checklist to validate the entity caching implementation matches the specification across all layers: proto, composition, router config, cache backends, runtime behavior, and observability.

---

## 1. Proto Schema

- [ ] 6 new messages exist in `proto/wg/cosmo/node/v1/node.proto`: `EntityCacheConfiguration`, `RootFieldCacheConfiguration`, `EntityKeyMapping`, `FieldMapping`, `CachePopulateConfiguration`, `CacheInvalidateConfiguration`
- [ ] `EntityCacheConfiguration` includes `negative_cache_ttl_seconds` field (int64, field number 6)
- [ ] `DataSourceConfiguration` has 4 new repeated fields at numbers 16-19
- [ ] `buf lint` passes with no errors
- [ ] `buf breaking --against '.git#branch=main'` reports only additions (no breaking changes)
- [ ] Go codegen succeeds (`make generate-go`) and structs exist in `router/gen/proto/`
- [ ] TypeScript codegen succeeds (`pnpm generate`) and classes exist in `connect/src/wg/cosmo/node/v1/node_pb.ts`
- [ ] `CachePopulateConfiguration.max_age_seconds` is `optional int64` (generates pointer `*int64` in Go)
- [ ] Existing router builds: `cd router && go build ./...`
- [ ] Existing tests pass: `cd router && go test ./...`

---

## 2. Composition — Directive Registration

- [ ] All 5 directives are recognized by the composition pipeline (no "unknown directive" errors)
- [ ] `@entityCache(maxAge: Int!, negativeCacheTTL: Int = 0, includeHeaders: Boolean = false, partialCacheLoad: Boolean = false, shadowMode: Boolean = false)` on OBJECT
- [ ] `@queryCache(maxAge: Int!, includeHeaders: Boolean = false, shadowMode: Boolean = false)` on FIELD_DEFINITION
- [ ] `@is(field: String!)` on ARGUMENT_DEFINITION
- [ ] `@cacheInvalidate` (no args) on FIELD_DEFINITION
- [ ] `@cachePopulate(maxAge: Int)` on FIELD_DEFINITION
- [ ] None are repeatable
- [ ] Directives are stripped from the federated/client schema (not visible to clients)
- [ ] `npx tsc --noEmit` in `composition/` passes
- [ ] Existing composition tests pass

---

## 3. Composition — Validation Rules (20 rules)

### `@entityCache`

- [ ] **Rule 1**: Error when `@entityCache` is on a type without `@key` — message: `"Type 'X' has @entityCache but no @key directive."`
- [ ] **Rule 2**: Error when a type has multiple `@entityCache` directives — message: `"Type 'X' has multiple @entityCache directives."`
- [ ] **Rule 3**: Error when `maxAge` is zero or negative — message: `"@entityCache maxAge must be a positive integer, got 'N'."`
- [ ] **Rule 3a**: Error when `negativeCacheTTL` is negative — message: `"@entityCache negativeCacheTTL must be a non-negative integer, got 'N'."`
- [ ] Valid: `@entityCache(maxAge: 300)` on a type with `@key` composes successfully
- [ ] Valid: `@entityCache(maxAge: 300, negativeCacheTTL: 10)` composes successfully

### `@queryCache`

- [ ] **Rule 4**: Error when `@queryCache` is on a Mutation or Subscription field — message: `"@queryCache is only valid on Query fields, found on Mutation.X / Subscription.X."`
- [ ] **Rule 5**: Error when return type is not an entity (no `@key`) — message: `"Field 'Query.X' has @queryCache but returns non-entity type 'Y'. @queryCache requires the return type to be an entity with @key."`
- [ ] **Rule 6**: Error when return entity type lacks `@entityCache` — message: `"Field 'Query.X' returns entity type 'Y' which does not have @entityCache."`
- [ ] **Rule 7**: Warning (not error) when a `@key` field cannot be mapped to any argument on a non-list return — message: `"Field 'Query.X' has @queryCache returning 'Y' but @key field 'Z' cannot be mapped to any argument. Cache reads are disabled for this field (cache writes/population still work). Add an argument named 'Z' or use @is(field: \"Z\") to enable cache reads."`
- [ ] **Rule 7 — write-only mode**: Incomplete mapping sets `cacheReadEnabled: false` on the config (cache population still works)
- [ ] **Rule 8**: List returns do NOT require argument-to-key mapping (no error, no warning). Entity keys are extracted per-entity from the response data.
- [ ] **Rule 9**: Error when `maxAge` is zero or negative

### `@is`

- [ ] **Rule 10**: Error when `@is` is on an argument of a field without `@queryCache` — message: `"@is on argument 'X' of field 'Query.Y' has no effect without @queryCache."`
- [ ] **Rule 11**: Error when `@is(field)` references a non-existent `@key` field — message: `"@is(field: \"X\") on argument 'Y' of field 'Query.Z' references unknown @key field 'X' on type 'W'."`
- [ ] **Rule 12**: Error when two arguments map to the same `@key` field — message: `"Multiple arguments on field 'Query.X' map to @key field 'Y'."`
- [ ] **Rule 13**: Error when `@is` is redundant (argument name already matches `@key` field) — message: `"Argument 'X' on field 'Query.Y' already matches @key field 'X' by name — @is is redundant."`

### `@cacheInvalidate`

- [ ] **Rule 14**: Error when on a Query field — message: `"@cacheInvalidate is only valid on Mutation or Subscription fields."`
- [ ] **Rule 15**: Error when return type is not an entity with `@key` and `@entityCache` — message: `"Field 'Mutation.X' has @cacheInvalidate but returns non-entity type 'Y'."`
- [ ] **Rule 16**: Error when both `@cacheInvalidate` and `@cachePopulate` on same field — message: `"Field 'Mutation.X' has both @cacheInvalidate and @cachePopulate. A field must use one or the other, not both."`

### `@cachePopulate`

- [ ] **Rule 17**: Error when on a Query field — message: `"@cachePopulate is only valid on Mutation or Subscription fields."`
- [ ] **Rule 18**: Error when return type is not an entity with `@key` and `@entityCache`
- [ ] **Rule 19**: Mutual exclusivity with `@cacheInvalidate` (same error as rule 16)
- [ ] **Rule 20**: Error when `maxAge` is provided but not a positive integer

---

## 4. Composition — Argument-to-Key Mapping

- [ ] Auto-mapping: argument name `id` matches `@key(fields: "id")` automatically
- [ ] Explicit mapping: `@is(field: "upc")` on argument `productUpc` produces correct `EntityKeyMapping`/`FieldMapping`
- [ ] Composite keys: `@key(fields: "orderId itemId")` — both fields must be mapped for cache reads
- [ ] No-argument field (e.g., `me: User`) — uses root field cache key format, no mapping needed
- [ ] List return field — no mapping required, entity keys extracted per-entity from response data
- [ ] Incomplete mapping on non-list return — warning emitted, `cacheReadEnabled: false` (write-only mode)
- [ ] Complete mapping on non-list return — `cacheReadEnabled: true`
- [ ] Composition output JSON contains correct `entity_key_mappings` array in `root_field_cache_configurations`

---

## 5. Composition — Config Output (Proto Serialization)

- [ ] `entity_cache_configurations` array populated per datasource with: `type_name`, `max_age_seconds`, `include_headers`, `partial_cache_load`, `shadow_mode`, `negative_cache_ttl_seconds`
- [ ] `root_field_cache_configurations` array populated with: `field_name`, `max_age_seconds`, `include_headers`, `shadow_mode`, `entity_type_name`, `entity_key_mappings[]`
- [ ] `cache_populate_configurations` array populated with: `field_name`, `operation_type` ("Mutation" or "Subscription"), optional `max_age_seconds`
- [ ] `cache_invalidate_configurations` array populated with: `field_name`, `operation_type`, `entity_type_name`
- [ ] Each datasource/subgraph gets only its own entity types' cache configs (not all entities from all subgraphs)
- [ ] Field names match proto snake_case convention
- [ ] `max_age_seconds` values are correct integers (seconds)
- [ ] Boolean defaults (false) are correctly represented

---

## 6. Cache Backends

### RedisEntityCache

- [ ] Implements `resolve.LoaderCache` interface (compile-time guard)
- [ ] `Get`: uses `MGET` — single round trip for batch retrieval
- [ ] `Get`: returns `nil` at miss positions (positional correspondence)
- [ ] `Get`: prepends `keyPrefix:` to each key before Redis lookup
- [ ] `Set`: uses pipeline `SET` with TTL for batch writes
- [ ] `Set`: prepends `keyPrefix:` to each key
- [ ] `Delete`: uses pipeline `DEL` for batch deletes
- [ ] `Delete`: prepends `keyPrefix:` to each key
- [ ] Empty key/entry slices return nil/no error (no panic, no Redis call)
- [ ] Nil entries in `Set` batch are skipped (no panic)
- [ ] Thread-safe for concurrent use (go-redis client is safe)
- [ ] Key prefix isolation: two caches with different prefixes on same Redis don't collide

### MemoryEntityCache

- [ ] Implements `resolve.LoaderCache` interface (compile-time guard)
- [ ] `Get`: returns `nil` at miss positions
- [ ] `Get`: returns `nil` for expired entries (lazy expiry on read)
- [ ] `Get`: returns `RemainingTTL` for non-expired entries
- [ ] `Set`: stores entries with correct expiry time
- [ ] `Set`: with `ttl == 0` stores entries with no expiry
- [ ] `Delete`: removes entries
- [ ] `Delete`: non-existent key — no error
- [ ] Empty key/entry slices — no error, no panic
- [ ] Nil entries in `Set` batch — no panic
- [ ] TTL expiry: short TTL + sleep → entry returns nil
- [ ] Overwrite: second `Set` for same key replaces value and TTL
- [ ] `Len()` helper returns correct count
- [ ] Thread-safe: concurrent goroutines with `-race` flag — no races
- [ ] Unit tests pass: `go test -race ./router/pkg/entitycache/...`

---

## 7. Router YAML Config

- [ ] `entity_caching` key parses correctly in router YAML
- [ ] Default values: `enabled=false`, `global_cache_key_prefix=""`, `l1.enabled=true`, `l2.enabled=true`, `l2.storage.key_prefix="cosmo_entity_cache"`, `l2.circuit_breaker.enabled=false`, `l2.circuit_breaker.failure_threshold=5`, `l2.circuit_breaker.cooldown_period=10s`, `analytics.enabled=false`, `analytics.hash_entity_keys=false`
- [ ] Environment variable overrides work for all fields:
  - [ ] `ENTITY_CACHING_ENABLED`
  - [ ] `ENTITY_CACHING_GLOBAL_CACHE_KEY_PREFIX`
  - [ ] `ENTITY_CACHING_L1_ENABLED`
  - [ ] `ENTITY_CACHING_L2_ENABLED`
  - [ ] `ENTITY_CACHING_L2_STORAGE_PROVIDER_ID`
  - [ ] `ENTITY_CACHING_L2_STORAGE_KEY_PREFIX`
  - [ ] `ENTITY_CACHING_L2_CIRCUIT_BREAKER_ENABLED`
  - [ ] `ENTITY_CACHING_L2_CIRCUIT_BREAKER_FAILURE_THRESHOLD`
  - [ ] `ENTITY_CACHING_L2_CIRCUIT_BREAKER_COOLDOWN_PERIOD`
  - [ ] `ENTITY_CACHING_ANALYTICS_ENABLED`
  - [ ] `ENTITY_CACHING_ANALYTICS_HASH_ENTITY_KEYS`
- [ ] `subgraphs` array parses with `name`, `entities[].type`, `entities[].cache_name`
- [ ] `provider_id` correctly references `storage_providers.redis[].id`
- [ ] `cache_name` correctly references `storage_providers.redis[].id`
- [ ] Missing/empty `entity_caching` block — router starts normally with caching disabled
- [ ] Invalid `provider_id` (not in `storage_providers`) — clear error at startup
- [ ] Existing config tests pass: `cd router && go test ./pkg/config/...`

---

## 8. Router Module — EntityCacheKeyInterceptor

- [ ] `EntityCacheKeyInterceptor` interface defined in `router/core/modules.go`
- [ ] Interface signature: `OnEntityCacheKeys(keys [][]byte, ctx RequestContext) [][]byte`
- [ ] Modules implementing the interface are discovered during `initModules()`
- [ ] Multiple modules are called in priority order (lower priority = earlier)
- [ ] Output of one interceptor is input to the next (chaining)
- [ ] Returned slice must have same length as input
- [ ] No interceptor registered — cache keys used as-is (no error)
- [ ] Example TenantCacheIsolation module from spec compiles against the interface

---

## 9. Router Wiring — Cache Instance Building

- [ ] With `entity_caching.enabled: true` + valid `l2.storage.provider_id` → Redis cache instance created
- [ ] Default cache created from `l2.storage.provider_id`
- [ ] Per-subgraph `cache_name` creates additional cache instances from `storage_providers.redis`
- [ ] `cache_name: "default"` uses the default cache (no duplicate instance)
- [ ] Cache instances passed to executor as `map[string]resolve.LoaderCache`
- [ ] Circuit breaker configs passed to executor as `map[string]resolve.CircuitBreakerConfig`
- [ ] Caches wrapped with circuit breakers during `resolve.New()` via `wrapCachesWithCircuitBreakers()`
- [ ] With `entity_caching.enabled: false` → no cache instances created, no Redis connections
- [ ] With `l2.enabled: false` → no L2 cache instances, L1 still works

---

## 10. Runtime — Query Execution (L1 + L2 Flow)

### Basic L2 Cache

- [ ] First query for an entity → L2 miss → subgraph fetch → entity returned → L2 populated
- [ ] Second identical query → L2 hit → no subgraph fetch → cached entity returned
- [ ] Different entity (different key) → separate cache entry → subgraph fetch
- [ ] Entity data returned is identical whether from cache or subgraph (JSON match)

### L1 Cache (Per-Request Deduplication)

- [ ] Single request requiring same entity twice → entity fetched once from subgraph
- [ ] L1 covers entity fetches only (not root fields)
- [ ] L1 is per-request — different requests don't share L1

### TTL

- [ ] Entity expires after `maxAge` seconds → next request is a cache miss
- [ ] Different entities can have different TTLs (per `@entityCache(maxAge)`)

### Cache Key Format

- [ ] Entity key format: `{"__typename":"User","key":{"id":"123"}}`
- [ ] Composite key format: `{"__typename":"OrderItem","key":{"itemId":"42","orderId":"1"}}` (fields sorted alphabetically)
- [ ] Root field key format: `{"__typename":"Query","field":"me"}`
- [ ] Cache keys use ONLY `@key` fields — `@requires` and `@provides` never included
- [ ] Field argument values hashed and appended as suffix when entity fields have arguments

---

## 11. Runtime — `@queryCache` Behavior

### Single Entity Return with Mapped Args

- [ ] `user(id: "123")` with `@queryCache` → cache key uses entity format `{"__typename":"User","key":{"id":"123"}}`
- [ ] Cache shared with `_entities` fetch: `@queryCache` hit also serves subsequent `_entities` fetch for same User
- [ ] `@entityCache` write also serves subsequent `@queryCache` query for same User

### Explicit Mapping with `@is`

- [ ] `userById(userId: "123")` with `@is(field: "id")` → cache key `{"__typename":"User","key":{"id":"123"}}`
- [ ] Shares cache with `user(id: "123")` and `_entities` User fetch

### Composite Key Mapping

- [ ] `orderItem(orderId: "1", itemId: "42")` → cache key `{"__typename":"OrderItem","key":{"itemId":"42","orderId":"1"}}`

### List Return

- [ ] `topProducts(first: 5): [Product!]!` → each Product cached individually with entity key
- [ ] Subsequent `product(upc: "top-1")` is a cache hit (shared via entity key)

### No-Argument Field

- [ ] `me: User` → cache key `{"__typename":"Query","field":"me"}`
- [ ] Uses root field cache key format (no entity key sharing)

---

## 12. Runtime — `@entityCache` Arguments

### `includeHeaders`

- [ ] With `includeHeaders: false` (default) — same entity, different headers → same cache entry
- [ ] With `includeHeaders: true` — same entity, different forwarded headers → different cache entries
- [ ] Header hash is prepended to cache key: `{headerHash}:{"__typename":"User","key":{"id":"123"}}`

### `partialCacheLoad`

- [ ] With `partialCacheLoad: false` (default) — any miss in a batch → ALL entities refetched from subgraph
- [ ] With `partialCacheLoad: true` — only missing entities fetched, cached ones served from cache

### `shadowMode`

- [ ] Fresh data always fetched from subgraph (never served from cache)
- [ ] L2 reads still happen (to measure hit rates)
- [ ] L2 writes still happen (to populate cache for metrics)
- [ ] L1 cache works normally (unaffected by shadow mode)
- [ ] Shadow mode staleness counter incremented when cached data differs from fresh data

---

## 13. Runtime — Mutation Behavior

### Default (no cache directives on mutation)

- [ ] Mutations always skip L2 reads (always fetch fresh data)
- [ ] Mutations skip L2 writes by default

### `@cacheInvalidate`

- [ ] After mutation completes and returns entity data → L2 cache entry deleted
- [ ] Cache key built from `@key` fields in mutation response
- [ ] Subsequent query for same entity is a cache miss → subgraph fetch

### `@cachePopulate`

- [ ] Mutation enables L2 writes for entity fetches during execution
- [ ] L2 reads remain skipped (mutation always fetches fresh)
- [ ] After mutation, freshly fetched entities written to L2
- [ ] Subsequent query for written entity is a cache hit
- [ ] With `maxAge` override — entries written with overridden TTL instead of entity's TTL
- [ ] Without `maxAge` — entries written with entity's `@entityCache(maxAge)` TTL

---

## 14. Runtime — Subscription Behavior

### `@cachePopulate` on Subscription

- [ ] When subscription event arrives with entity data → entity written to L2 cache
- [ ] Uses entity's `@entityCache(maxAge)` TTL (or `@cachePopulate(maxAge)` override)
- [ ] Subsequent query for that entity is a cache hit

### `@cacheInvalidate` on Subscription

- [ ] When subscription event arrives → L2 cache entry deleted
- [ ] Cache key built from `@key` fields in subscription event data
- [ ] Subsequent query for that entity is a cache miss

---

## 15. Runtime — Extension-Based Invalidation

- [ ] Router inspects `extensions.cacheInvalidation.keys` in every subgraph response
- [ ] Each entry `{ "typename": "User", "key": { "id": "1" } }` → corresponding L2 entry deleted
- [ ] Invalidation is **scoped to the responding subgraph** — only that subgraph's cache backend is targeted
- [ ] Full key transformation pipeline applied (key prefix, header hash, interceptor modules)
- [ ] Entity type must have `@entityCache` in the responding subgraph — unknown types skipped
- [ ] `key` object must contain all `@key` fields
- [ ] Works regardless of operation type (query, mutation, subscription)
- [ ] Multiple entities invalidated in single response
- [ ] Malformed `extensions` JSON → logged, request not failed
- [ ] Unknown entity type in extension → entry skipped, others processed
- [ ] Missing key fields → entry skipped, others processed
- [ ] Cache delete failure → logged, request not failed

---

## 16. Runtime — Key Transformation Pipeline

Applied in order for all L2 operations:

- [ ] **Step 1**: Base key (JSON entity or root field key)
- [ ] **Step 2**: Global cache key prefix (when `global_cache_key_prefix` set): `{global}:{baseKey}`
- [ ] **Step 3**: Header hash prefix (when `includeHeaders: true`): `{global}:{headerHash}:{baseKey}`
- [ ] **Step 4**: EntityCacheKeyInterceptor modules (batch transform): `{modulePrefix}:{global}:{headerHash}:{baseKey}`
- [ ] **Step 5**: Redis key prefix (applied by RedisEntityCache internally): `cosmo_entity_cache:{modulePrefix}:{global}:{headerHash}:{baseKey}`
- [ ] Extension-based invalidation applies same pipeline (steps 1-4, step 5 by cache impl)
- [ ] Mutation-triggered invalidation applies same pipeline
- [ ] Subscription cache populate/invalidate applies same pipeline

---

## 17. Runtime — Per-Request Configuration

- [ ] `CachingOptions.EnableL1Cache` set from `entity_caching.l1.enabled` (when `entity_caching.enabled`)
- [ ] `CachingOptions.EnableL2Cache` set from `entity_caching.l2.enabled` (when `entity_caching.enabled`)
- [ ] `CachingOptions.EnableCacheAnalytics` set from `entity_caching.analytics.enabled` (when `entity_caching.enabled`)
- [ ] `CachingOptions.L2CacheKeyInterceptor` wraps registered `EntityCacheKeyInterceptor` modules
- [ ] `CachingOptions.GlobalCacheKeyPrefix` set from `entity_caching.global_cache_key_prefix`
- [ ] With `entity_caching.enabled: false` — all CachingOptions fields false/nil/empty
- [ ] WebSocket/subscription handler sets same CachingOptions as HTTP handler

---

## 18. Runtime — Cross-Subgraph Behavior

- [ ] Same entity type in multiple subgraphs with different `@entityCache` configs → each subgraph's config applies independently
- [ ] Entity data cached per-subgraph with subgraph-specific TTL
- [ ] Entity key format consistent across subgraphs (derived from `@key` fields)
- [ ] Different subgraphs can route to different Redis backends via `cache_name`

---

## 19. Runtime — Per-Subgraph Cache Routing

- [ ] `cache_name: "fast-cache"` routes to the `storage_providers.redis` entry with `id: "fast-cache"`
- [ ] `cache_name: "default"` or no `cache_name` routes to `l2.storage.provider_id` backend
- [ ] Different entity types in same subgraph can use different cache backends
- [ ] Different subgraphs can use different cache backends for same entity type

---

## 20. Observability — Metrics

All metrics gated by `entity_caching.analytics.enabled`:

- [ ] `router.entity_cache.requests.stats` (Counter) — labels: `type` (hits/misses), `cache_level` (l1/l2), `cache_type` (entity/root_field)
- [ ] `router.entity_cache.keys.stats` (Counter) — labels: `operation` (added/updated/evicted), `cache_type`
- [ ] `router.entity_cache.latency` (Histogram) — labels: `cache_level` (l2), `operation` (get/set/delete) — unit: ms
- [ ] `router.entity_cache.invalidations` (Counter) — labels: `source` (mutation/subscription/extension)
- [ ] `router.entity_cache.populations` (Counter) — labels: `source` (mutation/subscription/query)
- [ ] `router.entity_cache.shadow.staleness` (Counter) — labels: `cache_type`
- [ ] `router.entity_cache.operation_errors` (Counter) — labels: `operation` (get/set/set_negative/delete), `cache_name`, `entity_type`
- [ ] Metrics exported via OTLP exporter
- [ ] Metrics exported via Prometheus `/metrics` endpoint
- [ ] With `analytics.enabled: false` — no metrics created or recorded
- [ ] With `analytics.hash_entity_keys: true` — entity keys hashed in log messages and trace attributes
- [ ] Metric cardinality is bounded (no entity key or user data in labels)

---

## 21. Observability — Cache Stats After Execution

- [ ] `ctx.GetCacheStats()` returns snapshot with L1/L2 hit/miss counts
- [ ] `snapshot.L1HitRate()` returns correct float64 [0, 1]
- [ ] `snapshot.L2HitRate()` returns correct float64 [0, 1]
- [ ] `snapshot.CachedBytesServed()` returns correct byte count
- [ ] `snapshot.CacheOpErrors` contains recorded cache operation errors (when analytics enabled)

---

## 22. Thread Safety

- [ ] `RedisEntityCache` safe for concurrent use (go-redis guarantee)
- [ ] `MemoryEntityCache` safe for concurrent use (sync.RWMutex)
- [ ] All cache operations (`Get`, `Set`, `Delete`) callable from multiple goroutines
- [ ] All unit and integration tests pass with `-race` flag
- [ ] `EntityCacheKeyInterceptor` called from per-request goroutine — no shared mutable state
- [ ] L2 cache allocations use per-goroutine arenas (`l2ArenaPool`) — no shared `jsonArena` access in Phase 2 goroutines
- [ ] Per-goroutine arenas released in `Loader.Free()` (not inside goroutine) due to cross-arena `MergeValues` references
- [ ] Circuit breaker state uses atomic operations — no locks needed for state transitions

---

## 23. Backward Compatibility

- [ ] Adding new proto repeated fields is backward-compatible — old routers ignore unknown fields
- [ ] New routers see empty arrays when caching not configured — no errors
- [ ] No `RouterCompatibilityVersionThreshold` bump needed
- [ ] Existing router tests pass without modification
- [ ] Existing composition tests pass without modification
- [ ] Router starts normally without `entity_caching` in YAML config

---

## 24. Negative Caching

- [ ] With `negativeCacheTTL: 10` on entity type, null entity response stored as `"null"` sentinel in L2
- [ ] Subsequent request for same entity returns null from cache without calling subgraph
- [ ] With `negativeCacheTTL: 0` (default), null entity responses are NOT cached — subgraph called every time
- [ ] Negative cache entries use `NegativeCacheTTL` (not regular entity `TTL`) for cache `Set` call
- [ ] Different entity types can have different negative cache TTLs
- [ ] Negative cache sentinel recognized during L2 validation (treated as cache hit, skips re-fetch)
- [ ] Negative cache works with partial cache loading (cached null entities not re-fetched)
- [ ] Negative cache works with batch entity fetches (individual null entities in batch cached separately)
- [ ] `NegativeCacheHit` flag set on `CacheKey` during `mergeResult` when subgraph returns null
- [ ] `cacheKeysToNegativeEntries` only collects entries with `NegativeCacheHit=true`
- [ ] Negative sentinels stored via separate `cache.Set()` call with `NegativeCacheTTL` duration

---

## 25. Global Cache Key Prefix

- [ ] `global_cache_key_prefix` in router YAML config parsed correctly
- [ ] `ENTITY_CACHING_GLOBAL_CACHE_KEY_PREFIX` env var overrides YAML value
- [ ] When set, prefix prepended to all L2 cache keys: `{prefix}:{rest_of_key}`
- [ ] When empty (default), no prefix applied (no extra colon)
- [ ] Global prefix applied before header hash prefix: `{global}:{headerHash}:{jsonKey}`
- [ ] Global prefix applied in `prepareCacheKeys()` for L2 reads/writes
- [ ] Global prefix applied in `buildMutationEntityCacheKey()` for mutation invalidation
- [ ] Global prefix applied in `processExtensionsCacheInvalidation()` for extension-based invalidation
- [ ] Global prefix applied in `handleTriggerEntityCache()` for subscription populate/invalidate
- [ ] Changing the prefix effectively invalidates all old cache entries (different keys, cache misses)
- [ ] Global prefix set on `CachingOptions.GlobalCacheKeyPrefix` per-request from router config

---

## 26. Circuit Breaker

- [ ] `CircuitBreakerConfig` with `Enabled`, `FailureThreshold`, `CooldownPeriod` fields
- [ ] `CacheCircuitBreakers` map on `ResolverOptions` — key matches cache name in `Caches` map
- [ ] Circuit breaker wraps `LoaderCache` as decorator (`circuitBreakerCache`)
- [ ] **Closed state**: All L2 operations (Get/Set/Delete) pass through to underlying cache
- [ ] **Open state**: All L2 operations return nil/no-op (fall back to subgraph fetch)
- [ ] Transition Closed → Open: after `FailureThreshold` consecutive failures
- [ ] **Half-Open state**: After `CooldownPeriod` elapses, one probe request allowed through
- [ ] Transition Half-Open → Closed: probe request succeeds
- [ ] Transition Half-Open → Open: probe request fails
- [ ] `Resolver.CacheCircuitBreakerOpen(cacheName)` returns current breaker state
- [ ] Breaker returns false for unknown cache names or caches without breakers
- [ ] State transitions use atomic operations (goroutine-safe)
- [ ] Default `FailureThreshold`: 5
- [ ] Default `CooldownPeriod`: 10s
- [ ] Entries for missing cache names in `CacheCircuitBreakers` are ignored (no error)

---

## 27. Cache Operation Error Tracking

- [ ] `CacheOperationError` struct with: `Operation`, `CacheName`, `EntityType`, `DataSource`, `Message`, `ItemCount`
- [ ] L2 `Get` errors recorded with operation `"get"`
- [ ] L2 `Set` errors recorded with operation `"set"`
- [ ] L2 `Set` errors for negative sentinels recorded with operation `"set_negative"`
- [ ] L2 `Delete` errors (mutation invalidation) recorded with operation `"delete"`
- [ ] L2 `Delete` errors (extension invalidation) recorded with operation `"delete"`
- [ ] Error messages truncated to 256 characters for safety
- [ ] Errors only recorded when analytics are enabled (`EnableCacheAnalytics = true`)
- [ ] Goroutine-collected errors merged on main thread via `MergeL2CacheOpErrors()`
- [ ] `CacheAnalyticsSnapshot.CacheOpErrors` contains all recorded errors
- [ ] Cache errors remain non-fatal — engine falls back to subgraph fetch on error

---

## 28. Integration Test Scenarios (22)

- [ ] **1. Basic L2 miss-then-hit**: First request → subgraph call; second request → no subgraph call
- [ ] **2. Different entities**: User(1) and User(2) → separate cache entries, separate subgraph calls
- [ ] **3. L1 deduplication**: Single request fetches same entity twice → subgraph called once
- [ ] **4. Mutation invalidation**: Query (cached) → mutate → query again (cache miss, subgraph called)
- [ ] **5. Mutation population**: Mutate with `@cachePopulate` → subsequent query is cache hit
- [ ] **6. Mutual exclusivity**: Composition rejects `@cacheInvalidate` + `@cachePopulate` on same field
- [ ] **7. Multi-subgraph cache**: User from accounts and Product from products cached independently
- [ ] **8. Root field caching**: `@queryCache` result cached with entity key sharing
- [ ] **9. `@is` argument mapping**: `userById(userId)` with `@is(field: "id")` shares cache with User entity
- [ ] **10. List return caching**: `topProducts` caches each Product individually; `product(upc)` is cache hit
- [ ] **11. Extension-based invalidation**: Subgraph sends `cacheInvalidation` extension → cache cleared
- [ ] **12. Subscription invalidation**: `productDeleted` event → cache entry deleted
- [ ] **13. Subscription population**: `productPriceChanged` event → cache populated
- [ ] **14. TTL expiry**: Short TTL + wait → cache miss
- [ ] **15. Shadow mode**: Fresh data always served, cache reads/writes happen, subgraph always called
- [ ] **16. Analytics**: Cache hit/miss metrics collected when analytics enabled
- [ ] **17. No-argument query cache**: `me` uses root field cache key format
- [ ] **18. Per-subgraph cache name**: Different entities route to different cache instances
- [ ] **19. Negative caching**: Null entity response cached as sentinel → subsequent request returns null from cache, no subgraph call
- [ ] **20. Global cache key prefix**: Cache keys include global prefix; changing prefix → all old entries missed
- [ ] **21. Circuit breaker**: Redis fails repeatedly → L2 ops skip, subgraph fallback; after cooldown → probe succeeds, breaker closes
- [ ] **22. Cache operation errors**: Get/Set/Delete failures recorded in `CacheAnalyticsSnapshot.CacheOpErrors` when analytics enabled

---

## 29. Build & Test Gates

- [ ] `buf lint` — no errors
- [ ] `make generate-go` — succeeds
- [ ] `pnpm generate` — succeeds
- [ ] `cd router && go build ./...` — compiles
- [ ] `cd router && go test -race ./...` — all pass
- [ ] `cd router && go test -race ./pkg/entitycache/...` — cache backend tests pass
- [ ] `cd composition && npx tsc --noEmit` — no type errors
- [ ] `cd composition && npm test` — all pass
- [ ] `cd router-tests && go test -race ./...` — integration tests pass
- [ ] No new dependencies added (go-redis v9 and graphql-go-tools already in go.mod)
