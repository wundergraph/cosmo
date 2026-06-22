# Audit findings to verify — PR #1464 @defer/@stream conformance (graphql-go-tools)

Source: `Incremental Delivery (@defer/@stream) Conformance Audit … PR #1464`.
We verify whether each finding reproduces in **our shipped engine** (`graphql-go-tools/v2 rc.267`, used by the cosmo router on `localhost:3002`, run under `-race`). The audit's line numbers are for its own baseline commit — confirm the *mechanism* by code structure in our version, not exact line.

Verification classes:
- `REPRODUCED_HTTP` — observable symptom reproduced against the live demo router (write a RED TS test).
- `CONFIRMED_IN_SOURCE_ONLY` — mechanism confirmed present in our rc.267 engine source, but not triggerable through the demo's HTTP path (no authorizer / rate-limiter / custom-renderer / writer-flush-error / mutation-subscription configured).
- `NOT_PRESENT` — mechanism not found in our version / does not reproduce.
- `NEEDS_CONFIG` — would reproduce only with extra router config (note exactly what).

Demo facts: schema/data in `../../docs/DESIGN.md` + `FIXTURES.md`. Known reachable error: `user(id:"u1").reviews` includes a review whose `article` is null → non-null violation (recoverable subgraph error in a deferred fetch). No authorizer/rate-limiter/custom-FieldValueRenderer wired; no mutation/subscription root. Existing confirmed bugs (for overlap mapping): BT-1 (`__typename`-defer nulls parent), BT-2 (parallel-defer data race — likely == SYS-REQ-796), BT-3 (nested/overlapping defer never delivers + no terminal — likely a manifestation of the termination cluster), B1 (`@defer(if:$var=false)` still streams), B6 (dup label accepted), B7 (`@defer(if:$strVar)` not type-checked).

---

## Termination cluster (client hang + data-loss) — resolveDeferSingle return paths

### F01 · KI-DEFER-RECOVERABLE-ERROR-DROPS-DEFERS · SYS-REQ-780 · HIGH
A RECOVERABLE initial-response error (any subgraph error, or a non-null violation on a NULLABLE field) early-returns at `resolve.go` `if resolvable.hasErrors() { return }` BEFORE the DeferTree is resolved. `hasErrors()` doesn't distinguish recoverable from fatal, so deferred fields are PERMANENTLY DROPPED and no terminal frame is emitted.
PROBE: `{ a: <nullable field that errors>  ... @defer { b } }` → exactly ONE payload, `b` never delivered, no `hasNext:false`.
Demo: find/construct a nullable field that produces a recoverable error alongside a sibling `@defer`.

### F02 · KI-DEFER-STREAM-UNTERMINATED-ON-INITIAL-ERROR · SYS-REQ-781 · MEDIUM
`writer.Complete()` is registered AFTER the initial-render early-return and initial-flush early-return; on either path `Complete()` is never called → no terminating multipart boundary → client hangs + goroutine leak.
PROBE (audit): a writer whose `Flush()` errors drives the early return. Client cannot easily induce a writer flush error → likely `CONFIRMED_IN_SOURCE_ONLY`.

### F03 · KI-DEFER-GROUP-FETCH-ERROR-NO-TERMINATION · SYS-REQ-793 · HIGH
`resolveDeferSingle` returns the `groupLoader.ResolveFetchNode` error BEFORE the atomic `remaining` decrement → failing group never decrements, no node computes `isLast`, no `hasNext:false`. Under a PARALLEL node the error is SWALLOWED (request returns success) while a sibling emits `hasNext:true`.
PROBE: single deferred group whose **pre-fetch rate-limiter** (loader.go) or **pre-fetch authorizer** errors → ONE frame `{pending,hasNext:true}`, no terminal. Demo has neither configured → likely `NEEDS_CONFIG`/`CONFIRMED_IN_SOURCE_ONLY`. Check overlap with BT-3.

### F04 · KI-DEFER-DEFERRED-RENDER-AUTH-ERROR-NO-TERMINATION · SYS-REQ-794 · HIGH
A deferred-render AUTHORIZER HARD error (`AuthorizeObjectField` returns non-nil error, NOT a deny) makes `ResolveDefer` return before the per-defer envelope `lBrace`; nothing written; the atomic decrement already consumed this leaf's `isLast` token → no terminal. Parallel node SWALLOWS → orphaned pending.
PROBE: single deferred object field, `AuthorizeObjectField` errors → one frame `{pending,hasNext:true}`, no terminal. Demo has no authorizer → `NEEDS_CONFIG`/`CONFIRMED_IN_SOURCE_ONLY`. Check overlap with BT-3.

### F05 · KI-DEFER-RENDER-PHASE-PRINTERR-NO-TERMINATION · SYS-REQ-795 · HIGH
After the envelope `lBrace`, the render walk can set `r.printErr` from (a) custom `FieldValueRenderer.RenderFieldValue` error, (b) writer Write error, (c) astjson parse error. Once set, `printHasNext` NO-OPs (`if r.printErr != nil { return }`) → partial frame, `Flush` skipped, no terminal.
PROBE: single deferred scalar, custom FieldValueRenderer errors → one frame `{pending,hasNext:true}`, no terminal. Demo has no custom renderer → `CONFIRMED_IN_SOURCE_ONLY`.

---

## Parallel @defer path

### F06 · KI-DEFER-UNBOUNDED-FANOUT-DOS · SYS-REQ-779 · HIGH
Parallel branch of `resolveDeferTree` spawns each sibling defer group under a plain `errgroup.Group` with NO `SetLimit`; the `maxConcurrency` semaphore is acquired ONCE per request, not per sibling. N sibling `@defer` = N goroutines + N outbound fetches regardless of maxConcurrency. `loader.resolveParallel` likewise unbounded; nesting depth unbounded.
PROBE: N=64 siblings with maxConcurrency=4 → peak in-flight Loads = 64, not 4. Demo: send a query with many sibling `@defer` fragments hitting a slow subgraph (reviews/recommendations sleep ~150ms); measure peak concurrent inbound requests at that subgraph (instrument the subgraph with an atomic in-flight counter, or infer from wall-clock vs ceil(N/limit)*latency). `REPRODUCED_HTTP` if peak >> configured limit.

### F07 · KI-DEFER-PARALLEL-SHARED-TREE-DATA-RACE · SYS-REQ-796 · MEDIUM-HIGH
Sibling defer groups share one response-tree (`DataBuffer`); its lock serializes only WRITES (merges). Each group's FETCH phase runs with the lock RELEASED and READs shared parent-node members (`loadEntityFetch`/`loadSingleFetch`/`loadBatchEntityFetch` → astjson) while a sibling MERGES into that same node under its own lock → reader-without-lock vs writer-with-lock data race.
PROBE: `user(id:"u1"){ ... @defer { <field from subgraph A> } ... @defer { <field from subgraph B> } }` (two sibling defers on the SAME entity from DIFFERENT subgraphs) under `-race` → DATA RACE. **Very likely == BT-2** (already reproduced). `REPRODUCED_HTTP` via `/tmp/router-race.log`.

---

## Planner

### F08 · KI-DEFER-ASSIGNDEFER-UNDEFINED-FIELD-PANIC · SYS-REQ-778 · MEDIUM
`index out of range [-1]` in `assignDefer` (empty `fieldStack`, asymmetric Enter/Leave) on an undefined field — but GATED OUT of the request path: `Planner.Plan` rejects the undefined field first (validator + nodesResolvableVisitor), so `Plan` returns hasErr=true with no panic. Reachable only by driving the planning Visitor directly (embedder).
VERIFY: confirm via HTTP that a query with an undefined field inside `@defer` is cleanly rejected (no 500/panic) → the latent gap is NOT request-path reachable. Expect `CONFIRMED_IN_SOURCE_ONLY` (latent; a clean-rejection HTTP test would be GREEN, so note no meaningful RED HTTP test).

---

## Validation / timing

### F09 · KI-DEFER-IF-VARIABLE-NOT-DEFERRED · SYS-REQ-761 · MEDIUM
`@defer(if:$var)` is evaluated at NORMALIZATION before variables bind → a variable `if` always reads false → fragment collapsed into the initial response instead of deferred. Literal `if:true|false` is correct.
PROBE: `query($d:Boolean!){ article(id:"a1"){ id ... @defer(if:$d){ reviews{id} } } }` with `{"d":true}` → EXPECT multipart with a `pending` for the deferred fragment; ACTUAL = single inline response, reviews in initial, no pending. `REPRODUCED_HTTP`. (Same root cause as B1.)

### F10 · KI-DEFER-NO-LABEL-VALIDATION · SYS-REQ-762 · MEDIUM
No rule enforces `@defer/@stream` label constraints (unique across operation; not a variable). Colliding labels admitted; variable label admitted unchecked.
PROBE: (a) two `@defer(label:"dup")` → accepted, both pending carry `label:"dup"` (no validation error). (b) `@defer(label:$l)` → spec-forbidden, should be a validation error. `REPRODUCED_HTTP`. (Overlaps B6/B7.)

### F11 · KI-DEFER-NO-ROOT-PROHIBITION · SYS-REQ-763 · MEDIUM
No rule rejects `@defer/@stream` on mutation/subscription root fields, nor an unconditional subscription defer. Silently accepted, planned into spec-undefined behavior.
VERIFY: demo schema has NO mutation/subscription root → not directly reachable on the demo. Confirm validator (`DefaultOperationValidator`) lacks the rule in our version, and/or note `NEEDS_CONFIG` (would need a schema with a mutation/subscription). `CONFIRMED_IN_SOURCE_ONLY` likely.

---

## @stream (definition shipped, not wired)

### F12 · KI-STREAM-NOT-EMBEDDED · SYS-REQ-776/777/786/787 · MEDIUM
`@stream` definition is an orphan file never `//go:embed`-ed into the base schema → every `@stream` query is hard-rejected at validation as `directive: stream undefined`.
PROBE: `{ articles @stream(initialCount: 1) { id } }` (or `@stream` on any list field) → validation error "unknown directive stream". `REPRODUCED_HTTP`.

### F13 · KI-STREAM-DEF-NONNULL · SYS-REQ-776 · LOW
`@stream`'s `initialCount` is declared nullable `Int = 0` where the spec mandates `Int! = 0`. No runtime manifestation (stream not embedded).
VERIFY: read the `stream.graphql` definition in the engine source; confirm `initialCount: Int = 0` (nullable). `CONFIRMED_IN_SOURCE_ONLY` (definition-shape; not HTTP-observable).

### F14 · KI-STREAM-UNIMPLEMENTED · SYS-REQ-777/790/791 · LOW
No execution path: `resolve.StreamField` is a dead struct, no planner sets `Field.Stream`, no resolver reads it. A `@stream` query fails validation (unknown directive) rather than mis-behaving.
VERIFY: same HTTP observable as F12 (`@stream` rejected); confirm in source that `StreamField` is unread / planner branch absent. `CONFIRMED_IN_SOURCE_ONLY` for the dead-code part; `@stream`-rejected is HTTP-observable.

---

## Error-report integrity & wire-shape (LOW)

### F15 · KI-DEFER-DUPLICATE-AUTH-ERROR-TWO-PASS · SYS-REQ-782 · LOW
`ResolveDefer` walks the object tree TWICE (pre-walk + render pass). For a PASS-THROUGH ANCESTOR object field (no matching defer id, walked only to reach a deeper deferred field), `render()` is false in BOTH passes, so a field-error append guarded by `if !r.render()` fires in BOTH → DUPLICATED. Confirmed for (1) auth reject, (2) invalid `__typename`, (3) non-nullable-null.
PROBE: a query where a deferred fragment sits under an ancestor whose field errors (non-nullable-null is reachable in the demo) → the SAME field error appears TWICE in the deferred frame. `REPRODUCED_HTTP` if count==2.

### F16 · KI-DEFER-EAGER-PENDING-ANNOUNCEMENT · SYS-REQ-773/775 · LOW
Nested defer pending notices announced EAGERLY in the initial frame rather than lazily on parent release (eager set is a strict superset; no starvation, no orphaned id).
PROBE: nested `@defer` (defer-within-defer) → the initial frame's `pending` already contains the INNER defer's id. `REPRODUCED_HTTP` (we saw this in DT-08). Note: wire-shape divergence vs graphql-js, not a correctness defect.

### F17 · KI-DEFER-LIST-PATH-TRUNCATION · SYS-REQ-769 · LOW
A list-nested defer's `pending.path` is truncated at the outermost list field (no per-element index); the index is carried in `subPath` instead. Reconstructable via `path ++ subPath`.
PROBE: `@defer` on a field of list elements (e.g. `articles { ... @defer { reviews } }`) → `pending.path` ends at the list field, incremental items carry `subPath:[<index>]`. `REPRODUCED_HTTP` (DT-15 data).

### F18 · KI-DEFER-ONE-ID-PER-AST-DEFER · SYS-REQ-770 · LOW
A `@defer` nested in an N-element list is delivered under ONE id (one `completed` closes the whole list), where graphql-js v17 mints one id per element. No data loss; per-element completion granularity lost.
PROBE: `@defer` over N list elements → exactly ONE `pending` id and ONE `completed` for all N. `REPRODUCED_HTTP` (DT-13/15 data).

---

## Regression

### F19 · KI-DEFER-PR-DROPPED-DIRECTIVE-HANDLING · SYS-REQ-252/777 · LOW (regression)
The defer PR emptied `Visitor.EnterDirective` (visitor.go), dropping the pre-PR `@flushInterval` (and `@stream`) planning branches. `@flushInterval` is now silently ignored — a per-operation flush-cadence override that used to be honored; operators must use `Config.DefaultFlushIntervalMillis`. No crash, no data loss.
VERIFY: confirm in source that `EnterDirective` no longer handles `@flushInterval`; HTTP-observing a flush-cadence change is impractical. `CONFIRMED_IN_SOURCE_ONLY` likely.
