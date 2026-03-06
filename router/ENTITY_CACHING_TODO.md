# Entity Caching Integration TODO

This document describes how to integrate the entity caching system from graphql-go-tools (PRs [#1259](https://github.com/wundergraph/graphql-go-tools/pull/1259), [#1435](https://github.com/wundergraph/graphql-go-tools/pull/1435)) into the cosmo router and composition pipeline.

**Related documents:**
- [ENTITY_CACHING_DIRECTIVES.md](./ENTITY_CACHING_DIRECTIVES.md) — Directive definitions, validation rules, composition behavior
- [ENTITY_CACHING_CONFIGURATION.md](./ENTITY_CACHING_CONFIGURATION.md) — Router YAML config, analytics, custom modules, extension-based invalidation

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Complete Capability Reference](#2-complete-capability-reference)
3. [Directive Design Summary](#3-directive-design-summary)
4. [Proto Schema Changes](#4-proto-schema-changes)
5. [Composition Integration](#5-composition-integration)
6. [Router Integration](#6-router-integration)
7. [Cache Backend Implementation](#7-cache-backend-implementation)
8. [Router Test Plan](#8-router-test-plan)
9. [Implementation Phases](#9-implementation-phases)

---

## 1. System Overview

### Two-Level Cache Architecture

| Level | Storage | Scope | Applies To | Default |
|-------|---------|-------|-----------|---------|
| **L1** | In-memory `sync.Map` per request | Single request | Entity fetches only | Disabled |
| **L2** | External cache (Redis) via `LoaderCache` interface | Cross-request with TTL | Entity + root field fetches | Disabled |

Both levels are opt-in. L1 prevents redundant fetches for the same entity within a single request. L2 shares entity data across requests with configurable TTL.

**Key principle**: Cache keys use ONLY `@key` fields for stable entity identity. `@requires` and `@provides` fields are never included in cache keys, ensuring consistent cache identity regardless of fetch context.

### Cache Key Format

**Entity keys** (from `@key` fields):
```json
{"__typename":"User","key":{"id":"123"}}
{"__typename":"Product","key":{"upc":"top-1"}}
{"__typename":"Order","key":{"id":"1","orgId":"acme"}}
```

**Root field keys** (from field name + arguments, used only for no-argument queries like `me`):
```json
{"__typename":"Query","field":"me"}
```

Arguments are sorted alphabetically for stable key generation.

### Key Transformation Pipeline (applied in order)

1. **Base key** — JSON entity or root field key (as above)
2. **Global cache key prefix** (when `global_cache_key_prefix` is set in router YAML):
   ```
   v1:{"__typename":"User","key":{"id":"123"}}
   ```
3. **Subgraph header hash prefix** (when `includeHeaders: true` on directive):
   ```
   v1:{headerHash}:{"__typename":"User","key":{"id":"123"}}
   ```
4. **EntityCacheKeyInterceptor custom module** (batch transform, e.g., for tenant isolation):
   ```
   tenant-X:v1:{headerHash}:{"__typename":"User","key":{"id":"123"}}
   ```

The global prefix is the outermost prefix (applied first). When both global prefix and header hash are active: `{global}:{headerHash}:{jsonKey}`. When only global prefix: `{global}:{jsonKey}`. The global prefix is applied consistently across all cache operations: L2 reads, L2 writes, extension-based invalidation, mutation invalidation, and subscription populate/invalidate.

When entity fields have arguments (e.g., `greeting(style: "formal")`), field argument values are hashed via xxhash and appended as a suffix. Different argument values produce different cache entries.

### Execution Flow by Operation Type

**Queries (standard L1+L2 flow):**
```
L1 check (main thread, entity fetches only)
  ↓ miss
L2 check (goroutine, entity + root fetches)
  ↓ miss
Subgraph fetch (goroutine)
  ↓ response
Populate L1 + L2 (main thread for L1, goroutine for L2)
```

L1 is checked first on the main thread. Complete L1 hit skips the goroutine entirely.

**Mutations:**
- Always skip L2 reads (always fetch fresh)
- Skip L2 writes by default
- With `@cachePopulate`: entity fetches during this mutation write to L2
- With `@cacheInvalidate`: L2 entry deleted after mutation completes

**Subscriptions:**
- With `@cachePopulate`: write entity data from each event to L2
- With `@cacheInvalidate`: delete L2 entry when event arrives

### Thread Safety

`LoaderCache.Get`, `Set`, and `Delete` may be called from multiple goroutines during parallel fetch execution. The implementation must be safe for concurrent use.

**Per-goroutine arenas**: L2 cache allocations during Phase 2 parallel execution use per-goroutine arenas (`l2ArenaPool`) instead of the shared `jsonArena` to avoid data races. Each goroutine acquires an arena from a `sync.Pool`, uses it for all L2 cache parsing and denormalization (e.g., `populateFromCache`, `denormalizeFromCache`), and returns it in `Loader.Free()`. Arenas are released together with the main `jsonArena` because `MergeValues` creates cross-arena references from the response tree into goroutine arenas.

---

## 2. Complete Capability Reference

This section documents the graphql-go-tools engine capabilities that the directives and configuration must cover.

### 2.1 Entity Cache Configuration

Controls L2 caching for entity types resolved via `_entities` queries.

| Field | Type | Default | Directive |
|-------|------|---------|-----------|
| `TypeName` | string | required | Inferred from type with `@entityCache` |
| `CacheName` | string | required | Router YAML per-subgraph config |
| `TTL` | duration | required | `@entityCache(maxAge)` |
| `IncludeSubgraphHeaderPrefix` | bool | false | `@entityCache(includeHeaders)` |
| `EnablePartialCacheLoad` | bool | false | `@entityCache(partialCacheLoad)` |
| `HashAnalyticsKeys` | bool | false | Router YAML `analytics.hash_entity_keys` |
| `ShadowMode` | bool | false | `@entityCache(shadowMode)` |
| `NegativeCacheTTL` | duration | 0 | `@entityCache(negativeCacheTTL)` |

### 2.2 Root Field Cache Configuration

Controls L2 caching for root query fields (e.g., `Query.topProducts`).

| Field | Type | Default | Directive |
|-------|------|---------|-----------|
| `TypeName` | string | "Query" | Inferred (always Query) |
| `FieldName` | string | required | Inferred from field with `@queryCache` |
| `CacheName` | string | required | Router YAML per-subgraph config |
| `TTL` | duration | required | `@queryCache(maxAge)` |
| `IncludeSubgraphHeaderPrefix` | bool | false | `@queryCache(includeHeaders)` |
| `ShadowMode` | bool | false | `@queryCache(shadowMode)` |
| `EntityKeyMappings` | list | empty | Auto-derived from argument names + `@is` directives |

**Entity key mapping**: When a `@queryCache` field returns a single entity and all `@key` fields can be mapped to arguments (by name match or `@is`), the cache key uses entity format for sharing. For list returns, each entity gets its own entity cache entry. For no-argument fields, root field format is used.

### 2.3 Mutation Field Cache Population

Controls whether entity fetches triggered by a mutation populate L2.

| Field | Type | Default | Directive |
|-------|------|---------|-----------|
| `FieldName` | string | required | Inferred from field with `@cachePopulate` |
| `EnableEntityL2CachePopulation` | bool | false | Presence of `@cachePopulate` sets to true |

### 2.4 Mutation Cache Invalidation

Configures automatic L2 cache deletion after a mutation completes.

| Field | Type | Default | Directive |
|-------|------|---------|-----------|
| `FieldName` | string | required | Inferred from field with `@cacheInvalidate` |
| `EntityTypeName` | string | — | Inferred from mutation return type (must be entity) |

### 2.5 Subscription Cache Population / Invalidation

Controls how subscription events interact with the L2 cache.

| Field | Type | Default | Directive |
|-------|------|---------|-----------|
| `TypeName` | string | required | Inferred from return type |
| `CacheName` | string | required | Router YAML per-subgraph config |
| `TTL` | duration | required | `@cachePopulate(maxAge)` or `@entityCache(maxAge)` |
| `IncludeSubgraphHeaderPrefix` | bool | false | From entity's `@entityCache(includeHeaders)` |
| Mode | — | — | `@cachePopulate` = populate, `@cacheInvalidate` = invalidate |

### 2.6 Per-Request Runtime Configuration

Set on the resolve context per request:

| Field | Type | Default | Source |
|-------|------|---------|--------|
| `EnableL1Cache` | bool | false | Router YAML `entity_caching.l1.enabled` |
| `EnableL2Cache` | bool | false | Router YAML `entity_caching.l2.enabled` |
| `EnableCacheAnalytics` | bool | false | Router YAML `entity_caching.analytics.enabled` |
| `L2CacheKeyInterceptor` | function | nil | `EntityCacheKeyInterceptor` custom module |
| `GlobalCacheKeyPrefix` | string | "" | Router YAML `entity_caching.global_cache_key_prefix` |

### 2.7 Resolver-Level Configuration

Set once on the resolver:

| Field | Type | Source |
|-------|------|--------|
| `Caches` | `map[string]LoaderCache` | Built from `storage_providers.redis` entries referenced by `cache_name` |
| `CacheCircuitBreakers` | `map[string]CircuitBreakerConfig` | Per-cache circuit breaker configs. When a breaker trips, L2 ops for that cache are skipped. |
| `EntityCacheConfigs` | `map[subgraph]map[entity]*Config` | For extension-based invalidation |

### 2.8 Cache Invalidation Mechanisms

**Directive-based (`@cacheInvalidate`)**: On mutation or subscription fields. After the operation returns entity data with `@key` fields, the L2 entry is deleted.

**Extension-based (subgraph-signaled)**: Subgraphs send invalidation hints in response extensions. See [ENTITY_CACHING_CONFIGURATION.md — Subgraph Extension-Based Invalidation](./ENTITY_CACHING_CONFIGURATION.md#subgraph-extension-based-invalidation).

**Manual**: Call `LoaderCache.Delete()` directly with full cache keys.

### 2.9 Shadow Mode

Test caching in production without serving cached data:
- L2 reads/writes happen normally
- Cached data is never served to clients
- Fresh data is always fetched and compared against cache for staleness detection
- L1 cache works normally (unaffected by shadow mode)
- Configured per entity type or root field via `shadowMode: true` on directives

### 2.10 Cache Analytics

When analytics are enabled (router YAML `analytics.enabled`), metrics are reported via OTLP and Prometheus. See [ENTITY_CACHING_CONFIGURATION.md — Analytics](./ENTITY_CACHING_CONFIGURATION.md#analytics) for the full metrics reference.

### 2.11 Negative Caching

Cache null entity responses (entity not found) to avoid repeated subgraph lookups:
- When a subgraph returns `null` for an entity in `_entities` (without errors), and `NegativeCacheTTL > 0`, the null result is stored in L2 as a sentinel value (`"null"` bytes)
- On subsequent requests, the sentinel is recognized as a negative cache hit and served without calling the subgraph
- Disabled by default (`NegativeCacheTTL = 0`)
- Uses a separate TTL from the regular entity `TTL`, typically shorter (e.g., 5-10s vs 60s)
- Per-entity-type configuration via `@entityCache(negativeCacheTTL: 10)`

### 2.12 Global Cache Key Prefix

Support schema versioning by prepending a configurable prefix to all L2 cache keys:
- Set via router YAML `entity_caching.global_cache_key_prefix` or env `ENTITY_CACHING_GLOBAL_CACHE_KEY_PREFIX`
- Applied as the outermost prefix, before header hash prefix: `{global}:{headerHash}:{jsonKey}`
- When the schema changes, a new prefix automatically invalidates all old cache entries without explicit cache flushing
- Applied consistently across all cache operations: L2 reads/writes, extension-based invalidation, mutation invalidation, subscription populate/invalidate

### 2.13 Circuit Breaker

Protect L2 cache operations from cascading latency when the cache backend is unavailable:
- Configured per named cache instance via `ResolverOptions.CacheCircuitBreakers`
- Three states: Closed (normal), Open (all L2 ops skipped), Half-Open (probe request)
- When open, the engine falls back to direct subgraph fetches
- `Resolver.CacheCircuitBreakerOpen(cacheName)` method for external status checking
- All state transitions use atomic operations for goroutine safety

### 2.14 Cache Operation Error Tracking

Record Get/Set/Delete failures in analytics for operator observability:
- Cache errors are non-fatal (engine falls back to subgraph fetch)
- `CacheOperationError` struct records: operation, cache name, entity type, data source, error message, item count
- Errors collected per-goroutine during Phase 2, merged on main thread
- Included in `CacheAnalyticsSnapshot.CacheOpErrors`

### 2.15 LoaderCache Interface

```go
type LoaderCache interface {
    Get(ctx context.Context, keys []string) ([]*CacheEntry, error)
    Set(ctx context.Context, entries []*CacheEntry, ttl time.Duration) error
    Delete(ctx context.Context, keys []string) error
}

type CacheEntry struct {
    Key          string
    Value        []byte        // JSON-encoded entity data
    RemainingTTL time.Duration // 0 = unknown/not supported
}
```

All methods are batch-oriented. `Get` uses Redis `MGET`, `Set` uses pipelined `SET`, `Delete` uses pipelined `DEL`.

---

## 3. Directive Design Summary

The directive design is finalized in [ENTITY_CACHING_DIRECTIVES.md](./ENTITY_CACHING_DIRECTIVES.md). Summary:

| Directive | Location | Purpose |
|-----------|----------|---------|
| `@entityCache(maxAge, negativeCacheTTL, includeHeaders, partialCacheLoad, shadowMode)` | OBJECT | Cache entity type via `_entities` |
| `@queryCache(maxAge, includeHeaders, shadowMode)` | FIELD_DEFINITION | Cache root Query field (entity return required) |
| `@is(field)` | ARGUMENT_DEFINITION | Map argument to entity `@key` field |
| `@cacheInvalidate` | FIELD_DEFINITION | Delete L2 cache on mutation/subscription |
| `@cachePopulate(maxAge)` | FIELD_DEFINITION | Write to L2 cache on mutation/subscription |

**Key design decisions:**
- `cacheName` is an operator concern — lives in router YAML, not directives
- `@cacheInvalidate` and `@cachePopulate` are mutually exclusive on the same field
- Both work on `Mutation` and `Subscription` root fields (no separate subscription directive)
- `@queryCache` requires the return type to be an entity (or list of entities) with `@entityCache`
- Argument-to-key mapping is automatic for matching names; `@is` handles mismatches
- List returns map to a list of entity keys (one per entity in the result)
- 20 validation rules enforced at composition time (see ENTITY_CACHING_DIRECTIVES.md)

---

## 4. Proto Schema Changes

**File**: `proto/wg/cosmo/node/v1/node.proto`

```protobuf
// Entity type caching configuration (from @entityCache directive)
message EntityCacheConfiguration {
  string type_name = 1;                   // Entity type name
  int64 max_age_seconds = 2;              // TTL in seconds
  bool include_headers = 3;               // Include forwarded headers in cache key
  bool partial_cache_load = 4;            // Only fetch missing entities in batch
  bool shadow_mode = 5;                   // Test caching without serving cached data
  int64 negative_cache_ttl_seconds = 6;   // TTL for null entity results (0 = disabled)
}

// Root field caching configuration (from @queryCache directive)
message RootFieldCacheConfiguration {
  string field_name = 1;                  // Query field name
  int64 max_age_seconds = 2;             // TTL in seconds
  bool include_headers = 3;               // Include forwarded headers in cache key
  bool shadow_mode = 4;                   // Test caching without serving cached data
  string entity_type_name = 5;            // Return entity type (for cache key format)
  repeated ArgumentKeyMapping argument_key_mappings = 6;  // Argument → @key field mappings
}

message ArgumentKeyMapping {
  string argument_name = 1;               // Field argument name
  string entity_key_field = 2;            // Entity @key field name
}

// Mutation/subscription cache population (from @cachePopulate directive)
message CachePopulateConfiguration {
  string field_name = 1;                  // Mutation/subscription field name
  string operation_type = 2;              // "Mutation" or "Subscription"
  optional int64 max_age_seconds = 3;     // Override TTL (nil = use entity's TTL)
}

// Mutation/subscription cache invalidation (from @cacheInvalidate directive)
message CacheInvalidateConfiguration {
  string field_name = 1;                  // Mutation/subscription field name
  string operation_type = 2;              // "Mutation" or "Subscription"
  string entity_type_name = 3;            // Entity type to invalidate (inferred from return type)
}
```

Add to `DataSourceConfiguration`:
```protobuf
message DataSourceConfiguration {
  // ... existing fields 1-15 ...
  repeated EntityCacheConfiguration entity_cache_configurations = 16;
  repeated RootFieldCacheConfiguration root_field_cache_configurations = 17;
  repeated CachePopulateConfiguration cache_populate_configurations = 18;
  repeated CacheInvalidateConfiguration cache_invalidate_configurations = 19;
}
```

After updating the proto, regenerate Go code.

---

## 5. Composition Integration

### Approach

Follow the `@authenticated` / `@requiresScopes` directive pattern already established in the composition package.

### Directives to Register

| Directive | Constants | AST Definition | Validation |
|-----------|-----------|----------------|------------|
| `@entityCache` | `ENTITY_CACHE` | 4 args, on OBJECT | Must have `@key`, not repeatable, maxAge > 0 |
| `@queryCache` | `QUERY_CACHE` | 3 args, on FIELD_DEFINITION | Only on Query fields, return must be entity with `@entityCache` |
| `@is` | `IS` | 1 arg, on ARGUMENT_DEFINITION | Only on args of `@queryCache` fields, field must reference valid `@key` field |
| `@cacheInvalidate` | `CACHE_INVALIDATE` | 0 args, on FIELD_DEFINITION | Only on Mutation/Subscription, return must be entity, mutually exclusive with `@cachePopulate` |
| `@cachePopulate` | `CACHE_POPULATE` | 1 optional arg, on FIELD_DEFINITION | Only on Mutation/Subscription, return must be entity, mutually exclusive with `@cacheInvalidate` |

### Files to Modify

| File | Change |
|------|--------|
| `composition/src/utils/string-constants.ts` | Add directive name constants for all 5 directives |
| `composition/src/v1/constants/directive-definitions.ts` | Add directive AST definition nodes |
| `composition/src/v1/normalization/directive-definition-data.ts` | Add directive metadata |
| `composition/src/v1/constants/constants.ts` | Register in `DIRECTIVE_DEFINITION_BY_NAME` and `V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME` |
| `composition/src/v1/normalization/utils.ts` | Register in `initializeDirectiveDefinitionDatas()` |
| `composition/src/v1/normalization/normalization-factory.ts` | Add directive handlers to extract config values, argument-to-key auto-mapping, `@is` resolution |
| `composition/src/router-configuration/types.ts` | Add cache config types to router config output |
| `composition/src/v1/utils/utils.ts` | Serialize cache config into datasource configurations |

### Processing Flow

1. **Normalization**: During subgraph schema normalization, the directive handlers extract caching parameters from annotated types/fields
2. **Argument mapping**: For `@queryCache` fields, the handler auto-maps argument names to `@key` fields, applies `@is` overrides, and produces `ArgumentKeyMapping` entries
3. **Validation**: All 20 validation rules from ENTITY_CACHING_DIRECTIVES.md are checked
4. **Output**: Extracted cache configurations serialized into `DataSourceConfiguration` entries in the router execution config JSON
5. **Stripped**: Caching directives do not appear in the final federated/client schema

### Composition-Go

The Go wrapper (`composition-go/`) calls the JS composition and deserializes the JSON output using the proto definitions. No changes needed in the Go wrapper itself — the proto changes handle deserialization.

### Composition Output

After composition, each `DataSourceConfiguration` in the JSON output includes cache config arrays matching the proto structure. Example:

```json
{
  "datasource_configurations": [{
    "id": "subgraph-accounts",
    "kind": "GRAPHQL",
    "entity_cache_configurations": [
      {"type_name": "User", "max_age_seconds": 300, "include_headers": false, "negative_cache_ttl_seconds": 0}
    ],
    "root_field_cache_configurations": [
      {
        "field_name": "user",
        "max_age_seconds": 300,
        "entity_type_name": "User",
        "argument_key_mappings": [
          {"argument_name": "id", "entity_key_field": "id"}
        ]
      },
      {
        "field_name": "me",
        "max_age_seconds": 60,
        "include_headers": true,
        "entity_type_name": "User"
      }
    ],
    "cache_invalidate_configurations": [
      {"field_name": "updateUser", "operation_type": "Mutation", "entity_type_name": "User"}
    ]
  }]
}
```

---

## 6. Router Integration

### 6.1 Router YAML Config

**File**: `router/pkg/config/config.go`

Full configuration defined in [ENTITY_CACHING_CONFIGURATION.md](./ENTITY_CACHING_CONFIGURATION.md). Go struct:

```go
type EntityCachingConfiguration struct {
    Enabled              bool                             `yaml:"enabled" envDefault:"false" env:"ENTITY_CACHING_ENABLED"`
    GlobalCacheKeyPrefix string                           `yaml:"global_cache_key_prefix,omitempty" env:"ENTITY_CACHING_GLOBAL_CACHE_KEY_PREFIX"`
    L1                   EntityCachingL1Configuration     `yaml:"l1"`
    L2                   EntityCachingL2Configuration     `yaml:"l2"`
    Analytics            EntityCachingAnalyticsConfig     `yaml:"analytics"`
    Subgraphs            []EntityCachingSubgraphConfig    `yaml:"subgraphs,omitempty"`
}

type EntityCachingL1Configuration struct {
    Enabled bool `yaml:"enabled" envDefault:"true" env:"ENTITY_CACHING_L1_ENABLED"`
}

type EntityCachingL2Configuration struct {
    Enabled        bool                              `yaml:"enabled" envDefault:"true" env:"ENTITY_CACHING_L2_ENABLED"`
    Storage        EntityCachingL2StorageConfig      `yaml:"storage"`
    CircuitBreaker EntityCachingCircuitBreakerConfig `yaml:"circuit_breaker"`
}

type EntityCachingCircuitBreakerConfig struct {
    Enabled          bool          `yaml:"enabled" envDefault:"false" env:"ENTITY_CACHING_L2_CIRCUIT_BREAKER_ENABLED"`
    FailureThreshold int           `yaml:"failure_threshold" envDefault:"5" env:"ENTITY_CACHING_L2_CIRCUIT_BREAKER_FAILURE_THRESHOLD"`
    CooldownPeriod   time.Duration `yaml:"cooldown_period" envDefault:"10s" env:"ENTITY_CACHING_L2_CIRCUIT_BREAKER_COOLDOWN_PERIOD"`
}

type EntityCachingL2StorageConfig struct {
    ProviderID string `yaml:"provider_id,omitempty" env:"ENTITY_CACHING_L2_STORAGE_PROVIDER_ID"`
    KeyPrefix  string `yaml:"key_prefix,omitempty" envDefault:"cosmo_entity_cache" env:"ENTITY_CACHING_L2_STORAGE_KEY_PREFIX"`
}

type EntityCachingAnalyticsConfig struct {
    Enabled         bool `yaml:"enabled" envDefault:"false" env:"ENTITY_CACHING_ANALYTICS_ENABLED"`
    HashEntityKeys  bool `yaml:"hash_entity_keys" envDefault:"false" env:"ENTITY_CACHING_ANALYTICS_HASH_ENTITY_KEYS"`
}

type EntityCachingSubgraphConfig struct {
    Name     string                           `yaml:"name"`
    Entities []EntityCachingEntityConfig       `yaml:"entities,omitempty"`
}

type EntityCachingEntityConfig struct {
    Type      string `yaml:"type"`
    CacheName string `yaml:"cache_name,omitempty" envDefault:"default"`
}
```

Add to main `Config` struct:
```go
EntityCaching EntityCachingConfiguration `yaml:"entity_caching,omitempty"`
```

Storage references a named `storage_providers.redis` entry by `provider_id`, following the pattern used by `persisted_operations.storage`.

### 6.2 Router Initialization

**File**: `router/core/router.go`

Initialize Redis client(s) for entity caching. Look up `storage_providers.redis` by `provider_id`:

```go
if r.entityCaching != nil && r.entityCaching.Enabled && r.entityCaching.L2.Enabled {
    // Build map[cacheName]LoaderCache from storage providers
    // Default cache uses l2.storage.provider_id
    // Per-subgraph overrides use subgraphs[].entities[].cache_name
    cacheInstances := buildCacheInstances(r.storageProviders.Redis, r.entityCaching)
}
```

Uses existing `router/internal/rediscloser/rediscloser.go` infrastructure for Redis client management.

### 6.3 Custom Module — EntityCacheKeyInterceptor

**File**: `router/core/modules.go`

Add the new module interface (see [ENTITY_CACHING_CONFIGURATION.md — Custom Module](./ENTITY_CACHING_CONFIGURATION.md#custom-module-entity-cache-key-interceptor)):

```go
type EntityCacheKeyInterceptor interface {
    OnEntityCacheKeys(keys [][]byte, ctx RequestContext) [][]byte
}
```

Collected during `router.initModules()` like all other handler interfaces. Batch-oriented to match the `LoaderCache` interface.

### 6.4 Factory Resolver — Build SubgraphCachingConfigs

**File**: `router/core/factoryresolver.go`

In `Loader.Load()` (line 303), read cache config from each `DataSourceConfiguration` and build `SubgraphCachingConfig` structures:

```go
func (l *Loader) buildSubgraphCachingConfigs(
    engineConfig *nodev1.EngineConfiguration,
    subgraphs []*nodev1.Subgraph,
    entityCachingCfg *config.EntityCachingConfiguration,
) []engine.SubgraphCachingConfig {
    var configs []engine.SubgraphCachingConfig
    for _, ds := range engineConfig.DatasourceConfigurations {
        if len(ds.EntityCacheConfigurations) == 0 &&
           len(ds.RootFieldCacheConfigurations) == 0 {
            continue
        }
        subgraphName := l.subgraphName(subgraphs, ds.Id)
        cfg := engine.SubgraphCachingConfig{
            SubgraphName: subgraphName,
        }
        for _, ec := range ds.EntityCacheConfigurations {
            // Resolve cache_name from router YAML per-subgraph config
            cacheName := l.resolveEntityCacheName(entityCachingCfg, subgraphName, ec.TypeName)
            cfg.EntityCaching = append(cfg.EntityCaching, plan.EntityCacheConfiguration{
                TypeName:                    ec.TypeName,
                CacheName:                   cacheName,
                TTL:                         time.Duration(ec.MaxAgeSeconds) * time.Second,
                IncludeSubgraphHeaderPrefix: ec.IncludeHeaders,
                EnablePartialCacheLoad:      ec.PartialCacheLoad,
                ShadowMode:                  ec.ShadowMode,
                HashAnalyticsKeys:           entityCachingCfg.Analytics.HashEntityKeys,
                NegativeCacheTTL:            time.Duration(ec.NegativeCacheTtlSeconds) * time.Second,
            })
        }
        // Similarly for RootFieldCaching, CachePopulate, CacheInvalidate
        configs = append(configs, cfg)
    }
    return configs
}

func (l *Loader) resolveEntityCacheName(
    cfg *config.EntityCachingConfiguration, subgraphName, typeName string,
) string {
    for _, sg := range cfg.Subgraphs {
        if sg.Name == subgraphName {
            for _, e := range sg.Entities {
                if e.Type == typeName {
                    return e.CacheName
                }
            }
        }
    }
    return "default"
}
```

### 6.5 Executor — Wire Caches into Resolver

**File**: `router/core/executor.go`

In `Build()` (line 73), add caching options to `ResolverOptions`:

```go
options := resolve.ResolverOptions{
    // ... existing options ...
    Caches:               cacheInstances,      // map[string]resolve.LoaderCache
    CacheCircuitBreakers: circuitBreakerCfgs,  // map[string]resolve.CircuitBreakerConfig
    EntityCacheConfigs:   entityConfigs,        // for extension-based invalidation
}
```

The `ExecutorBuildOptions` struct needs new fields for cache instances and entity cache configs.

### 6.6 GraphQL Handler — Set Per-Request CachingOptions

**File**: `router/core/graphql_handler.go`

After creating the resolve context (line 146), set caching options:

```go
resolveCtx.ExecutionOptions.Caching = resolve.CachingOptions{
    EnableL1Cache:         h.entityCachingL1Enabled,
    EnableL2Cache:         h.entityCachingL2Enabled,
    EnableCacheAnalytics:  h.entityCachingAnalyticsEnabled,
    L2CacheKeyInterceptor: h.buildCacheKeyInterceptor(resolveCtx),
    GlobalCacheKeyPrefix:  h.entityCachingGlobalKeyPrefix,
}
```

The `buildCacheKeyInterceptor` wraps the `EntityCacheKeyInterceptor` custom module(s) into the function signature expected by the resolve context.

### 6.7 Graph Server — Pass Config Through

**File**: `router/core/graph_server.go`

Pass entity caching configuration and cache instances from the router to the graph server, then to the GraphQL handler and executor builder.

### 6.8 Observability Integration

Entity cache metrics are registered alongside existing `router.graphql.cache.*` metrics (see [ENTITY_CACHING_CONFIGURATION.md — Analytics](./ENTITY_CACHING_CONFIGURATION.md#analytics) for the full metrics list):

- `router.entity_cache.requests.stats` — L1/L2 hit/miss counters
- `router.entity_cache.keys.stats` — Key lifecycle (added/updated/evicted)
- `router.entity_cache.latency` — L2 operation latency histogram
- `router.entity_cache.invalidations` — Invalidation counts by source
- `router.entity_cache.populations` — Population counts by source
- `router.entity_cache.shadow.staleness` — Shadow mode staleness counter
- `router.entity_cache.operation_errors` — Cache operation error counts (get/set/delete failures)

Integration points:
- Register metrics in `graph_server.go` `configureCacheMetrics()` (line 714)
- Collect per-request stats from resolve context after execution
- Report via existing OTLP and Prometheus exporters

---

## 7. Cache Backend Implementation

### Redis LoaderCache

**New file**: `router/pkg/entitycache/redis.go`

Implement `resolve.LoaderCache` backed by Redis:

```go
type RedisEntityCache struct {
    client    redis.UniversalClient
    keyPrefix string
}

func NewRedisEntityCache(client redis.UniversalClient, keyPrefix string) *RedisEntityCache

func (c *RedisEntityCache) Get(ctx context.Context, keys []string) ([]*resolve.CacheEntry, error) {
    // Use MGET for batch retrieval
    // Prepend keyPrefix to each key
    // Return nil entries for misses
    // Include RemainingTTL from Redis TTL command if available
}

func (c *RedisEntityCache) Set(ctx context.Context, entries []*resolve.CacheEntry, ttl time.Duration) error {
    // Use pipeline SET with TTL for batch writes
    // Prepend keyPrefix to each key
}

func (c *RedisEntityCache) Delete(ctx context.Context, keys []string) error {
    // Use pipeline DEL for batch deletes
    // Prepend keyPrefix to each key
}
```

**Implementation notes:**
- Uses `github.com/redis/go-redis/v9` (already a dependency via rate limiter)
- MGET returns values in order, nil for misses
- Pipeline SET with EXPIREAT for TTL
- Pipeline DEL for batch invalidation
- Thread-safe: go-redis client is safe for concurrent use
- Key prefix prevents collision with other Redis data

### In-Memory LoaderCache (for tests)

**New file**: `router/pkg/entitycache/memory.go`

Simple in-memory implementation for integration tests (no Redis dependency):

```go
type MemoryEntityCache struct {
    mu      sync.RWMutex
    entries map[string]*cacheEntry
}

type cacheEntry struct {
    value     []byte
    expiresAt time.Time
}
```

---

## 8. Router Test Plan

### Directory Structure

```
router-tests/
├── entity_caching/
│   ├── entity_caching_test.go           # Main integration tests
│   ├── subgraphs/
│   │   ├── accounts/
│   │   │   └── subgraph/
│   │   │       ├── schema.graphqls
│   │   │       ├── schema.resolvers.go
│   │   │       ├── entity.resolvers.go
│   │   │       └── handler.go
│   │   └── products/
│   │       └── subgraph/
│   │           ├── schema.graphqls
│   │           ├── schema.resolvers.go
│   │           ├── entity.resolvers.go
│   │           └── handler.go
│   ├── graph.yaml                       # Composition manifest
│   ├── config.json                      # Pre-composed router execution config
│   └── testenv.go                       # Test environment helpers
```

### Test Subgraph Schemas

**accounts/schema.graphqls:**
```graphql
type User @key(fields: "id") @entityCache(maxAge: 300) {
  id: ID!
  name: String!
  email: String!
}

type Query {
  user(id: ID!): User @queryCache(maxAge: 300)
  me: User @queryCache(maxAge: 60, includeHeaders: true)
}

type Mutation {
  updateUser(id: ID!, name: String!): User @cacheInvalidate
  deleteUser(id: ID!): User @cacheInvalidate
}
```

**products/schema.graphqls:**
```graphql
type Product @key(fields: "upc") @entityCache(maxAge: 600, negativeCacheTTL: 10, partialCacheLoad: true) {
  upc: String!
  name: String!
  price: Float!
}

type Review @key(fields: "id") @entityCache(maxAge: 120) {
  id: ID!
  body: String!
  product: Product!
  author: User!
  stars: Int!
}

type Query {
  topProducts(first: Int = 5): [Product!]! @queryCache(maxAge: 30)
  product(upc: String!): Product @queryCache(maxAge: 600)
}

type Mutation {
  addReview(productUpc: String!, body: String!, stars: Int!): Review @cachePopulate
  updateProduct(upc: String!, price: Float!): Product @cacheInvalidate
}

type Subscription {
  productPriceChanged: Product @cachePopulate
  productDeleted: Product @cacheInvalidate
}
```

### Test Scenarios

1. **Basic L2 miss-then-hit**: First request fetches from subgraph (miss), second request serves from cache (hit)
2. **Different entities**: Fetch User(1) then User(2) — different cache entries
3. **L1 deduplication**: Single request fetches same entity twice — second fetch served from L1
4. **Mutation invalidation (`@cacheInvalidate`)**: Fetch entity (cached), mutate entity, fetch again (cache miss)
5. **Mutation population (`@cachePopulate`)**: Mutate, verify entity written to L2, subsequent query is cache hit
6. **Mutual exclusivity**: Verify composition rejects `@cacheInvalidate` + `@cachePopulate` on same field
7. **Multi-subgraph cache**: Cache User from accounts and Product from products independently
8. **Root field caching (`@queryCache`)**: Cache query result with entity key sharing
9. **`@is` argument mapping**: Root field `userById(userId)` with `@is(field: "id")` shares cache with User entity
10. **List return caching**: `topProducts` caches each Product individually with entity keys
11. **Extension-based invalidation**: Subgraph sends `cacheInvalidation` extension, verify cache cleared
12. **Subscription invalidation**: `productDeleted` subscription event triggers cache deletion
13. **Subscription population**: `productPriceChanged` event writes fresh data to cache
14. **TTL expiry**: Verify entries expire after TTL
15. **Shadow mode**: Verify fresh data always served, but cache reads/writes happen
16. **Analytics**: Verify cache hit/miss metrics are collected correctly
17. **No-argument query cache**: `me` uses root field cache key format
18. **Per-subgraph cache name**: Different entities route to different Redis backends
19. **Negative caching**: Null entity response cached as sentinel, subsequent request returns null from cache
20. **Global cache key prefix**: Cache keys include global prefix; changing prefix separates cache entries
21. **Circuit breaker**: When Redis fails repeatedly, L2 ops skip and engine falls back to subgraph; after cooldown, probe succeeds and breaker closes
22. **Cache operation errors**: Get/Set/Delete failures recorded in analytics when enabled

### Test Infrastructure

- Use `testenv.Run()` pattern from existing router tests
- Use `ModifyRouterConfig` callback to inject entity caching proto configuration
- Use `MemoryEntityCache` (in-memory LoaderCache) to avoid Redis dependency in tests
- Each test can count subgraph calls to verify cache hits vs. misses
- Test entity resolvers should track invocation counts

---

## 9. Implementation Phases

### Phase 1: Proto + Codegen
1. Add cache configuration messages to `proto/wg/cosmo/node/v1/node.proto`
2. Add fields to `DataSourceConfiguration`
3. Regenerate Go code
4. Update compatibility version if needed

### Phase 2: Cache Backend
1. Implement `RedisEntityCache` in `router/pkg/entitycache/redis.go`
2. Implement `MemoryEntityCache` in `router/pkg/entitycache/memory.go`
3. Unit tests for both implementations

### Phase 3: Router Config + Wiring
1. Add `EntityCachingConfiguration` to router YAML config
2. Add `EntityCacheKeyInterceptor` interface to custom module system
3. Initialize Redis cache instances from `storage_providers` in router startup
4. Build `SubgraphCachingConfigs` from proto in factory resolver (with `cache_name` resolution from YAML)
5. Wire caches into `ResolverOptions` in executor
6. Set `CachingOptions` on resolve context in GraphQL handler
7. Pass config through graph server

### Phase 4: Composition Integration
1. Register 5 directives in composition TypeScript package (following `@authenticated` pattern)
2. Implement argument-to-key auto-mapping + `@is` resolution for `@queryCache`
3. Implement all 20 validation rules
4. Serialize to router config output matching proto structure
5. Rebuild `composition-go` JS bundle

### Phase 5: Router Tests
1. Create `router-tests/entity_caching/` directory
2. Implement test subgraphs (accounts, products) with caching directives
3. Compose test config
4. Write integration tests for all 18 scenarios
5. Verify existing tests still pass

### Phase 6: Observability
1. Add entity cache metrics (see ENTITY_CACHING_CONFIGURATION.md analytics section)
2. Add cache timing to tracing spans
3. Log shadow mode staleness events
4. Integrate with existing OpenTelemetry infrastructure

---

## Appendix: graphql-go-tools Integration API Reference

### SubgraphCachingConfig (top-level per-subgraph container)

```go
// Package: execution/engine
type SubgraphCachingConfig struct {
    SubgraphName                string
    EntityCaching               plan.EntityCacheConfigurations
    RootFieldCaching            plan.RootFieldCacheConfigurations
    MutationFieldCaching        plan.MutationFieldCacheConfigurations
    MutationCacheInvalidation   plan.MutationCacheInvalidationConfigurations
    SubscriptionEntityPopulation plan.SubscriptionEntityPopulationConfigurations
}
```

### Engine Factory Option

```go
factory := engine.NewFederationEngineConfigFactory(
    ctx,
    subgraphConfigs,
    engine.WithSubgraphEntityCachingConfigs(cachingConfigs),
)
```

### Resolver Configuration

```go
resolver := resolve.New(ctx, resolve.ResolverOptions{
    Caches: map[string]resolve.LoaderCache{
        "default":          defaultRedisCache,
        "fast-cache":       fastRedisCache,
        "persistent-cache": persistentRedisCache,
    },
    CacheCircuitBreakers: map[string]resolve.CircuitBreakerConfig{
        "default": {Enabled: true, FailureThreshold: 5, CooldownPeriod: 10 * time.Second},
    },
    EntityCacheConfigs: map[string]map[string]*resolve.EntityCacheInvalidationConfig{
        "accounts": {
            "User": {CacheName: "default", IncludeSubgraphHeaderPrefix: true},
        },
    },
})
```

### Per-Request Context

```go
ctx.ExecutionOptions.Caching = resolve.CachingOptions{
    EnableL1Cache:         true,
    EnableL2Cache:         true,
    EnableCacheAnalytics:  true,
    GlobalCacheKeyPrefix:  "v1",  // Schema version prefix
    L2CacheKeyInterceptor: func(ctx context.Context, key string, info resolve.L2CacheKeyInterceptorInfo) string {
        return tenantID + ":" + key
    },
}
```

### After Execution

```go
snapshot := ctx.GetCacheStats()
snapshot.L1HitRate()         // float64 [0, 1]
snapshot.L2HitRate()         // float64 [0, 1]
snapshot.CachedBytesServed() // int64
```
