# Task 07: Router Module Interface + Config Wiring

## Objective

Add the `EntityCacheKeyInterceptor` module interface to the router's custom module system, wire entity caching configuration from router YAML through to the graph server, and build Redis-backed `LoaderCache` instances from `storage_providers`.

## Scope

- Define `EntityCacheKeyInterceptor` interface in `modules.go`
- Discover interceptor modules during `initModules()`
- Build `map[string]resolve.LoaderCache` from storage providers + entity caching config
- Pass entity caching config from `router.go` → `graph_server.go`

## Dependencies

| Task | What it provides |
|------|-----------------|
| Task 00 | **Upgraded graphql-go-tools with `resolve.LoaderCache` type** |
| Task 01 | Proto messages (consumed indirectly — proto fields on `DataSourceConfiguration`) |
| Task 03 | `RedisEntityCache` and `MemoryEntityCache` backends in `router/pkg/entitycache/` |
| Task 04 | `EntityCachingConfiguration` Go structs in `router/pkg/config/config.go` |

## Files to Modify

### File 1: `router/core/modules.go`

**Current state**: Defines module interfaces (lines 52-143): `Module`, `RouterMiddlewareHandler`, `EnginePreOriginHandler`, `EnginePostOriginHandler`, `Provisioner`, `Cleaner`, etc.

**Add the new interface**:

```go
// EntityCacheKeyInterceptor allows custom modules to transform entity cache keys
// before they are used for L2 cache operations. The interceptor receives a batch
// of keys because the underlying LoaderCache interface is batch-oriented.
type EntityCacheKeyInterceptor interface {
	// OnEntityCacheKeys transforms a batch of cache keys for an entity cache operation.
	// Each key is a JSON-encoded entity key or root field key.
	// Returns the transformed keys in the same order. The returned slice must have
	// the same length as the input slice.
	OnEntityCacheKeys(keys [][]byte, ctx RequestContext) [][]byte
}
```

Place this alongside the other handler interfaces. No changes to `ModuleInfo`, `Module`, or `RegisterModule()` needed — the interface is discovered via type assertion during `initModules()`.

### File 2: `router/core/router.go`

**Module discovery** — In `initModules()` (lines 629-726), add type assertion for the new interface:

```go
// Inside the module processing loop (after existing interface checks):
if interceptor, ok := mod.(EntityCacheKeyInterceptor); ok {
    r.entityCacheKeyInterceptors = append(r.entityCacheKeyInterceptors, interceptor)
}
```

**New field on Router struct**:

```go
entityCacheKeyInterceptors []EntityCacheKeyInterceptor
```

**Cache instance building** — In `buildClients()` (lines 1109-1227), add entity cache client initialization:

```go
func (r *Router) buildEntityCacheInstances() (map[string]resolve.LoaderCache, error) {
    if !r.Config.EntityCaching.Enabled || !r.Config.EntityCaching.L2.Enabled {
        return nil, nil
    }

    caches := make(map[string]resolve.LoaderCache)
    keyPrefix := r.Config.EntityCaching.L2.Storage.KeyPrefix

    // Build default cache from l2.storage.provider_id
    defaultProviderID := r.Config.EntityCaching.L2.Storage.ProviderID
    if defaultProviderID != "" {
        client, err := r.findRedisClient(defaultProviderID)
        if err != nil {
            return nil, fmt.Errorf("entity caching default provider: %w", err)
        }
        caches["default"] = entitycache.NewRedisEntityCache(client, keyPrefix)
    }

    // Build per-subgraph caches from subgraphs[].entities[].cache_name
    for _, sg := range r.Config.EntityCaching.Subgraphs {
        for _, entity := range sg.Entities {
            cacheName := entity.CacheName
            if cacheName == "" || cacheName == "default" {
                continue // uses default
            }
            if _, exists := caches[cacheName]; exists {
                continue // already built
            }
            client, err := r.findRedisClient(cacheName)
            if err != nil {
                return nil, fmt.Errorf("entity caching provider %q for %s.%s: %w",
                    cacheName, sg.Name, entity.Type, err)
            }
            caches[cacheName] = entitycache.NewRedisEntityCache(client, keyPrefix)
        }
    }

    return caches, nil
}

func (r *Router) findRedisClient(providerID string) (redis.UniversalClient, error) {
    for _, provider := range r.Config.StorageProviders.Redis {
        if provider.ID == providerID {
            // Use existing rediscloser infrastructure to create client
            return rediscloser.NewClient(provider.URLs, provider.ClusterEnabled)
        }
    }
    return nil, fmt.Errorf("redis provider %q not found in storage_providers", providerID)
}
```

**Note**: The actual Redis client creation should use the existing `router/internal/rediscloser/rediscloser.go` infrastructure, matching how `persisted_operations` and `rate_limiter` create their Redis clients.

### File 3: `router/core/graph_server.go`

**Pass entity caching config to graph server**. The `graphServer` struct (lines 78-106) needs new fields:

```go
type graphServer struct {
    // ... existing fields ...
    entityCachingConfig          *config.EntityCachingConfiguration
    entityCacheInstances         map[string]resolve.LoaderCache
    entityCacheKeyInterceptors   []EntityCacheKeyInterceptor
}
```

In `newGraphServer()` (lines 131-350+), pass the config from the router:

```go
gs := &graphServer{
    // ... existing assignments ...
    entityCachingConfig:        &r.Config.EntityCaching,
    entityCacheInstances:       cacheInstances,        // from buildEntityCacheInstances()
    entityCacheKeyInterceptors: r.entityCacheKeyInterceptors,
}
```

These fields are consumed by Task 08 (FactoryResolver/Executor) and Task 09 (GraphQL Handler).

## Cache Instance Lifecycle

```
Router startup
    ↓
buildEntityCacheInstances()
    → Reads EntityCachingConfiguration from YAML
    → Looks up storage_providers.redis by provider_id
    → Creates redis.UniversalClient per unique provider
    → Wraps in entitycache.NewRedisEntityCache(client, keyPrefix)
    → Returns map[string]resolve.LoaderCache
    ↓
newGraphServer(cacheInstances, interceptors, config)
    → Stores on graphServer struct
    ↓
Executor.Build() (Task 08)
    → Passes cacheInstances to ResolverOptions
    ↓
GraphQL Handler (Task 09)
    → Uses interceptors in per-request CachingOptions
```

## Provider ID Resolution

The `cache_name` field in per-subgraph config references `storage_providers.redis[].id`:

```yaml
storage_providers:
  redis:
    - id: "default"          # ← referenced by provider_id or cache_name
      urls: ["redis://localhost:6379"]
    - id: "fast-cache"       # ← referenced by cache_name
      urls: ["redis://fast-redis:6379"]

entity_caching:
  l2:
    storage:
      provider_id: "default" # ← references storage_providers.redis[0]
  subgraphs:
    - name: "products"
      entities:
        - type: "Product"
          cache_name: "fast-cache" # ← references storage_providers.redis[1]
```

## Verification

1. **Compilation**: `cd router && go build ./...` succeeds
2. **Interface guard**: Verify the example TenantCacheIsolation module from ENTITY_CACHING_CONFIGURATION.md compiles against the interface
3. **Module discovery**: Write a test that registers a mock `EntityCacheKeyInterceptor` module and verifies it's collected during `initModules()`
4. **Cache instances**: With valid config + storage providers, `buildEntityCacheInstances()` returns the correct map
5. **Missing provider**: With invalid `provider_id`, `buildEntityCacheInstances()` returns a clear error
6. **Disabled caching**: With `entity_caching.enabled: false`, `buildEntityCacheInstances()` returns nil
7. **Existing tests pass**: `cd router && go test ./...` — no regressions

## Out of Scope

- Cache backend implementation (Task 03)
- YAML config struct definitions (Task 04)
- FactoryResolver/Executor wiring (Task 08)
- Per-request CachingOptions (Task 09)
- Metrics (Task 10)
