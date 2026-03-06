# Task 09: Router GraphQL Handler + Graph Server Per-Request Wiring

## Objective

Set per-request `CachingOptions` on the resolve context in the GraphQL handler, wire the `EntityCacheKeyInterceptor` as an `L2CacheKeyInterceptor` closure, and ensure WebSocket/subscription handlers have parity for `@cachePopulate` and `@cacheInvalidate` support.

## Scope

- Set `CachingOptions` on the resolve context in `graphql_handler.go`
- Build `L2CacheKeyInterceptor` closure from `EntityCacheKeyInterceptor` modules
- Pass entity caching config through `graph_server.go` to handlers
- Ensure subscription handler (WebSocket) has equivalent cache wiring

## Dependencies

| Task | What it provides |
|------|-----------------|
| Task 00 | **Upgraded graphql-go-tools with `resolve.CachingOptions`, `resolve.L2CacheKeyInterceptor`, `resolve.L2CacheKeyInterceptorInfo`** |
| Task 03 | `LoaderCache` implementations |
| Task 07 | `EntityCacheKeyInterceptor` modules, cache instances, config on `graphServer` |
| Task 08 | `ResolverOptions.Caches` wired in Executor, `SubgraphCachingConfig` in engine |

## Files to Modify

### File 1: `router/core/graphql_handler.go`

**Current state**: `ServeHTTP()` (lines 137-250+) creates the resolve context and sets execution options. The resolve context is created via `resolve.NewContext(executionContext)` (line 146), then various fields are set (variables, request, tracing, etc.).

**Add entity caching fields to handler struct**:

```go
type GraphQLHandler struct {
    // ... existing fields ...
    entityCachingL1Enabled         bool
    entityCachingL2Enabled         bool
    entityCachingAnalyticsEnabled  bool
    entityCacheKeyInterceptors     []EntityCacheKeyInterceptor
}
```

**Set CachingOptions in `ServeHTTP()`** — After the existing resolve context setup (around line 159), before the operation plan check:

```go
resolveCtx.ExecutionOptions.Caching = resolve.CachingOptions{
    EnableL1Cache:         h.entityCachingL1Enabled,
    EnableL2Cache:         h.entityCachingL2Enabled,
    EnableCacheAnalytics:  h.entityCachingAnalyticsEnabled,
    L2CacheKeyInterceptor: h.buildL2CacheKeyInterceptor(resolveCtx),
}
```

**Build `L2CacheKeyInterceptor` closure**:

The graphql-go-tools engine calls `L2CacheKeyInterceptor` **per-key** (not batch). The actual type from the upgraded graphql-go-tools:

```go
// In resolve package:
type L2CacheKeyInterceptor func(ctx context.Context, key string, info L2CacheKeyInterceptorInfo) string

type L2CacheKeyInterceptorInfo struct {
    SubgraphName string
    CacheName    string
}
```

The closure captures the request context and invokes all registered `EntityCacheKeyInterceptor` modules in priority order. Since the engine calls per-key but our module interface is batch-oriented, we wrap in a single-element batch:

```go
func (h *GraphQLHandler) buildL2CacheKeyInterceptor(
    resolveCtx *resolve.Context,
) resolve.L2CacheKeyInterceptor {
    if len(h.entityCacheKeyInterceptors) == 0 {
        return nil
    }
    return func(ctx context.Context, key string, info resolve.L2CacheKeyInterceptorInfo) string {
        // Engine calls per-key; our module interface is batch-oriented.
        // Wrap in single-element batch for module compatibility.
        keys := [][]byte{[]byte(key)}
        reqCtx := resolveCtx.RequestContext() // or however the RequestContext is obtained
        for _, interceptor := range h.entityCacheKeyInterceptors {
            keys = interceptor.OnEntityCacheKeys(keys, reqCtx)
        }
        return string(keys[0])
    }
}
```

**Note**: The `L2CacheKeyInterceptorInfo` provides `SubgraphName` and `CacheName` which could be passed through to the module interface in the future. For now, modules only receive the keys and request context.

### File 2: `router/core/graph_server.go`

**Current state**: `newGraphServer()` (lines 131-350+) creates the graph server and sets up handlers. The `graphServer` struct (lines 78-106) holds config and metrics.

**Pass entity caching config to handler creation**:

When creating the GraphQL handler (in the mux setup section), pass the entity caching fields:

```go
graphqlHandler := NewGraphQLHandler(HandlerOptions{
    // ... existing options ...
    EntityCachingL1Enabled:        gs.entityCachingConfig.Enabled && gs.entityCachingConfig.L1.Enabled,
    EntityCachingL2Enabled:        gs.entityCachingConfig.Enabled && gs.entityCachingConfig.L2.Enabled,
    EntityCachingAnalyticsEnabled: gs.entityCachingConfig.Enabled && gs.entityCachingConfig.Analytics.Enabled,
    EntityCacheKeyInterceptors:    gs.entityCacheKeyInterceptors,
})
```

**Extend `HandlerOptions`** (lines 67-84):

```go
type HandlerOptions struct {
    // ... existing fields ...
    EntityCachingL1Enabled         bool
    EntityCachingL2Enabled         bool
    EntityCachingAnalyticsEnabled  bool
    EntityCacheKeyInterceptors     []EntityCacheKeyInterceptor
}
```

### File 3: `router/core/websocket_handler.go` (or equivalent)

For subscription support (`@cachePopulate` and `@cacheInvalidate` on Subscription fields), the WebSocket handler must set the same `CachingOptions` on the resolve context. The pattern is identical to the GraphQL handler:

```go
// In the WebSocket handler's subscription execution path:
resolveCtx.ExecutionOptions.Caching = resolve.CachingOptions{
    EnableL1Cache:         h.entityCachingL1Enabled,
    EnableL2Cache:         h.entityCachingL2Enabled,
    EnableCacheAnalytics:  h.entityCachingAnalyticsEnabled,
    L2CacheKeyInterceptor: h.buildL2CacheKeyInterceptor(resolveCtx),
}
```

## Per-Request Behavior

The `CachingOptions` control how the engine handles caching for each request:

| Field | Effect |
|---|---|
| `EnableL1Cache` | Enables in-memory per-request entity deduplication via `sync.Map` |
| `EnableL2Cache` | Enables cross-request L2 cache (Redis) reads and writes |
| `EnableCacheAnalytics` | Enables cache hit/miss metric collection |
| `L2CacheKeyInterceptor` | Transforms cache keys before L2 operations (for tenant isolation, etc.) |

**Operation-type behavior** (handled by the engine, not by this task):
- **Queries**: L1 check → L2 check → subgraph fetch → populate L1 + L2
- **Mutations**: Always skip L2 reads; skip L2 writes unless `@cachePopulate`; `@cacheInvalidate` deletes after completion
- **Subscriptions**: `@cachePopulate` writes on events; `@cacheInvalidate` deletes on events

## Header-Based Cache Keys

When `includeHeaders: true` is set on a directive, the engine automatically includes forwarded request headers in the cache key. This is handled by the engine using the request headers available in the resolve context. The `SubgraphHeadersBuilder` (already set on the resolve context) provides the headers.

The `L2CacheKeyInterceptor` is a separate mechanism — it's for custom transformations beyond the built-in header hashing.

## Verification

1. **Compilation**: `cd router && go build ./...` succeeds
2. **CachingOptions set**: Write a test that creates a GraphQL handler with entity caching enabled and verifies `CachingOptions` is set on the resolve context
3. **Interceptor wiring**: Register a mock `EntityCacheKeyInterceptor` → verify it's called during cache key transformation
4. **Disabled caching**: With `entity_caching.enabled: false` → `CachingOptions` fields are all false/nil
5. **WebSocket parity**: Subscription handler sets same `CachingOptions` as HTTP handler
6. **Existing tests pass**: `cd router && go test ./...` — no regressions

## Out of Scope

- Cache backend implementations (Task 03)
- Module interface definition and instance building (Task 07)
- FactoryResolver/Executor wiring (Task 08)
- Metrics collection (Task 10)
- Extension-based invalidation (Task 12)
