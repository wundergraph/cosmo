# Data Race in go-arena During Entity Caching

## How to Reproduce

Run the entity caching test suite with the race detector enabled and multiple parallel tests:

```bash
cd router-tests
go test -race -v ./entity_caching/ -count=1 -timeout 180s
```

The race does NOT reproduce when running a single test in isolation:

```bash
# This will pass — no race
go test -race -v ./entity_caching/ -run "TestEntityCaching/basic_L2_miss_then_hit" -count=1
```

It only triggers when multiple tests run in parallel, because the race is *within* a single
request's parallel entity fetches (not between test goroutines). More concurrent router instances
→ more parallel fetches → higher probability of hitting the race window.

## Race Output

```
WARNING: DATA RACE
Read at 0x... by goroutine ...:
  github.com/wundergraph/go-arena.(*monotonicBuffer).alloc()
      monotonic_arena.go:32
  github.com/wundergraph/go-arena.(*monotonicArena).Alloc()
      monotonic_arena.go:117
  github.com/wundergraph/go-arena.AllocateSlice[go.shape.string]()
      slice.go:19
  ...resolve.(*Loader).extractCacheKeysStrings()
      loader_cache.go:47
  ...resolve.(*Loader).tryL2CacheLoad()
      loader_cache.go:410
  ...resolve.(*Loader).loadFetchL2Only()
      loader.go:634
  ...resolve.(*Loader).resolveParallel.func2()
      loader.go:388

Previous write at 0x... by goroutine ...:
  github.com/wundergraph/go-arena.(*monotonicBuffer).alloc()
      monotonic_arena.go:32
  [same stack]
```

## Root Cause

### The arena lifecycle

Each GraphQL request acquires a single `monotonicArena` from a pool:

```
resolve.go:407    resolveArena := r.resolveArenaPool.Acquire(ctx.Request.ID)
resolve.go:409    t := newTools(..., resolveArena.Arena)
                  // t.loader.jsonArena = resolveArena.Arena  (shared across all fetches)
```

This single arena instance is stored as `l.jsonArena` on the `Loader` and used for all
allocations during request resolution.

### The parallel fetch path

When a query touches multiple subgraphs (e.g., items + details + inventory), the resolver
spawns goroutines in `resolveParallel()`:

```go
// loader.go:387-389
for i := range nodes {
    g.Go(func() error {
        return l.loadFetchL2Only(ctx, f, item, items, res[i])
    })
}
```

Each goroutine calls `extractCacheKeysStrings(l.jsonArena, ...)` which allocates from the
shared arena via `arena.AllocateSlice[string](a, 0, len(cacheKeys))`.

### The unsafe allocator

`monotonicArena.Alloc()` and `monotonicBuffer.alloc()` have no synchronization:

```go
// monotonic_arena.go:32-40
func (s *monotonicBuffer) alloc(size, alignment uintptr) (unsafe.Pointer, bool) {
    // ...
    s.offset += allocSize  // ← RACE: unprotected write
    return ptr, true
}

// monotonic_arena.go:117-122
func (a *monotonicArena) Alloc(size, alignment uintptr) unsafe.Pointer {
    ptr, ok := a.buffers[i].alloc(size, alignment)
    if ok {
        if currentLen > a.peak {
            a.peak = currentLen  // ← RACE: unprotected write
        }
        return ptr
    }
    // ...
    a.buffers = append(a.buffers, newBuffer)  // ← RACE: slice append
}
```

**Summary:** Multiple goroutines within a single request concurrently call `Alloc()` on the
same `monotonicArena` which has no mutex protection. The racing fields are:
- `monotonicBuffer.offset` (bump pointer)
- `monotonicArena.peak` (high-water mark)
- `monotonicArena.buffers` (backing slice)

## Fix

`go-arena` already provides a thread-safe wrapper: `arena.NewConcurrentArena(baseArena)`.

The fix is in `graphql-go-tools/v2/pkg/engine/resolve/resolve.go`. When creating the tools
for a request, wrap the arena:

```go
// resolve.go:409 — current code
t := newTools(r.options, ..., resolveArena.Arena)

// Fix: wrap with ConcurrentArena
t := newTools(r.options, ..., arena.NewConcurrentArena(resolveArena.Arena))
```

This adds a `sync.Mutex` around all `Alloc()` calls. The performance impact is minimal since
arena allocations are fast (bump pointer) and contention is low (each goroutine does a small
number of allocations per fetch).

### Alternative: per-goroutine arenas

A zero-contention alternative would be to acquire a separate arena per goroutine in
`resolveParallel()` instead of sharing the request's arena. This avoids the mutex entirely
but requires plumbing arena acquisition into the parallel loop.

## Files Involved

| File | Role |
|------|------|
| `go-arena/monotonic_arena.go:32,117-122` | Unprotected `Alloc()` / `alloc()` |
| `go-arena/concurrent_arena.go` | Thread-safe wrapper (the fix) |
| `graphql-go-tools/.../resolve/resolve.go:407-409` | Arena acquired per request |
| `graphql-go-tools/.../resolve/loader.go:387-389` | Parallel goroutines spawned |
| `graphql-go-tools/.../resolve/loader_cache.go:47` | `extractCacheKeysStrings` allocates from shared arena |

## Impact

This race can cause:
- **Memory corruption:** Two goroutines get overlapping allocations from the same buffer offset
- **Silent data corruption:** Cache keys or JSON values written to overlapping memory regions
- **Panics:** Slice bounds violations if `buffers` slice is concurrently appended and read

The race is only triggered when entity caching is enabled AND a query fans out to 2+ subgraphs
in parallel. Without entity caching, `loadFetchL2Only()` is not called.
