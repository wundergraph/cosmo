# Task 12: Extension-Based Invalidation + Subscription Cache

## Objective

Implement runtime extension-based cache invalidation (subgraph response `extensions.cacheInvalidation.keys` protocol) and subscription-driven cache population/invalidation. This enables cache management beyond directive-based static configuration.

## Scope

- Parse `extensions.cacheInvalidation` from subgraph responses
- Build full cache keys from extension data (with all transformations)
- Delete L2 entries for invalidated entities
- Subscription event cache population (`@cachePopulate`)
- Subscription event cache invalidation (`@cacheInvalidate`)
- Shared cache key building utilities

## Dependencies

| Task | What it provides |
|------|-----------------|
| Task 09 | Per-request CachingOptions, L2CacheKeyInterceptor, cache instances on resolver |
| Task 11 | Integration test infrastructure (test scenarios 11-13 verify this task) |

## Extension Protocol

From ENTITY_CACHING_CONFIGURATION.md — subgraphs signal invalidation in response extensions:

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

**Behavior**:
1. Router inspects `extensions.cacheInvalidation` in every subgraph response
2. For each entry in `keys`, builds the full cache key (with prefix, module interceptors, header hash)
3. Calls `LoaderCache.Delete()` with the constructed keys
4. Works regardless of operation type (query, mutation, subscription)

## Files to Modify

### File 1: Response Processing (subgraph response handler)

The extension parsing needs to happen where subgraph responses are processed. Look for the response handling pipeline — likely in the resolve/loader layer or in `EnginePostOriginHandler`.

**Extension parsing**:

```go
type cacheInvalidationExtension struct {
    Keys []cacheInvalidationKey `json:"keys"`
}

type cacheInvalidationKey struct {
    TypeName string                 `json:"typename"`
    Key      map[string]interface{} `json:"key"`
}

func parseCacheInvalidation(extensions json.RawMessage) (*cacheInvalidationExtension, error) {
    if len(extensions) == 0 {
        return nil, nil
    }
    var ext struct {
        CacheInvalidation *cacheInvalidationExtension `json:"cacheInvalidation"`
    }
    if err := json.Unmarshal(extensions, &ext); err != nil {
        return nil, err // malformed extensions — log and continue, don't fail the request
    }
    return ext.CacheInvalidation, nil
}
```

**Cache key construction from extension data**:

```go
func buildCacheKeyFromExtension(typeName string, keyFields map[string]interface{}) (string, error) {
    // Sort key fields alphabetically for stable key generation
    sortedKey := sortMapKeys(keyFields)

    // Build JSON cache key in the same format as engine-generated keys:
    // {"__typename":"User","key":{"id":"123"}}
    keyJSON, err := json.Marshal(map[string]interface{}{
        "__typename": typeName,
        "key":        sortedKey,
    })
    if err != nil {
        return "", err
    }
    return string(keyJSON), nil
}
```

**Invalidation execution**:

Extension invalidation is **scoped to the responding subgraph** — when a subgraph sends `cacheInvalidation` in its response extensions, only that subgraph's cache backend is targeted (not all subgraphs that share the entity type).

```go
func (h *handler) processExtensionInvalidation(
    ctx context.Context,
    extensions json.RawMessage,
    subgraphName string, // the subgraph that returned this response
    entityCacheConfigs map[string]map[string]*resolve.EntityCacheInvalidationConfig,
    caches map[string]resolve.LoaderCache,
    keyInterceptor resolve.L2CacheKeyInterceptor,
) error {
    inv, err := parseCacheInvalidation(extensions)
    if err != nil || inv == nil {
        return err
    }

    // Look up cache configs only for the responding subgraph
    subgraphConfigs, ok := entityCacheConfigs[subgraphName]
    if !ok {
        return nil // subgraph has no entity cache config
    }

    // Group keys by cache name for efficient batch deletion
    keysByCacheName := make(map[string][]string)
    for _, entry := range inv.Keys {
        entityConfig, ok := subgraphConfigs[entry.TypeName]
        if !ok {
            continue // entity type not configured for caching in this subgraph
        }
        cacheKey, err := buildCacheKeyFromExtension(entry.TypeName, entry.Key)
        if err != nil {
            continue // malformed key — skip
        }
        // Apply key interceptor if present
        if keyInterceptor != nil {
            cacheKey = keyInterceptor(ctx, cacheKey, resolve.L2CacheKeyInterceptorInfo{
                SubgraphName: subgraphName,
                CacheName:    entityConfig.CacheName,
            })
        }
        keysByCacheName[entityConfig.CacheName] = append(keysByCacheName[entityConfig.CacheName], cacheKey)
    }

    // Batch delete per cache
    for cacheName, keys := range keysByCacheName {
        cache, ok := caches[cacheName]
        if !ok {
            continue
        }
        if err := cache.Delete(ctx, keys); err != nil {
            // Log error but don't fail the request
            return err
        }
    }
    return nil
}
```

### File 2: Subscription Cache Handlers

Subscription events with `@cachePopulate` or `@cacheInvalidate` need to interact with the L2 cache.

**`@cachePopulate` on subscriptions**: When a subscription event arrives with entity data, extract key fields and entity data, then write to L2:

```go
func (h *handler) processSubscriptionCachePopulate(
    ctx context.Context,
    entityData json.RawMessage,
    entityTypeName string,
    config *resolve.EntityCacheConfig,
    cache resolve.LoaderCache,
) error {
    // Extract @key fields from entity data
    cacheKey, err := buildCacheKeyFromEntityData(entityTypeName, entityData, config.KeyFields)
    if err != nil {
        return err
    }

    entry := &resolve.CacheEntry{
        Key:   cacheKey,
        Value: entityData,
    }
    return cache.Set(ctx, []*resolve.CacheEntry{entry}, config.TTL)
}
```

**`@cacheInvalidate` on subscriptions**: When a subscription event arrives, extract key fields and delete from L2:

```go
func (h *handler) processSubscriptionCacheInvalidate(
    ctx context.Context,
    entityData json.RawMessage,
    entityTypeName string,
    config *resolve.EntityCacheConfig,
    cache resolve.LoaderCache,
) error {
    cacheKey, err := buildCacheKeyFromEntityData(entityTypeName, entityData, config.KeyFields)
    if err != nil {
        return err
    }
    return cache.Delete(ctx, []string{cacheKey})
}
```

### File 3: Shared Cache Key Utilities

Create shared utilities for cache key construction that are consistent with the engine's key format:

```go
package entitycache

// BuildEntityCacheKey constructs a cache key from entity type name and key field values.
// Format: {"__typename":"User","key":{"id":"123"}}
// Key fields are sorted alphabetically for stable generation.
func BuildEntityCacheKey(typeName string, keyFields map[string]string) string {
    // Sort key field names
    names := make([]string, 0, len(keyFields))
    for name := range keyFields {
        names = append(names, name)
    }
    sort.Strings(names)

    // Build JSON
    var buf bytes.Buffer
    buf.WriteString(`{"__typename":"`)
    buf.WriteString(typeName)
    buf.WriteString(`","key":{`)
    for i, name := range names {
        if i > 0 {
            buf.WriteByte(',')
        }
        buf.WriteString(`"`)
        buf.WriteString(name)
        buf.WriteString(`":"`)
        buf.WriteString(keyFields[name])
        buf.WriteString(`"`)
    }
    buf.WriteString(`}}`)
    return buf.String()
}
```

## Requirements

From ENTITY_CACHING_CONFIGURATION.md:

- The entity type in `typename` must have `@entityCache` configured in at least one subgraph (for cache name and key format resolution)
- The `key` object must contain all `@key` fields for the entity type
- Extension-based invalidation works regardless of operation type
- Errors in extension parsing should be logged but not fail the request

## Integration with Existing Cache Pipeline

The extension invalidation must apply the same key transformations as the engine:

1. **Base key**: JSON entity key (from extension data)
2. **Header hash prefix**: If `includeHeaders: true` on the entity's `@entityCache`
3. **EntityCacheKeyInterceptor**: Custom module transformation
4. **Redis key prefix**: Applied by `RedisEntityCache` internally

Steps 2-3 are applied via the `L2CacheKeyInterceptor` closure from Task 09. Step 4 is handled by the `LoaderCache` implementation.

## Cache Name Resolution

Extension invalidation is **scoped to the responding subgraph**. The `EntityCacheConfigs` on the resolver (from Task 08) provides the mapping:

```go
// ResolverOptions.EntityCacheConfigs structure:
map[string]map[string]*resolve.EntityCacheInvalidationConfig{
    "accounts": {
        "User": {CacheName: "default", IncludeSubgraphHeaderPrefix: true},
    },
    "products": {
        "Product": {CacheName: "fast-cache", IncludeSubgraphHeaderPrefix: false},
    },
}
```

When a subgraph response includes `cacheInvalidation` extensions, the lookup uses only that subgraph's config entry. For example, if the "accounts" subgraph returns an extension invalidating `User`, only the "accounts" → "User" config is used (cache name "default"), even if "products" also has a "User" entity with a different cache name.

## Error Handling

- **Malformed `extensions` JSON**: Log warning, skip invalidation, continue request processing
- **Unknown entity type in extension**: Skip that entry, process remaining
- **Missing key fields**: Skip that entry, log warning
- **Cache delete failure**: Log error, don't fail the request
- **Cache set failure** (subscription populate): Log error, don't fail subscription delivery

## Verification

1. **Compilation**: `cd router && go build ./...` succeeds
2. **Extension parsing**: Unit test `parseCacheInvalidation()` with valid, empty, and malformed JSON
3. **Cache key construction**: Unit test `buildCacheKeyFromExtension()` produces correct JSON key format
4. **Invalidation flow**: Integration test (scenario 11) — subgraph sends extension → cache entry deleted
5. **Subscription populate**: Integration test (scenario 13) — subscription event → cache populated
6. **Subscription invalidate**: Integration test (scenario 12) — subscription event → cache deleted
7. **Error resilience**: Malformed extensions don't crash the request
8. **Key transformation**: Extension keys go through the same interceptor pipeline as engine keys
9. **Existing tests pass**: `cd router && go test ./...` — no regressions

## Out of Scope

- Directive-based invalidation (`@cacheInvalidate` on mutations) — handled by the engine in Task 08
- Cache backend implementations (Task 03)
- Per-request CachingOptions (Task 09)
- Metrics for invalidation/population (Task 10 — `router.entity_cache.invalidations` counter)
