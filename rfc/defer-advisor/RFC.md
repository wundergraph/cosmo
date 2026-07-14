# RFC: Defer Advisor — automatic @defer placement suggestions

Status: implemented locally and verified end-to-end (router tests + live router binary + router and Studio playground clients); publish and production-ingress verification pending.
Branch: `auto-improve-queries-with-defer` (base includes @defer support).

## Measured results (defer demo, 2026-07-02)

Query touching catalog (10ms) + pricing (price 30ms, priceHistory 700ms, ONE fetch)
+ reviews (reviews 250ms, ratingSummary 40ms, ONE fetch):

- Per-field attribution within multi-field fetches: priceHistory 702.7ms vs price 32.4ms,
  reviews 253.1ms vs ratingSummary 42.6ms — separated correctly, ~3ms overhead.
- Suggestions: defer `priceHistory` and `reviews`. Savings are attributed by a
  layered peel (slowest critical-path tier first, tied tiers split their joint
  drop): priceHistory ~450ms, reviews ~210ms, summing to the joint drop of the
  initial response to ~50ms.
- Validation & wire check (raw Go HTTP client against the real router binary):
  initial part at 57.6ms (baseline 761ms → 13x faster first byte),
  reviews part at 310ms, priceHistory part at 761ms.

Implementation: router-owned advisor orchestration in `router/core/defer_advisor*.go`
(mounted in `graph_server.go`). Complete ART and response extensions for the
optimized deferred execution additionally require the defer-aware execution tree
and terminal extension support in `graphql-go-tools`.
Demo: `demo/defer-demo/` (README) + `demo/pkg/subgraphs/{catalog,pricing,reviews,deferdemo}`.
Tests: `router-tests/protocol/defer_advisor_test.go`, `defer_demo_smoke_test.go`.

## Problem

@defer is shipped, but users don't know *what* to defer.
The router already knows which fields come from which fetch and subgraph (query plan),
and can measure per-fetch latency (ART).
Nobody has connected the two into an answer to "where should I put @defer?".

## Feature name

**Defer Advisor** (working name; alternatives considered: defer optimizer, latency profiler).
"Advisor" captures the semantics: it advises where to place @defer, it doesn't change execution.

## Protocol

Client sends a **normal GraphQL request** (no defer, plain `application/json` Accept) with:

- `X-WG-Defer-Advisor: enable` — turns on advisor mode.
- `X-WG-Defer-Advisor-Runs: 5` — optional, number of profiling runs (default 3, capped).

Response is a normal single JSON response (data from the last run) plus
`extensions.deferAdvisor`:

```jsonc
{
  "data": { ... },
  "extensions": {
    "deferAdvisor": {
      "runs": 5,
      "totalDurationMs": { "avg": 812, "min": 790, "max": 850 },
      "fetches": [
        {
          "fetchId": 0, "subgraph": "employees", "path": "",
          "durationMs": { "avg": 12, "min": 10, "max": 15 },
          "fields": ["employees.id", "employees.details.forename"]
        },
        {
          "fetchId": 1, "subgraph": "hobbies", "path": "employees.@",
          "dependsOn": [0],
          "durationMs": { "avg": 800, "min": 780, "max": 830 },
          "fields": ["employees.hobbies"]
        }
      ],
      "suggestions": [
        {
          "label": "hobbies_1",
          "path": "employees",
          "subgraph": "hobbies",
          "fields": ["hobbies"],
          "estimatedFirstResponseSavingMs": 788
        }
      ],
      "optimizedQuery": "query { employees { id details { forename } ... @defer(label: \"hobbies_1\") { hobbies } } }",
      "validation": {
        "initialResponseMs": 14,
        "deferredParts": [ { "label": "hobbies_1", "arrivedAtMs": 802 } ]
      }
    }
  }
}
```

This shape works unchanged for the playground (render waterfall + "apply optimized query" button)
and for an LSP (code lens with avg ms per field, quick-fix inserting @defer).

## Measurement model: two granularities

**Per-fetch (baseline):** ART records per-fetch wall time (`duration_load_nanoseconds`)
and the dependency tree.
Profiling the ORIGINAL query N times with ART yields per-fetch latency and the critical path.

**Per-field (attribution):** a fetch can provide multiple fields;
if one of them is slow, the fetch duration alone cannot say which.
The key insight: deferring a field SPLITS the fetch —
the deferred fragment becomes its own subgraph fetch (own Loader, engine-verified),
and sibling deferred groups execute their fetch I/O in parallel,
starting after the initial part is flushed.
So the advisor generates a **max-split profiling variant**:
every candidate field wrapped in its own `... @defer(label: "advisor:<fetchId>:<field>")`,
runs it R times with `Accept: multipart/mixed`,
and timestamps part emission in the router-owned response writer.
`arrival(label) − arrival(initial part)` ≈ that single field's resolution latency
(the deferred fetch resolves only that field).

Part-emission timing is measured by the router-owned defer loopback recorder, so
field attribution does not depend on ART timing. The optimized validation response
can nevertheless carry progressive ART: the initial part describes primary work,
and the `hasNext: false` part carries the authoritative primary-plus-deferred trace.
The advisor consumes only part timestamps and labels from that response and does
not expose profiling-run ART as if it represented one coherent client execution.

## Architecture

New middleware in the graphql handler chain (`router/core/defer_advisor.go`):

1. Detect header; if absent, pass through. Gate like ART (dev mode / signed token / config flag).
2. **Structure** (1 loopback run): `X-WG-Include-Query-Plan` → fetch tree
   (subgraph, path, dependsOn, subgraph query);
   map each fetch to the client-query fields it provides
   (root fetch → its selections; entity fetch at path P → entity-fragment selections under P).
3. **Baseline** (N loopback runs): ART forced on (`X-WG-Trace`) →
   per-fetch duration stats + total duration + critical path.
4. **Attribute** (N loopback runs): rewrite the operation into the max-split defer variant
   (each candidate field in its own labeled defer),
   run with `Accept: multipart/mixed` through a part-timing response recorder →
   per-FIELD latency stats.
5. **Suggest**: fields whose latency dominates the critical path get deferred;
   fields from the same fetch with similar slow latencies cluster into one defer group
   (avoids needless extra subgraph calls);
   estimated saving = criticalPath(all) − criticalPath(without deferred groups).
   Threshold is relative to the base round trip: a field's latency must exceed
   the floor (the fastest measured field) by ≥ 50ms and ≥ 20% of the avoidable
   latency, so a uniform network base latency does not turn every field into a
   suggestion.
6. **Rewrite**: AST-edit the client operation (graphql-go-tools astparser/astprinter as library):
   wrap suggested field groups in `... @defer(label: "<subgraph>_<path>_<field>")`
   (the path is included so the same field served at two paths gets distinct labels).
7. **Validate** (final loopback run): run the optimized query with multipart part timing,
   report measured initial-response time + per-label arrival times.
8. Respond with last baseline run's data + `extensions.deferAdvisor`
   (now including per-field stats, not just per-fetch).

The loopback design keeps the entire feature in one new file + a mount point;
the regular pipeline is untouched.

## Demo & tests

Requirement: a single fetch bundles multiple fields, so the demo MUST inject latency
per FIELD (dedicated field resolvers with individual sleeps),
not per subgraph, and the tests MUST prove the advisor attributes latency
to the correct individual field within a multi-field fetch.

- Dedicated "defer demo": 3 subgraphs in demo style with per-field resolver sleeps
  defined in one shared latency table (visible to tests for assertions).
  Example: subgraph A serves `Query.x` fast; subgraph B serves entity fields
  `T.cheap` (10ms) and `T.expensive` (800ms) in ONE fetch;
  subgraph C serves `T.medium` (300ms).
  Advisor must single out `T.expensive` — not "subgraph B" — and suggest deferring it alone.
- router-tests: composed config for the defer demo; assert suggestion structure,
  field attribution ranking, and that the optimized query is valid and runs.
  Timings normalized to buckets before full-struct equality assertions.

## Open questions / later

- Deferred-fetch latency includes entity key-resolution overhead in the subgraph;
  acceptable noise for advisory purposes.

> The "SHIPPED" entries below are a dated implementation log kept for context.
> Some UI details were later superseded (notably the per-subgraph rainbow colors
> and hover zones, replaced by a single latency-severity scale — green/amber/red
> graded on the floor-invariant saving). The code is the source of truth.
- Playground panel: SHIPPED (2026-07-02) — "Defer Advisor" view in the playground
  view dropdown (`playground/src/components/playground/defer-advisor-view.tsx`):
  analyze button + runs selector, before/after stat cards, per-field latency bars,
  suggestion cards with one-click Apply (client-side graphql-js rewrite mirroring the
  router rewriter, written into the editor via the CodeMirror instance), measured
  delivery timeline. Three router fixes fell out of dogfooding it:
  advisor headers added to default CORS allowlist (`core/router.go`);
  multipart boundaries now start with CRLF (`defer_response_writer.go`) because
  meros (graphiql/Apollo Client's multipart parser) merges coalesced parts otherwise —
  a real client-compat bug; all 65 defer fixtures regenerated.
  And the big one: each flush now ENDS with the next boundary (eager delimiter).
  A multipart parser can only complete part N when it sees the boundary AFTER it,
  so writing boundaries at the start of the next part made every client render
  one part late — the initial response only painted when the first deferred part
  arrived (measured in GraphiQL: first paint 326ms instead of 77ms), silently
  erasing defer's first-byte win for real clients despite perfect server-side
  streaming. Wire bytes unchanged (fixtures identical), only write scheduling moved.
  The playground's custom fetch also now passes multipart responses through
  so executing @defer queries streams into the response pane.
  Fourth find (playground-side): GraphiQL's incremental merger predates the
  deferSpec-20220824 format — entries addressed by id+subPath (resolved via the
  pending map) were merged at the data root instead of into the deferred
  position. Fixed by wrapping the fetcher
  (`playground/src/components/playground/incremental-merge.ts`): parts are
  merged spec-correctly on our side and yielded as clean {data, errors}
  snapshots, so GraphiQL's broken merger never engages and the pane renders the
  correctly assembled response progressively (verified: deferred result
  canonically equal to the non-deferred baseline, paints at 129/376/825ms).
  Note the toolkit's multipart fetcher yields BATCHES of parts (meros multiple
  mode) — flatten before merging.
  LSP: code lens via the same header — still open (but see inline annotations below,
  which prove the interaction model in the playground editor).
- Inline editor annotations: SHIPPED (2026-07-03) — VSCode-style inlay pills in the
  query editor (`playground/src/components/playground/defer-inline.ts`).
  While the typed operation is valid, a debounced background advisor call
  (`X-WG-Defer-Advisor-Runs: 1`) measures it; every field gets a pill with a
  subgraph-colored dot + underline (fetch boundaries), its measured latency
  (amber when defer-worthy), and a clickable "defer" action that rewrites the
  query in place. Root-fetch fields are tagged "initial" (not deferrable).
  Since the advisor rejects pre-deferred operations, once @defer is present the
  cached measurement is re-projected onto the live AST (positions from graphql-js
  loc via CodeMirror posFromIndex) and deferred fields render "✓ deferred" —
  so annotations survive the rewrite and sequential defer clicks work.
  Toolbar toggle (timer icon) disables the background measuring.
  Caveat: the first analysis after a router boot is a single cold sample.
  v2 (same day): the router strips existing @defer directives instead of
  rejecting (`stripDeferDirectives`), so deferred operations are re-measured
  live; the inline advisor refreshes every 3s (busy-skip loop); deferred
  fields carry an "un-defer" action (client-side inverse rewrite); and fetch
  boundaries are drawn as line blocks — every line is tinted + railed in the
  color of the innermost fetch that serves it, so contiguous lines fuse into
  per-fetch blocks and non-contiguous fields of one fetch share a color.
  v3 (same day): defer rewrites are in-place (the fragment replaces the field's
  position instead of moving to the end of the selection set, both router- and
  playground-side); and same-fetch groups are connected WITHOUT geometry —
  right-margin bracket columns were tried and rejected as cluttered. Final:
  each block's head pill names its subgraph in the fetch color (two blocks
  reading "pricing" are the connection), and hovering anywhere over a fetch's
  lines highlights every block of that fetch (stronger tint + thicker rail),
  IDE symbol-occurrence-style.
  v4 (same day): fragment support end-to-end. The router's rewriter resolves
  fields through fragment spreads and wraps @defer inside the fragment
  definition (spread untouched, fragment keeps working wherever it's used;
  label suffixes when a group spans multiple sets); the playground resolves
  positions into fragment definitions, annotates fields there, tints
  spread-target fragment blocks with their fetch color, and defer/un-defer
  work on fragment fields. Previously the max-split rewrite failed on spreads
  and the advisor silently degraded to fetch-level stats.
  v5 (same day): advisor latency restructure — the fetch model comes from a
  plan-only loopback (loader skipped, milliseconds), baseline and max-split
  runs execute concurrently, and X-WG-Defer-Advisor-Skip-Validation lets
  stats-only clients (the inline advisor) skip the validation execution;
  page-open to first inline stats dropped from ~3s to ~0.7s. Concurrency
  surfaced a real loopback bug: sub-requests inherited chi's RouteContext via
  the parent context and chi reuses it — masked with a nil RouteCtxKey value so
  every loopback gets a fresh routing context. Hover highlights now survive the
  periodic re-measurement (hovered subgraph tracked across renders).
  v6 (same day): opportunity visibility. A code-lens chip above the operation
  summarizes open optimizations ("⚡ 2 defer opportunities · first response
  ~660ms sooner · apply all", green check once applied), defer-worthy fields
  carry amber call-to-action pills with the payoff ("⚡ defer −451ms TTFB"),
  fragment-definition blocks adopt their content's fetch color uniformly,
  per-color tint alphas equalize perceived brightness on dark themes, and the
  hover highlight is re-derived from the actual pointer position after each
  re-measurement (can neither vanish under a resting pointer nor stick after
  leaving).
- Toolbar timing pill: SHIPPED (2026-07-03) — every request shows
  `[micro-timeline] TTFB · total` next to the status badge
  (`fetch-timing.ts` + `RequestTimingStats` in `index.tsx`).
  TTFB = first streamed part; the micro-timeline's green segment sits at the
  ttfb/total fraction, so a deferred query (short sliver, TTFB 58ms · total 762ms)
  vs a plain one (solid bar, 730ms · 732ms) demonstrates at a glance that @defer
  cuts TTFB while total latency stays the same.
- Caching advisor results keyed by operation hash; sampling production traffic instead of replaying.
