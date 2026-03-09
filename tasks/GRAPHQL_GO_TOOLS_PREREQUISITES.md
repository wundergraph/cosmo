# graphql-go-tools Prerequisites for Entity Cache Error Tracking

Changes needed in `github.com/wundergraph/graphql-go-tools/v2` (resolve package) before the router can implement cache operation error tracking.

---

## 1. Add `CacheOperationError` struct

```go
// pkg/engine/resolve/cache_analytics.go (or similar)

type CacheOperationError struct {
    Operation  string // "get", "set", "set_negative", "delete"
    CacheName  string // Named cache instance (e.g., "default", "fast-cache")
    EntityType string // Entity type name (e.g., "User", "Product")
    DataSource string // Subgraph/datasource name
    Message    string // Error message (truncated to 256 chars)
    ItemCount  int    // Number of items in the failed batch
}
```

## 2. Add `CacheOpErrors` to `CacheAnalyticsSnapshot`

```go
type CacheAnalyticsSnapshot struct {
    // ... existing fields ...
    CacheOpErrors []CacheOperationError
}
```

## 3. Record errors in loader during L2 operations

In the entity loader's L2 cache interaction code:
- On `cache.Get()` error: record with operation `"get"`
- On `cache.Set()` error for regular entities: record with operation `"set"`
- On `cache.Set()` error for negative sentinels: record with operation `"set_negative"`
- On `cache.Delete()` error (mutation/extension invalidation): record with operation `"delete"`

Error messages should be truncated to 256 characters.

## 4. Add `MergeL2CacheOpErrors()`

Errors collected in Phase 2 goroutines need to be merged onto the main thread:

```go
func (l *Loader) MergeL2CacheOpErrors(errors []CacheOperationError) {
    l.cacheAnalytics.CacheOpErrors = append(l.cacheAnalytics.CacheOpErrors, errors...)
}
```

---

## Router-side changes (after graphql-go-tools updates)

Once the above is in place, the router needs:

1. **`router/pkg/metric/entity_cache_metrics.go`** — Add `operationErrors` counter:
   ```go
   entityCacheOperationErrorsKey = entityCacheMetricBase + "operation_errors"
   ```
   Labels: `operation` (get/set/set_negative/delete), `cache_name`, `entity_type`

2. **`RecordSnapshot()`** — Iterate `snapshot.CacheOpErrors` and increment the counter per error.
