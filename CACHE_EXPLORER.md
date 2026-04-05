# Cache Explorer for Cosmo Router Playground

## Context

Users need a way to understand how entity caching affects their GraphQL operations.
The playground should let them run a query N times (default 10) with caching enabled vs disabled,
then compare server-side latencies, cache hit ratios, subgraph request counts, and bytes transferred.

**This is a cache explorer, not a benchmark.**
It answers "does caching help my query?" in a dev environment.
It does not claim to measure production performance or produce statistically valid percentiles.

## UX Model

The Cache Explorer is integrated into the existing playground view system, not a separate tool:

1. **Cache Explorer is the 4th view mode** in the response toolbar dropdown, after
   Response / Request Trace / Query Plan. Selecting it reveals the explorer panel
   on the right side (where the response would normally show).

2. **The existing `cacheMode` dropdown drives the experiment.**
   Whatever the user picks ("Caching enabled" / "Caching (L2 only)" / "Caching (L1 only)")
   becomes the **cached configuration** that gets compared against **cache disabled**.
   No separate cache mode selector inside the explorer — the regular one already there does the job.
   - `cacheMode: 'enabled'` → cached phase uses L1+L2
   - `cacheMode: 'no-l1'` → cached phase uses L2 only
   - `cacheMode: 'no-l2'` → cached phase uses L1 only
   - `cacheMode: 'disabled'` → explorer is disabled (nothing meaningful to compare)

3. **The GraphiQL play button runs the explorer** when the view is Cache Explorer.
   Users don't need to click a separate "Run" button — the normal play button they
   already know is the trigger. When view ≠ cache-explorer, play behaves as normal
   (single query execution).

4. **Iterations input lives inside the explorer panel** on the right.
   Small number input, default 10, persisted in localStorage.

5. **Live updating results** render on the right as each request completes —
   chart grows, summary table updates, speedup banner ticks up.

## Current State (What Already Exists)

A lot of groundwork already landed in the repo:

### Router side (`router/core/graphql_handler.go`)
- Cache disable headers already defined and wired up at lines 588-620:
  - `X-WG-Disable-Entity-Cache` (disable both)
  - `X-WG-Disable-Entity-Cache-L1`
  - `X-WG-Disable-Entity-Cache-L2`
- Read in `cachingOptions()` (line 593), gated on `reqCtx.operation.traceOptions.Enable`
  (which requires dev mode or a valid studio request token)
- `reqCtx.request` is `*http.Request` (confirmed), headers accessed via `reqCtx.request.Header.Get(...)`

### Playground side (`playground/src/components/playground/`)
- `CacheMode` type in `types.ts` line 21: `'enabled' | 'no-l1' | 'no-l2' | 'disabled'`
- `PlaygroundContext` exposes `cacheMode` / `setCacheMode`
- `graphiQLFetch` in `index.tsx` lines 166-176 injects the correct disable headers based on `cacheMode`
- `CacheControl` dropdown in `ResponseToolbar` (lines 335-351) lets users switch modes manually
- `collectCacheSummary` + `CacheBadge` already parse trace responses and show hit/total ratio
- `CacheTrace` types, `getCacheStatus()`, `getCacheStatusLabel()` helpers already exist
- `view-cache.tsx` shows per-fetch cache detail modal

### What's still missing
- **Router**: `X-WG-Cache-Key-Prefix` header for per-run cache isolation (random prefix prevents key collisions across runs)
- **Playground**: The Cache Explorer view itself — runner, results component, view mode integration

## Part 1: Router-Side Changes (~10 lines, 1 file)

### 1a. Add `X-WG-Cache-Key-Prefix` header

**File**: `router/core/graphql_handler.go`

Add a new constant alongside the existing disable headers (around line 588):

```go
const (
    cacheKeyPrefixHeader       = "X-WG-Cache-Key-Prefix"
    disableEntityCacheHeader   = "X-WG-Disable-Entity-Cache"
    disableEntityCacheL1Header = "X-WG-Disable-Entity-Cache-L1"
    disableEntityCacheL2Header = "X-WG-Disable-Entity-Cache-L2"
)
```

### 1b. Use the prefix in `cachingOptions()`

Modify `cachingOptions()` to read the prefix header and prepend it to the existing `GlobalKeyPrefix`.
This piggybacks on the same `traceOptions.Enable` gate the disable headers already use:

```go
func (h *GraphQLHandler) cachingOptions(reqCtx *requestContext) resolve.CachingOptions {
    enableL1 := h.entityCaching.L1Enabled
    enableL2 := h.entityCaching.L2Enabled
    globalKeyPrefix := h.entityCaching.GlobalKeyPrefix

    // Allow per-request cache control headers only when tracing is authorized
    // (dev mode or valid studio request token). This prevents production abuse.
    if reqCtx.operation.traceOptions.Enable {
        if reqCtx.request.Header.Get(disableEntityCacheHeader) == "true" {
            enableL1 = false
            enableL2 = false
        } else {
            if reqCtx.request.Header.Get(disableEntityCacheL1Header) == "true" {
                enableL1 = false
            }
            if reqCtx.request.Header.Get(disableEntityCacheL2Header) == "true" {
                enableL2 = false
            }
        }
        if prefix := reqCtx.request.Header.Get(cacheKeyPrefixHeader); prefix != "" {
            if globalKeyPrefix != "" {
                globalKeyPrefix = prefix + ":" + globalKeyPrefix
            } else {
                globalKeyPrefix = prefix
            }
        }
    }

    return resolve.CachingOptions{
        EnableL1Cache:         enableL1,
        EnableL2Cache:         enableL2,
        EnableCacheAnalytics:  len(h.entityCaching.Metrics) > 0,
        GlobalCacheKeyPrefix:  globalKeyPrefix,
        L2CacheKeyInterceptor: h.buildL2CacheKeyInterceptor(reqCtx),
    }
}
```

No `DevelopmentMode` plumbing needed — the existing `traceOptions.Enable` gate already handles authorization.
This is cleaner than the original plan because it reuses the same authorization check that the other per-request dev headers already use.

## Part 2: Playground Changes

### 2a. Extend view type

**File**: `playground/src/components/playground/types.ts` (line 19)

```typescript
export type PlaygroundView = 'response' | 'request-trace' | 'query-plan' | 'cache-explorer';
```

### 2b. New file: `cache-explorer-types.ts`

```typescript
export type CacheExplorerRequestResult = {
  index: number;
  clientDurationMs: number;     // wall-clock (performance.now)
  serverDurationMs: number;     // from ART: total server processing time
  status: number;
  cacheHits: number;            // l1_hit + l2_hit across all fetches
  cacheMisses: number;          // l1_miss + l2_miss across all fetches
  entityCount: number;          // sum of entity_count across all fetches
  subgraphRequests: number;     // count of non-skipped fetch nodes with source_id
  bytesTransferred: number;     // sum of response body_size from subgraph traces
  entityBreakdown: EntityCacheBreakdown[];
};

export type EntityCacheBreakdown = {
  typeName: string;             // e.g. "Article"
  hits: number;
  misses: number;
};

export type CacheExplorerPhaseResult = {
  label: 'cached' | 'uncached';
  requests: CacheExplorerRequestResult[];
  avgClientLatencyMs: number;
  avgServerLatencyMs: number;
  minServerLatencyMs: number;
  maxServerLatencyMs: number;
  totalCacheHits: number;
  totalCacheMisses: number;
  cacheHitRatio: number;
  totalSubgraphRequests: number;
  totalBytesTransferred: number;
};

export type CacheExplorerResult = {
  timestamp: number;
  iterations: number;
  cached: CacheExplorerPhaseResult;
  uncached: CacheExplorerPhaseResult;
  speedup: number;              // based on server latency (not client)
};

export type CacheExplorerState =
  | { status: 'idle' }
  | { status: 'running';
      phase: 'cached' | 'uncached';
      current: number;
      total: number;
      cachedResults: CacheExplorerRequestResult[];
      uncachedResults: CacheExplorerRequestResult[];
    }
  | { status: 'complete'; result: CacheExplorerResult }
  | { status: 'error'; message: string };
```

### 2c. New file: `cache-explorer-runner.ts`

Core execution logic. Runs **raw `fetch()`** directly,
bypassing `graphiQLFetch` to avoid:
- Custom scripts (pre-flight / pre-op / post-op)
- Client-side validation
- Side effects on the normal response panel

**Key function**:
```typescript
runCacheExplorer(
  config: {
    url: string;
    query: string;
    variables?: string;
    operationName?: string;
    headers: Record<string, string>;   // from editor, minus cache mode headers
    iterations: number;
    cacheMode: CacheMode;              // drives which headers the cached phase sends
  },
  onProgress: (state: CacheExplorerState) => void,
  signal: AbortSignal,
): Promise<CacheExplorerResult>
```

Flow:
1. Generate random prefix: `explorer-${crypto.randomUUID().slice(0,8)}`
2. Build base headers from config + `X-WG-TRACE: 'true'`. **Strip** any pre-existing
   `X-WG-Disable-Entity-Cache*` and `X-WG-Cache-Key-Prefix` headers to avoid interference.
3. **Cached phase**: Loop N times sequentially
   - Add `X-WG-Cache-Key-Prefix: <prefix>` header
   - Add disable headers based on `config.cacheMode`:
     - `'enabled'` → no disable headers (L1 + L2 active)
     - `'no-l1'` → `X-WG-Disable-Entity-Cache-L1: true` (L2 only)
     - `'no-l2'` → `X-WG-Disable-Entity-Cache-L2: true` (L1 only)
     - `'disabled'` → should not reach runner (caller should guard); if it does, skip phase
   - Measure `clientDurationMs` with `performance.now()`
   - POST to `config.url` with body `{ query, variables, operationName }`
   - Parse response, extract metrics (see below)
   - Call `onProgress` with updated running state
   - If `signal.aborted`, throw
4. **Uncached phase**: Loop N times sequentially
   - Add `X-WG-Disable-Entity-Cache: true` header (no prefix needed — nothing is cached)
   - Same extraction and progress logic
5. Compute aggregates (avg, min, max) per phase using **server latency**
6. Compute speedup = `uncached.avgServerLatencyMs / cached.avgServerLatencyMs`
7. Return `CacheExplorerResult`

**Helper: `extractMetricsFromTrace(trace)`**
Recursive walk of `extensions.trace.fetches`, similar to the existing `collectCacheSummary`
in `index.tsx` line 244. For each fetch node:
- Skip if `trace.load_skipped === true`
- Pull `cache_trace.l1_hit`, `l2_hit`, `l1_miss`, `l2_miss`, `entity_count`
- For entity breakdown: `cache_trace.keys` is an array of JSON strings like
  `{"__typename":"Article","key":{"id":"1"}}`. Parse each, extract `__typename`,
  group by type. Since we don't know which individual key was hit vs missed from
  the trace, approximate: if a fetch had `l1_hit + l2_hit > 0`, count all its
  entity types as hits; if `l1_miss + l2_miss > 0`, count as misses. A fetch
  can contribute to both buckets in the batch-entity case.
- Count as subgraph request if `source_id` is present and not skipped
- Add `output.extensions.trace.response.body_size` to bytes total

**Helper: `extractServerDurationMs(trace)`**
From `extensions.trace.info`: sum `parse_stats.duration_nanoseconds`,
`normalize_stats.duration_nanoseconds`, `validate_stats.duration_nanoseconds`,
`planner_stats.duration_nanoseconds`. For execute duration, walk the fetch tree
and find the maximum end time (`duration_since_start_nanoseconds + duration_load_nanoseconds`),
subtract planner end time. Convert total ns → ms.

**Abort**: `AbortSignal` checked between iterations and passed to `fetch()`.

### 2d. New file: `cache-explorer-view.tsx`

Main React component rendered via portal into `cache-explorer-visualization` div.

**Layout**:
```
┌───────────────────────────────────────────────────┐
│ Iterations: [10]                                  │
│ Comparing: Caching enabled (L1+L2) vs disabled    │
│ ▶ Press Play to run                               │
├───────────────────────────────────────────────────┤
│                                                   │
│  Running: Cached phase 3/10 ████░░░░░░            │
│                                                   │
│  ─── or when complete ───                         │
│                                                   │
│  ┌─ Speedup Banner ─────────────────────────┐     │
│  │  3.2x faster with caching (server-side)  │     │
│  └──────────────────────────────────────────┘     │
│                                                   │
│  ┌─ Server Latency Chart (SVG) ─────────────┐     │
│  │  Line chart: cached (green) vs uncached  │     │
│  │  X: iteration, Y: server latency (ms)    │     │
│  └──────────────────────────────────────────┘     │
│                                                   │
│  ┌─ Summary Table ──────────────────────────┐     │
│  │              │ Cached    │ Uncached       │     │
│  │ Server Avg   │ 1.2ms     │ 3.8ms          │     │
│  │ Server Min   │ 0.8ms     │ 3.1ms          │     │
│  │ Server Max   │ 2.4ms     │ 5.9ms          │     │
│  │ Client Avg   │ 2.1ms     │ 6.8ms          │     │
│  │ Cache Hit %  │ 92%       │ —              │     │
│  │ Entities     │ 12        │ 12             │     │
│  │ Subgraph Req │ 4         │ 30             │     │
│  │ Bytes Sent   │ 1.2KB     │ 12.8KB         │     │
│  └──────────────────────────────────────────┘     │
│                                                   │
│  ┌─ Entity Breakdown ───────────────────────┐     │
│  │  Article: 10 hits / 2 misses (83%)       │     │
│  │  Author:  8 hits / 4 misses (67%)        │     │
│  └──────────────────────────────────────────┘     │
│                                                   │
│  ⚠ Note: First cached request is always a        │
│    cache miss (cold cache). Other router caches   │
│    (plan, normalization) warm across all runs.    │
│    Dev-mode exploration tool, not a load test.    │
│                                                   │
└───────────────────────────────────────────────────┘
```

**Header area of the panel**:
- Iterations number input (default 10, range 2-100)
- A small status line showing the current comparison based on `cacheMode`:
  - `'enabled'` → "Comparing: Caching enabled (L1+L2) vs disabled"
  - `'no-l1'` → "Comparing: Caching (L2 only) vs disabled"
  - `'no-l2'` → "Comparing: Caching (L1 only) vs disabled"
  - `'disabled'` → "⚠ Select a cache mode to run the explorer" (disabled state)
- "▶ Press Play to run" hint (or Cancel button when running)

**Charting**: Inline SVG (no new dependencies).
The playground ships as a single embedded HTML file via `vite-plugin-singlefile`,
so bundle size matters. Two series of ~10 points is trivial with raw SVG polylines.

**Live updates during run**: Results render as they arrive, not just at the end.
`onProgress` from the runner fires after each request, pushing new results into state.
The chart grows its polyline incrementally; the summary table updates running averages;
the speedup ratio updates live.

**State**:
- `useState<CacheExplorerState>` for run state (including live partial results)
- `useLocalStorage('playground:cache-explorer:iterations', 10)` for iteration count
- `useContext(TraceContext)` for current query/variables/headers/url
- `useContext(PlaygroundContext)` for current `cacheMode` and `view`
- `useRef<AbortController>` for cancellation

**Triggering runs**: The play button in the GraphiQL toolbar drives the explorer.
The integration point is in `graphiQLFetch` (see 2e below). The explorer view does
NOT have its own "Run" button — it reads state from a shared context/ref. While
running, the view shows a Cancel button that sets `AbortController.abort()`.

**Empty state**: When no results yet, show `EmptyState` telling the user to write a
query and press Play. If `cacheMode === 'disabled'`, show a warning that they need
to pick a cache mode first.

**Error state**: If a request fails mid-run (network error, 4xx/5xx), show the error
and offer retry (next play button press retries).

### 2e. Wire into view mode system + play button interception

**File**: `playground/src/components/playground/index.tsx`

#### View mode integration
1. **ResponseToolbar `onValueChange`** (around line 338): Add `'cache-explorer'` case
   that hides response/art/plan and shows cache-explorer wrapper
2. **ResponseToolbar `getIcon`**: Add icon for the new view (reuse `BoltIcon`)
3. **ResponseToolbar `SelectContent`**: Add 4th `SelectItem` labeled "Cache Explorer"
4. **Mount effect**: Create `cache-explorer-visualization` div alongside art/planner wrappers
5. **`PlaygroundPortal`**: Add `createPortal(<CacheExplorerView />, cacheExplorerDiv)`

#### Play button interception

The explorer reuses the GraphiQL play button. When the user is in cache-explorer view,
clicking play runs the explorer loop instead of a single request.

GraphiQL's play button calls the fetcher (`graphiQLFetch`), which currently makes a single
fetch and calls `onFetch(responseData, status, statusText)`. We intercept here:

1. **Share a run controller via ref.** Add a `cacheExplorerControllerRef` in the `Playground`
   component that exposes `{ runFromFetcher, abort, state, setState }`. The `CacheExplorerView`
   reads `state` via a context/ref and renders accordingly.

2. **Intercept in the fetcher** (`graphiQLFetch`): accept a `view: PlaygroundView` argument
   (plumbed through a `viewRef` like `cacheModeRef`). When `view === 'cache-explorer'`:
   - Parse the request body to get `query`, `variables`, `operationName`
   - Read iterations from localStorage
   - Check current `cacheMode`; if `'disabled'`, return an error response immediately
     (GraphiQL will display it in the normally-hidden response panel, no harm done)
   - Call `runCacheExplorer(config, onProgress, signal)`, where `onProgress` updates
     the ref-shared state (which triggers re-renders in `CacheExplorerView`)
   - When the explorer completes, return a synthetic response like
     `{ extensions: { cacheExplorer: { summary: ... } } }` — GraphiQL's response
     panel is hidden in this view, so the content doesn't matter, but we should
     return valid JSON so GraphiQL doesn't throw.
   - When `view !== 'cache-explorer'`, behave exactly as today (single fetch).

3. **Abort handling**: The explorer view's Cancel button calls
   `cacheExplorerControllerRef.current.abort()`, which aborts the `AbortController`
   the fetcher passed to `runCacheExplorer`. The explorer throws, the fetcher catches,
   returns a "cancelled" synthetic response, and resets state.

4. **State flow**:
   ```
   User clicks play
     → graphiQLFetch(url, init)
     → view === 'cache-explorer'?
         → yes: runCacheExplorer → progress updates → controller ref → CacheExplorerView re-renders
         → no:  normal single fetch
   ```

5. **Edge case**: If the user switches view away from cache-explorer mid-run, the run
   continues in the background until done (it's sequential, has an end). Abort on
   view change is optional — probably not needed for v1.

## Verification

### 1. Router header (manual)
- Start router with `DEV_MODE=true` and entity caching enabled
- Send request with `X-WG-Cache-Key-Prefix: test123` + `X-WG-TRACE: true`
  — verify `cache_trace.keys` in response show the `test123` prefix (or the effective prefix it's wrapped in)
- Verify a second request with the same prefix hits the cache (`l2_hit > 0`)
- Verify a second request with a different prefix does NOT hit the cache (isolation works)
- Send same request without `X-WG-TRACE` — verify the prefix header is ignored

### 2. Playground cache explorer
- Run `pnpm build:router` in `playground/`
- Start router in dev mode, open playground
- Write a query that fetches cached entities
- Ensure cache mode dropdown is set to "Caching enabled"
- Switch to Cache Explorer view
- Click the GraphiQL play button → explorer runs automatically with 10 iterations
- Verify cached phase: first request is a miss, subsequent are hits, chart line drops after iteration 1
- Verify uncached phase: all requests show no cache hits, latency is consistently higher
- Verify speedup ratio matches avg latency difference
- Verify entity breakdown shows per-type hit/miss ratios
- Verify Cancel button in the explorer panel aborts mid-run
- Verify chart and table update live (not just at the end)
- Switch cache mode to "Caching (L2 only)", click play → explorer compares L2-only vs disabled
- Switch cache mode to "Caching (L1 only)", click play → explorer compares L1-only vs disabled
- Switch cache mode to "Caching disabled" → explorer panel shows warning, play is a no-op or error
- Verify re-running works (uses a new random prefix, so no cross-contamination)
- Switch back to "Response" view, click play → normal single-query execution resumes

### 3. Type check
```bash
cd playground && npx tsc --noEmit
```

## Implementation Order

1. **Demo latency middleware**: Create `demo/pkg/injector/latency.go` and wire it into
   `demo/cmd/cache-demo/main.go` + `demo/pkg/subgraphs/subgraphs.go`. Update
   `demo/router-cache.yaml` header propagation rules.
2. **Router**: Add `cacheKeyPrefixHeader` constant + prefix handling in `cachingOptions()`
   (single file: `router/core/graphql_handler.go`)
3. **Playground**: `types.ts` — add `'cache-explorer'` to view union
4. **Playground**: `cache-explorer-types.ts` — type definitions
5. **Playground**: `cache-explorer-runner.ts` — execution logic (uses raw fetch, not graphiQLFetch)
6. **Playground**: `cache-explorer-view.tsx` — UI component with live SVG charts
7. **Playground**: `index.tsx` — wire into view mode system + play button interception
8. **Build and test**: `pnpm build:router` then restart router

Step 1 (demo latency) can be done first and independently — it's a standalone improvement
to the demo environment and makes the explorer demo visibly compelling later.

## Part 3: Artificial Latency for Demo Subgraphs

To make the cache explorer demo compelling, real subgraphs typically respond fast enough locally
that the cache speedup is hard to see. We add artificial latency to the three demo cache subgraphs
(viewer, cachegraph, cachegraph_ext) via a request header, so the playground can dial in a
realistic "subgraph is 200ms away" scenario and show the cache win clearly.

**This only touches the demo environment, not the router itself.** The header flows:
playground → router (propagated) → demo subgraph HTTP handler (reads header and sleeps).

### 3a. Header forwarding rule in router config

**File**: `demo/router-cache.yaml`

Extend the existing `headers.subgraphs` section to propagate a new header to all three
cache subgraphs. Existing rules for `Authorization` stay, we add `X-Artificial-Latency`:

```yaml
headers:
  subgraphs:
    cachegraph:
      request:
        - op: propagate
          named: Authorization
        - op: propagate
          named: X-Artificial-Latency
    cachegraph_ext:
      request:
        - op: propagate
          named: X-Artificial-Latency
    viewer:
      request:
        - op: propagate
          named: Authorization
        - op: propagate
          named: X-Artificial-Latency
```

Note: the current config doesn't have a `cachegraph_ext` entry — add it.

### 3b. Latency middleware for demo subgraphs

**New file**: `demo/pkg/injector/latency.go`

A simple HTTP middleware that reads `X-Artificial-Latency` (milliseconds as integer) and
sleeps before passing the request down. Silently ignores invalid values (no error response —
this is a demo tool, not a production API).

```go
package injector

import (
    "net/http"
    "strconv"
    "time"
)

const ArtificialLatencyHeader = "X-Artificial-Latency"

// Latency wraps a handler and sleeps for the number of milliseconds
// specified in the X-Artificial-Latency header (if present and valid).
// Intended for demos where local subgraphs are too fast to make caching
// benefits visible.
func Latency(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if v := r.Header.Get(ArtificialLatencyHeader); v != "" {
            if ms, err := strconv.Atoi(v); err == nil && ms > 0 && ms <= 10000 {
                time.Sleep(time.Duration(ms) * time.Millisecond)
            }
        }
        next.ServeHTTP(w, r)
    })
}
```

Bounded at 10 seconds to prevent runaway sleeps if someone passes a huge value.

### 3c. Wire the middleware into cache-demo entry point

**File**: `demo/cmd/cache-demo/main.go`

Wrap the mux with `injector.Latency()` in both `gqlServer()` and `viewerServer()`:

```go
func gqlServer(name string, port int, schema graphql.ExecutableSchema) *http.Server {
    srv := handler.New(schema)
    srv.AddTransport(transport.POST{})
    srv.AddTransport(transport.GET{})
    mux := http.NewServeMux()
    mux.Handle("/", playground.Handler(name, "/graphql"))
    mux.Handle("/graphql", srv)
    return &http.Server{Addr: ":" + strconv.Itoa(port), Handler: injector.Latency(mux)}
}

func viewerServer(port int) *http.Server {
    mux := http.NewServeMux()
    mux.Handle("/", playground.Handler("viewer", "/graphql"))
    mux.Handle("/graphql", viewer.NewHandler())
    return &http.Server{Addr: ":" + strconv.Itoa(port), Handler: injector.Latency(mux)}
}
```

Add `"github.com/wundergraph/cosmo/demo/pkg/injector"` to the imports.

### 3d. Wire the middleware into the full `all` demo

**File**: `demo/pkg/subgraphs/subgraphs.go`, `newServer()` helper (around line 167)

The existing code already wraps the mux with `injector.HTTP(mux)`. Chain latency around it:

```go
return &http.Server{
    Addr:    config.listenAddr,
    Handler: injector.Latency(injector.HTTP(mux)),
}
```

Order matters: latency runs first (sleeps before body parsing), then HTTP injector does its work.

### 3e. Demo usage

With the above in place, users can set an artificial latency from the playground:

1. Open the playground at `http://localhost:3002/`
2. In the headers editor, add:
   ```json
   {
     "X-WG-TRACE": "true",
     "X-Artificial-Latency": "200"
   }
   ```
3. Run queries normally → each subgraph hop now waits 200ms before responding
4. Switch to Cache Explorer view, click play → the cached vs uncached comparison now shows
   dramatic differences (e.g. 10ms cached vs 400ms+ uncached for a query that hits two subgraphs)

The cache explorer runner does NOT need to know about this header — it lives in the user's
editor headers and gets propagated through automatically via the cache explorer runner's
header passthrough.

### 3f. Verification

1. Start the cache-demo: `cd demo && go run ./cmd/cache-demo`
2. Start the router against `router-cache.yaml`
3. Send a direct request to a subgraph with `-H "X-Artificial-Latency: 500"` and verify it
   takes ~500ms longer to respond
4. Send a request through the router with the same header → verify propagation by observing
   the same latency
5. In the playground, add the header and run a query → verify subgraph fetches in the ART view
   show ~500ms load durations
6. Run the cache explorer with `X-Artificial-Latency: 200` set → verify cached phase shows
   near-zero subgraph latency after the first request, uncached phase shows ~200ms+ per request

## Key Differences From Original Plan

1. **No `DevelopmentMode` plumbing needed** — the disable headers already landed and use
   `reqCtx.operation.traceOptions.Enable` for gating, which is cleaner. The prefix header
   will use the same gate.
2. **Most of the disable header work is already done** — only the prefix header is new.
3. **`CacheMode` already exists and is reused** — the explorer does NOT have its own cache
   mode selector. The existing `CacheControl` dropdown in the toolbar drives the comparison:
   whatever the user picks becomes the "cached" side of the A/B test, always compared
   against "cache disabled".
4. **Play button integration, not a separate Run button** — the explorer runs when the user
   clicks the regular GraphiQL play button while in Cache Explorer view. `graphiQLFetch`
   intercepts based on current view and dispatches to the explorer runner instead of a
   single fetch. This keeps the UX consistent with the rest of the playground.
5. **No `GlobalCacheKeyPrefix` composition concern** — the existing code already reads
   `h.entityCaching.GlobalKeyPrefix`; we just prepend the per-request prefix when present.
6. **The cache summary helpers already exist** (`collectCacheSummary`, `CacheBadge`) —
   the explorer runner extracts similar metrics but needs its own walker because it
   needs per-entity-type breakdown and byte counts.
