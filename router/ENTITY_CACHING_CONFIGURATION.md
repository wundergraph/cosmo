# Entity Caching Configuration

This document defines the operational configuration for entity caching in the cosmo router. For directive definitions, see [ENTITY_CACHING_DIRECTIVES.md](./ENTITY_CACHING_DIRECTIVES.md).

---

## Router YAML Configuration

Entity caching configuration lives under the `entity_caching` key in the router YAML config. It follows existing router config patterns:

- Storage references a named provider from `storage_providers.redis` or `storage_providers.memory` (like `persisted_operations.storage.provider_id`)
- Per-subgraph overrides use an array of subgraph rules (like `cache_control_policy.subgraphs`)
- Metrics integrate with the existing `telemetry.metrics` system (like `graphql_cache`)

### Configuration Structure

```yaml
entity_caching:
  enabled: false
  global_cache_key_prefix: ""    # Prefix for all L2 keys (e.g., schema hash for versioning)
  l1:
    enabled: true
  l2:
    enabled: true
    storage:
      provider_id: "default"     # References a storage_providers.redis or .memory entry
      key_prefix: "cosmo_entity_cache"
    circuit_breaker:
      enabled: false             # Circuit breaker for L2 cache operations
      failure_threshold: 5       # Consecutive failures before opening
      cooldown_period: "10s"     # How long to stay open before probing
  subgraph_cache_overrides:
    - name: "products"
      storage_provider_id: "fast-cache"  # All entities in this subgraph use "fast-cache"
      entities:
        - type: "Product"
          storage_provider_id: "hot-cache" # Override: this entity uses "hot-cache" instead
    - name: "accounts"
      entities:
        - type: "User"
          storage_provider_id: "persistent-cache"
```

### Configuration Reference

#### Top-Level

| Field | Type | Default | Env | Description |
|-------|------|---------|-----|-------------|
| `enabled` | bool | false | `ENTITY_CACHING_ENABLED` | Global enable/disable for entity caching. When false, all caching directives are ignored. |
| `global_cache_key_prefix` | string | "" | `ENTITY_CACHING_GLOBAL_CACHE_KEY_PREFIX` | Prefix prepended to all L2 cache keys (before header hash prefix). Use for schema versioning: set to a schema hash so that schema changes automatically separate cache entries without requiring a cache flush. Format: `{prefix}:{rest_of_key}`. Empty string means no prefix. |

#### L1 Cache

The L1 cache is an in-memory per-request cache. It deduplicates entity fetches within a single request — if the same entity is needed multiple times during query resolution, it is fetched once. L1 is a `sync.Map` and only covers entity fetches (not root fields).

| Field | Type | Default | Env | Description |
|-------|------|---------|-----|-------------|
| `l1.enabled` | bool | true | `ENTITY_CACHING_L1_ENABLED` | Enable/disable L1 per-request in-memory cache. |

#### L2 Cache

The L2 cache is a cross-request cache shared across all requests. It stores entity and root field data with TTL. L2 supports two storage backends:

- **Redis** (`storage_providers.redis`): External shared cache across router instances. Recommended for production.
- **Memory** (`storage_providers.memory`): In-process cache using [Ristretto](https://github.com/dgraph-io/ristretto). Not shared across instances — useful for development, testing, or single-instance deployments.

| Field | Type | Default | Env | Description |
|-------|------|---------|-----|-------------|
| `l2.enabled` | bool | true | `ENTITY_CACHING_L2_ENABLED` | Enable/disable L2 external cache. |
| `l2.storage.provider_id` | string | "" | `ENTITY_CACHING_L2_STORAGE_PROVIDER_ID` | References a `storage_providers.redis` or `storage_providers.memory` entry by ID. |
| `l2.storage.key_prefix` | string | "cosmo_entity_cache" | `ENTITY_CACHING_L2_STORAGE_KEY_PREFIX` | Prefix for all entity cache keys in the storage backend. |

#### L2 Circuit Breaker

The circuit breaker protects against cascading latency when the L2 cache backend (e.g., Redis) is slow or unavailable. When the breaker trips, all L2 operations (Get/Set/Delete) are skipped and the engine falls back to direct subgraph fetches. The breaker applies per named cache instance.

| Field | Type | Default | Env | Description |
|-------|------|---------|-----|-------------|
| `l2.circuit_breaker.enabled` | bool | false | `ENTITY_CACHING_L2_CIRCUIT_BREAKER_ENABLED` | Enable/disable the L2 circuit breaker. |
| `l2.circuit_breaker.failure_threshold` | int | 5 | `ENTITY_CACHING_L2_CIRCUIT_BREAKER_FAILURE_THRESHOLD` | Number of consecutive L2 operation failures that trips the breaker. |
| `l2.circuit_breaker.cooldown_period` | duration | "10s" | `ENTITY_CACHING_L2_CIRCUIT_BREAKER_COOLDOWN_PERIOD` | How long the breaker stays open before allowing a probe request. After cooldown, one request is allowed through (half-open state). If it succeeds, the breaker closes; if it fails, it re-opens. |

**States:**
- **Closed**: All L2 operations pass through normally.
- **Open**: All L2 operations are skipped (fall back to subgraph fetch). Entered after `failure_threshold` consecutive failures.
- **Half-Open**: After `cooldown_period` elapses, one probe request is allowed. Success → Closed, Failure → Open.

The `provider_id` references a storage provider defined in the top-level `storage_providers` section. The router checks `storage_providers.memory` first, then `storage_providers.redis`:

```yaml
storage_providers:
  redis:
    - id: "default"
      urls:
        - "redis://localhost:6379"
      cluster_enabled: false
    - id: "fast-cache"
      urls:
        - "redis://fast-redis:6379"
      cluster_enabled: false
  memory:
    - id: "dev-cache"
      max_size: "100MB"           # Maximum cache size (default: 100MB)
```

#### Metrics

Entity cache metrics are automatically reported when entity caching is enabled (`entity_caching.enabled: true`). They are exported via the same OTLP and Prometheus exporters configured in `telemetry.metrics`, following the existing `router.graphql.cache.*` pattern.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `router.entity_cache.requests.stats` | Counter | `type` (hits/misses), `cache_level` (l1/l2), `cache_type` (entity/root_field) | Cache request statistics. Hit/miss counts per cache level and type. |
| `router.entity_cache.keys.stats` | Counter | `operation` (added/updated/evicted), `cache_type` | Key lifecycle statistics. |
| `router.entity_cache.latency` | Histogram | `cache_level` (l2), `operation` (get/set/delete) | L2 cache operation latency in milliseconds. |
| `router.entity_cache.invalidations` | Counter | `source` (mutation/subscription/extension) | Cache invalidation counts by trigger source. |
| `router.entity_cache.populations` | Counter | `source` (mutation/subscription/query) | Cache population counts by trigger source. |
| `router.entity_cache.shadow.staleness` | Counter | `cache_type` | Shadow mode: count of requests where cached data differed from fresh data. |
| `router.entity_cache.operation_errors` | Counter | `operation` (get/set/set_negative/delete), `cache_name`, `entity_type` | Cache operation errors (Get/Set/Delete failures). Cache errors are non-fatal (engine falls back to subgraph fetch), but tracking them allows operators to detect cache infrastructure issues. |

#### Per-Subgraph Storage Provider Overrides

Cache backend assignment is an operator concern — subgraph developers shouldn't need to know about the cache infrastructure topology. Operators assign cache backends to subgraphs or specific entity types via `subgraph_cache_overrides`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `subgraph_cache_overrides[].name` | string | required | Subgraph name (must match a subgraph in the router config). |
| `subgraph_cache_overrides[].storage_provider_id` | string | "" | Storage provider for all entities in this subgraph (unless overridden per-entity). References a `storage_providers.redis` or `storage_providers.memory` entry by ID. |
| `subgraph_cache_overrides[].entities[].type` | string | required | Entity type name (must be a type with `@entityCache` in this subgraph). |
| `subgraph_cache_overrides[].entities[].storage_provider_id` | string | "" | Storage provider for this specific entity type. Overrides the subgraph-level `storage_provider_id`. |

**Resolution order:** When the router needs a storage provider for a given entity type in a subgraph, it resolves using a 3-tier lookup:

1. **Entity-level override**: `subgraph_cache_overrides[name].entities[type].storage_provider_id`
2. **Subgraph-level override**: `subgraph_cache_overrides[name].storage_provider_id`
3. **Global default**: `"default"` (the cache built from `l2.storage.provider_id`)

The first non-empty match wins. If no override is configured, the entity uses the default cache.

```yaml
entity_caching:
  enabled: true
  l2:
    storage:
      provider_id: "default"    # Global default backend
  subgraph_cache_overrides:
    - name: "products"
      storage_provider_id: "fast-cache"          # All products entities → fast-cache
      entities:
        - type: "Product"
          storage_provider_id: "hot-cache"        # Exception: Product → hot-cache
        - type: "Review"                          # No override → inherits "fast-cache" from subgraph
    - name: "accounts"
      entities:
        - type: "User"
          storage_provider_id: "persistent-cache" # No subgraph default → User → persistent-cache
                                                  # Other account entities → global default
```

---

## Custom Module: Entity Cache Key Interceptor

The L2 cache key can be transformed per-request using a custom module. This enables use cases like tenant isolation, A/B testing, or any scenario where the same entity should have different cache entries based on request context.

### Module Interface

A new module interface is added to the router's custom module system (following the pattern of `EnginePreOriginHandler`, `RouterMiddlewareHandler`, etc.):

```go
// EntityCacheKeyInterceptor allows custom modules to transform entity cache keys
// before they are used for L2 cache operations. The interceptor receives a batch
// of keys because the underlying LoaderCache interface is batch-oriented:
// Get(keys []string), Set(entries []*CacheEntry), Delete(keys []string).
//
// The interceptor is called once per cache operation (Get, Set, or Delete) with
// the full batch of keys for that operation.
type EntityCacheKeyInterceptor interface {
    // OnEntityCacheKeys transforms a batch of cache keys for an entity cache operation.
    // Each key is a JSON-encoded entity key or root field key.
    // Returns the transformed keys in the same order. The returned slice must have
    // the same length as the input slice.
    OnEntityCacheKeys(keys [][]byte, ctx RequestContext) [][]byte
}
```

**Why batch?** The `LoaderCache` interface operates on batches — `Get(ctx, keys []string)` fetches multiple entities in a single Redis `MGET` call, `Set(ctx, entries []*CacheEntry)` writes multiple entries in a pipelined `SET`, and `Delete(ctx, keys []string)` removes multiple entries in a pipelined `DEL`. The interceptor receives the full batch so it can apply transformations efficiently (e.g., compute a shared prefix once and apply it to all keys, rather than re-computing per key).

### Lifecycle

- The interceptor is discovered during `router.initModules()` like all other module interfaces
- It is called for every L2 cache `Get`, `Set`, and `Delete` operation with the full batch of keys
- Multiple modules implementing this interface are called in priority order (lower priority = earlier execution)
- The output of one interceptor is the input to the next
- The returned slice must maintain the same length and order as the input (the cache uses positional correspondence to match keys to results)

### Example Module

```go
package module

import (
    "crypto/sha256"
    "encoding/hex"
    "fmt"

    "github.com/wundergraph/cosmo/router/core"
    "go.uber.org/zap"
)

const tenantCacheModuleID = "tenant-cache-isolation"

// TenantCacheIsolation prefixes entity cache keys with a tenant identifier
// extracted from the request headers, ensuring cache isolation between tenants.
type TenantCacheIsolation struct {
    TenantHeader string `mapstructure:"tenant_header"`
    Logger       *zap.Logger
}

func (m *TenantCacheIsolation) Module() core.ModuleInfo {
    return core.ModuleInfo{
        ID:       tenantCacheModuleID,
        Priority: 1,
        New: func() core.Module {
            return &TenantCacheIsolation{}
        },
    }
}

func (m *TenantCacheIsolation) Provision(ctx *core.ModuleContext) error {
    if m.TenantHeader == "" {
        m.TenantHeader = "X-Tenant-ID"
    }
    m.Logger = ctx.Logger
    return nil
}

// OnEntityCacheKeys prefixes all cache keys in the batch with a hash of the tenant ID
func (m *TenantCacheIsolation) OnEntityCacheKeys(keys [][]byte, ctx core.RequestContext) [][]byte {
    tenantID := ctx.Request().Header.Get(m.TenantHeader)
    if tenantID == "" {
        return keys // No tenant header, use original keys
    }
    // Compute prefix once for the entire batch
    hash := sha256.Sum256([]byte(tenantID))
    prefix := hex.EncodeToString(hash[:8]) // 16-char hex prefix
    result := make([][]byte, len(keys))
    for i, key := range keys {
        result[i] = []byte(fmt.Sprintf("%s:%s", prefix, key))
    }
    return result
}

// Interface guards
var (
    _ core.Module                    = (*TenantCacheIsolation)(nil)
    _ core.Provisioner               = (*TenantCacheIsolation)(nil)
    _ core.EntityCacheKeyInterceptor = (*TenantCacheIsolation)(nil)
)
```

### Router YAML Configuration

```yaml
modules:
  tenant-cache-isolation:
    tenant_header: "X-Tenant-ID"
```

### Registration

The module is registered in the custom router binary:

```go
func main() {
    core.RegisterModule(&module.TenantCacheIsolation{})
    // ... start router
}
```

---

## Subgraph Extension-Based Invalidation

In addition to directive-based invalidation (`@cacheInvalidate`), subgraphs can signal cache invalidation at runtime through GraphQL response extensions. This does not require any directive — it is a runtime protocol between the subgraph and the router.

### Protocol

A subgraph includes invalidation hints in its response `extensions` field:

```json
{
  "data": { "updateUser": { "id": "1", "name": "Updated" } },
  "extensions": {
    "cacheInvalidation": {
      "keys": [
        { "typename": "User", "key": { "id": "1" } },
        { "typename": "User", "key": { "id": "2" } }
      ]
    }
  }
}
```

### Behavior

1. The router inspects the `extensions.cacheInvalidation` field in every subgraph response
2. For each entry in `keys`, the router builds the full cache key (with all transformations applied — global prefix, header hashing, module interceptors if applicable)
3. The corresponding L2 entries are deleted
4. This allows subgraphs to invalidate cache entries for entities that weren't directly returned in the mutation response

### Requirements

- The entity type referenced in `typename` must have `@entityCache` configured in at least one subgraph. The router needs the cache configuration to determine which cache backend and key format to use.
- The `key` object must contain all `@key` fields for the entity type.
- Extension-based invalidation works regardless of the operation type (query, mutation, or subscription).

### Use Cases

- **Cascading invalidation**: A mutation on `Order` also invalidates related `OrderItem` entities that weren't returned in the response.
- **Batch invalidation**: A bulk update operation invalidates multiple entities at once.
- **Cross-entity invalidation**: Updating a `Product` price invalidates cached `PriceHistory` entities.

---

## Complete Router YAML Example

```yaml
version: "1"

storage_providers:
  redis:
    - id: "default"
      urls:
        - "redis://localhost:6379"
      cluster_enabled: false
    - id: "fast-cache"
      urls:
        - "redis://fast-redis:6379"
      cluster_enabled: false
  memory:
    - id: "dev-cache"
      max_size: "100MB"

entity_caching:
  enabled: true
  global_cache_key_prefix: "v1"  # Schema version prefix for all L2 keys
  l1:
    enabled: true
  l2:
    enabled: true
    storage:
      provider_id: "default"
      key_prefix: "cosmo_entity_cache"
    circuit_breaker:
      enabled: true
      failure_threshold: 5
      cooldown_period: "10s"
  subgraph_cache_overrides:
    - name: "products"
      storage_provider_id: "fast-cache"   # All product entities → fast Redis
      entities:
        - type: "Product"
          storage_provider_id: "dev-cache" # Exception: Product → in-memory cache

# Optional: custom module for cache key transformation
modules:
  tenant-cache-isolation:
    tenant_header: "X-Tenant-ID"
```
