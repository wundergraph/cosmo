# Task 03: Cache Backend Implementation (Redis + Memory)

## Objective

Implement two concrete backends for the `resolve.LoaderCache` interface from `graphql-go-tools/v2`:

1. **`RedisEntityCache`** — production backend using `go-redis/v9` with MGET/pipeline SET/pipeline DEL
2. **`MemoryEntityCache`** — in-process backend with `sync.RWMutex` + map + TTL expiry, for integration tests

Both live in the new package `router/pkg/entitycache/`.

## Scope

- Two new files: `router/pkg/entitycache/redis.go` and `router/pkg/entitycache/memory.go`
- Unit tests: `router/pkg/entitycache/redis_test.go` and `router/pkg/entitycache/memory_test.go`
- No dependency on other entity caching tasks

## Dependencies

| Dependency | What it provides |
|---|---|
| **Task 00** | **Upgraded graphql-go-tools with `resolve.LoaderCache` and `resolve.CacheEntry`** |
| `github.com/redis/go-redis/v9` | Already in `router/go.mod` (v9.7.3) |
| Go 1.25 | Per `router/go.mod` |

**Important**: Task 00 must be completed first — `resolve.LoaderCache` and `resolve.CacheEntry` do not exist in the current graphql-go-tools version.

---

## Interface to Implement

From `graphql-go-tools/v2/pkg/engine/resolve`:

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

### Batch Semantics

- **`Get`**: Returns N `*CacheEntry` pointers in positional order. `nil` for misses.
- **`Set`**: Writes N entries with shared TTL.
- **`Delete`**: Removes N keys.

---

## File 1: `router/pkg/entitycache/redis.go`

### Struct & Constructor

```go
package entitycache

type RedisEntityCache struct {
    client    redis.UniversalClient
    keyPrefix string
}

func NewRedisEntityCache(client redis.UniversalClient, keyPrefix string) *RedisEntityCache {
    return &RedisEntityCache{client: client, keyPrefix: keyPrefix}
}
```

### `Get` — MGET

```go
func (c *RedisEntityCache) Get(ctx context.Context, keys []string) ([]*resolve.CacheEntry, error) {
    if len(keys) == 0 {
        return nil, nil
    }
    prefixedKeys := make([]string, len(keys))
    for i, k := range keys {
        prefixedKeys[i] = c.keyPrefix + ":" + k
    }
    vals, err := c.client.MGet(ctx, prefixedKeys...).Result()
    if err != nil {
        return nil, err
    }
    entries := make([]*resolve.CacheEntry, len(keys))
    for i, val := range vals {
        if val == nil {
            continue
        }
        str, ok := val.(string)
        if !ok {
            continue
        }
        entries[i] = &resolve.CacheEntry{
            Key:   keys[i],
            Value: []byte(str),
        }
    }
    return entries, nil
}
```

- Single round trip via MGET. Returns nil at miss positions.
- `RemainingTTL` left at 0 (unknown). Adding PTTL pipeline possible later if needed.

### `Set` — Pipeline SET with TTL

```go
func (c *RedisEntityCache) Set(ctx context.Context, entries []*resolve.CacheEntry, ttl time.Duration) error {
    if len(entries) == 0 {
        return nil
    }
    pipe := c.client.Pipeline()
    for _, entry := range entries {
        if entry == nil {
            continue
        }
        pipe.Set(ctx, c.keyPrefix+":"+entry.Key, entry.Value, ttl)
    }
    _, err := pipe.Exec(ctx)
    return err
}
```

### `Delete` — Pipeline DEL

```go
func (c *RedisEntityCache) Delete(ctx context.Context, keys []string) error {
    if len(keys) == 0 {
        return nil
    }
    pipe := c.client.Pipeline()
    for _, k := range keys {
        pipe.Del(ctx, c.keyPrefix+":"+k)
    }
    _, err := pipe.Exec(ctx)
    return err
}
```

### Interface Guard

```go
var _ resolve.LoaderCache = (*RedisEntityCache)(nil)
```

### Thread Safety

`redis.UniversalClient` is safe for concurrent use. No additional synchronization needed.

---

## File 2: `router/pkg/entitycache/memory.go`

### Struct & Constructor

```go
package entitycache

type cacheEntry struct {
    value     []byte
    expiresAt time.Time
}

type MemoryEntityCache struct {
    mu      sync.RWMutex
    entries map[string]*cacheEntry
}

func NewMemoryEntityCache() *MemoryEntityCache {
    return &MemoryEntityCache{entries: make(map[string]*cacheEntry)}
}
```

### `Get` — Map Lookup with Lazy Expiry

```go
func (c *MemoryEntityCache) Get(ctx context.Context, keys []string) ([]*resolve.CacheEntry, error) {
    if len(keys) == 0 {
        return nil, nil
    }
    now := time.Now()
    entries := make([]*resolve.CacheEntry, len(keys))
    c.mu.RLock()
    for i, k := range keys {
        e, ok := c.entries[k]
        if !ok || (!e.expiresAt.IsZero() && now.After(e.expiresAt)) {
            continue
        }
        entries[i] = &resolve.CacheEntry{
            Key:          k,
            Value:        e.value,
            RemainingTTL: time.Until(e.expiresAt),
        }
    }
    c.mu.RUnlock()
    return entries, nil
}
```

### `Set` — Map Write

```go
func (c *MemoryEntityCache) Set(ctx context.Context, entries []*resolve.CacheEntry, ttl time.Duration) error {
    if len(entries) == 0 {
        return nil
    }
    var expiresAt time.Time
    if ttl > 0 {
        expiresAt = time.Now().Add(ttl)
    }
    c.mu.Lock()
    for _, entry := range entries {
        if entry == nil {
            continue
        }
        c.entries[entry.Key] = &cacheEntry{value: entry.Value, expiresAt: expiresAt}
    }
    c.mu.Unlock()
    return nil
}
```

### `Delete` — Map Delete

```go
func (c *MemoryEntityCache) Delete(ctx context.Context, keys []string) error {
    if len(keys) == 0 {
        return nil
    }
    c.mu.Lock()
    for _, k := range keys {
        delete(c.entries, k)
    }
    c.mu.Unlock()
    return nil
}
```

### `Len` Helper (for tests)

```go
func (c *MemoryEntityCache) Len() int {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return len(c.entries)
}
```

### Interface Guard

```go
var _ resolve.LoaderCache = (*MemoryEntityCache)(nil)
```

---

## Key Prefix Handling

| Layer | Key format |
|---|---|
| Engine (caller) | `{"__typename":"User","key":{"id":"123"}}` |
| `RedisEntityCache` | `cosmo_entity_cache:{"__typename":"User","key":{"id":"123"}}` |
| `MemoryEntityCache` | `{"__typename":"User","key":{"id":"123"}}` (no prefix) |

The `EntityCacheKeyInterceptor` transforms keys _before_ they reach the backend. The Redis prefix is the final transformation.

---

## Unit Tests

### `memory_test.go` — No external deps

1. Get miss — all nil
2. Set then Get — values match in order
3. Get partial hit — positional correspondence
4. Delete — entry removed
5. Delete nonexistent — no error
6. TTL expiry — short TTL + sleep → nil
7. Overwrite — second Set wins
8. Empty batch — no error, no panic
9. Concurrent access — goroutines with `-race`
10. Len helper — correct count
11. Nil entries in Set — no panic

### `redis_test.go` — Requires Redis

Same scenarios plus:
- Key prefix isolation (two caches, different prefixes, same Redis)
- Use `testing.Short()` skip or build tags

---

## Verification

| Criterion | Command |
|---|---|
| Both compile | `go build ./router/pkg/entitycache/...` |
| Interface satisfied | Interface guard compiles |
| Memory tests pass | `go test -race ./router/pkg/entitycache/...` |
| Redis tests pass | `go test -race -run TestRedis ./router/pkg/entitycache/...` |
| No data races | `-race` flag |
| TTL works | Tests with short TTL + sleep |
| Batch ordering | Tests verify positional correspondence |

## Out of Scope

- Router YAML config parsing (Task 04)
- Factory resolver wiring / `map[string]LoaderCache` construction (Task 08)
- Custom module `EntityCacheKeyInterceptor` (Task 07)
- Per-request `CachingOptions` (Task 09)
