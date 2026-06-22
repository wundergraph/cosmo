# PR #1464 @defer/@stream audit — independent verification against our shipped engine

Date: 2026-06-22. Verified the 19 defer/stream findings from the *Incremental Delivery Conformance Audit (PR #1464)* against **our shipped engine** (`graphql-go-tools/v2 rc.267`) and the live demo router. One sub-agent per finding: each confirmed the mechanism in our engine source, attempted to reproduce the symptom against the live router, and wrote a RED test. **No fixes were made** — verification + RED tests only. The pre-existing 103-issue backlog in the audit is a separate engagement and was not in scope.

RED tests live in `defer-demo/tests/audit/`. Run: `cd defer-demo/tests && ROUTER_URL=http://127.0.0.1:3002/graphql npx vitest run audit`. For F06, run the router with `ENGINE_MAX_CONCURRENT_RESOLVERS=2` (a low limit) so the fan-out bypass is observable.
Result against the live router (router started with `ENGINE_MAX_CONCURRENT_RESOLVERS=2`): **12 failed (RED, bug reproduced) · 3 passed (controls) · 8 skipped (documented, not demo-reachable)**.

## Verdict per finding

| # | Finding | Sev | Status | RED test |
|---|---------|-----|--------|----------|
| F01 | KI-DEFER-RECOVERABLE-ERROR-DROPS-DEFERS | HIGH | **REPRODUCED (HTTP)** | RED ✓ |
| F02 | KI-DEFER-STREAM-UNTERMINATED-ON-INITIAL-ERROR | MED | **REPRODUCED (HTTP)** | RED ✓ |
| F07 | KI-DEFER-PARALLEL-SHARED-TREE-DATA-RACE (== BT-2) | MED-HIGH | **REPRODUCED (under `-race`)** | RED (needs `-race` router) |
| F09 | KI-DEFER-IF-VARIABLE-NOT-DEFERRED (== B1) | MED | **REPRODUCED (HTTP)** | RED ✓ |
| F10 | KI-DEFER-NO-LABEL-VALIDATION (== B6/B7) | MED | **REPRODUCED (HTTP)** | RED ✓ (2 tests) |
| F12 | KI-STREAM-NOT-EMBEDDED | MED | **REPRODUCED (HTTP)** | RED ✓ |
| F14 | KI-STREAM-UNIMPLEMENTED | LOW | **REPRODUCED (HTTP)** | RED ✓ |
| F16 | KI-DEFER-EAGER-PENDING-ANNOUNCEMENT | LOW | **REPRODUCED (HTTP)** | RED ✓ |
| F17 | KI-DEFER-LIST-PATH-TRUNCATION | LOW | **REPRODUCED (HTTP)** | RED ✓ |
| F18 | KI-DEFER-ONE-ID-PER-AST-DEFER | LOW | **REPRODUCED (HTTP)** | RED ✓ |
| F06 | KI-DEFER-UNBOUNDED-FANOUT-DOS | HIGH | **REPRODUCED** (hard RED; router at `maxConcurrency=2`) | RED ✓ (needs `ENGINE_MAX_CONCURRENT_RESOLVERS=2`) |
| F03 | KI-DEFER-GROUP-FETCH-ERROR-NO-TERMINATION | HIGH | CONFIRMED IN SOURCE (needs authorizer/rate-limiter) | it.skip + engine ref |
| F04 | KI-DEFER-DEFERRED-RENDER-AUTH-ERROR-NO-TERMINATION | HIGH | CONFIRMED IN SOURCE (needs authorizer) | it.skip + engine ref |
| F05 | KI-DEFER-RENDER-PHASE-PRINTERR-NO-TERMINATION | HIGH | CONFIRMED IN SOURCE (needs custom renderer) | it.skip + engine ref |
| F08 | KI-DEFER-ASSIGNDEFER-UNDEFINED-FIELD-PANIC | MED | CONFIRMED IN SOURCE (latent; gated out of request path) | it.skip + engine ref |
| F11 | KI-DEFER-NO-ROOT-PROHIBITION | MED | CONFIRMED IN SOURCE (needs mutation/subscription supergraph) | it.skip + engine ref |
| F13 | KI-STREAM-DEF-NONNULL | LOW | CONFIRMED IN SOURCE (definition shape) | it.skip + engine ref |
| F19 | KI-DEFER-PR-DROPPED-DIRECTIVE-HANDLING (@flushInterval) | LOW (regr) | CONFIRMED IN SOURCE (timing-only) | it.skip + engine ref |
| F15 | KI-DEFER-DUPLICATE-AUTH-ERROR-TWO-PASS | LOW | **NOT REPRODUCED** (mechanism in source; symptom never manifested — demo error appeared once, not twice) | it.skip + engine ref |

Tally: **11 reproduced** (9 over HTTP + 1 under `-race` + F06 under `maxConcurrency=2`), **7 confirmed-in-source-only**, **1 mechanism-present-but-not-observed (F15)**.

## Reproduced live (RED tests fail against the running router)

- **F01 (HIGH)** `{ user(id:"u1"){ id reviews{id article{id}} ... @defer { recommendedArticles{id title} } } }`: the non-deferred `reviews` hits a recoverable subgraph error (review r5 has a null `article`); the engine's `if resolvable.hasErrors() { return }` early-returns before the DeferTree → the deferred payload is **dropped** and the stream is **unterminated** (no `--graphql--`). One frame, no `pending`, no `hasNext`. Client hangs + data loss.
- **F02 (MED)** same early-return path: `writer.Complete()` (the only writer of the closing boundary) is registered after the initial-error returns, so on any initial render/flush/`hasErrors` early-exit the multipart stream gets no terminating boundary. Observed: body ends on an open `--graphql`, never `--graphql--`.
- **F09 (MED, == B1)** `@defer(if:$var)` is decided at normalization before variables bind, so a variable `if` never defers. `@defer(if:$d)` `$d=false` still streams a deferred frame (literal `if:false` correctly collapses — control passes).
- **F10 (MED, == B6/B7)** no label validation: two `@defer(label:"dup")` are accepted (both pending carry `"dup"`); a variable label `@defer(label:$l)` is not cleanly rejected.
- **F12 / F14 (MED / LOW)** `{ articles @stream(initialCount:1){id} }` → `directive: stream undefined`. `@stream` is shipped as an un-embedded orphan definition with no execution path; every `@stream` query is rejected.
- **F16 / F17 / F18 (LOW, wire-shape vs graphql-js)** nested defer pending announced eagerly in the initial frame (F16); list-defer `pending.path` truncated at the list field with the index in `subPath` (F17); a list `@defer` delivered under ONE id rather than one-per-element (F18). All losslessly reconstructable — divergences, not data loss.

## Reproduced under `-race`

- **F07 (MED-HIGH) == BT-2 == SYS-REQ-796.** Two sibling cross-subgraph `@defer` on the same entity (`user{ ...@defer{reviews} ...@defer{recommendedArticles} }`) race: the fetch phase reads the shared response tree (`astjson`) with the merge-lock released while a sibling merges. A true `-race` binary went race-count 0→1 over 60 requests (`astjson.(*Object).Set` ← `MergeValues` ← `Loader.merge`). **Caveat:** the currently-live `:3002` router is **not** race-built (11 tsan symbols), so this test only goes RED against a `-race` router; the `/tmp/router-race.log` from earlier was a stale failed-restart log.

## Confirmed in our engine source, not demo-reachable
The termination-cluster siblings F03/F04/F05 require an authorizer hard-error / rate-limiter rejection / custom `FieldValueRenderer` error that the demo doesn't wire — but the **return-before-decrement / `printErr`-suppresses-`printHasNext`** mechanisms are present in our rc.267 (`resolve.go`/`resolvable.go`), so under those configs the same hang would occur. F08 (planner panic) is latent — `Planner.Plan` rejects the undefined field first, so it's not request-path reachable (a clean rejection was observed). F11 (missing defer-root validation rule) confirmed: `DefaultOperationValidator` registers 18 rules, none for defer on mutation/subscription roots; not reachable because the demo has no mutation/subscription root. F13 (`initialCount: Int` nullable vs spec `Int!`) and F19 (`@flushInterval` handling dropped from `EnterDirective`) are real in source but have no deterministic wire signal on the demo.

## Not reproduced
- **F15 (LOW).** The two-pass non-deduping append is present in `resolvable.go`, but across five probe shapes the demo's only reachable field error (the non-null `article` violation) appeared **exactly once**, never duplicated in a deferred frame. The duplication trigger (an error on a *pass-through ancestor* of a deferred field) was not drivable on this schema. Mechanism plausible, symptom unconfirmed — do not claim it without a reproducer.

## F06 — now a hard RED
With the router started at `ENGINE_MAX_CONCURRENT_RESOLVERS=2`, a query with 5 sibling `@defer` fetches still completes in ~1 wave: baseline single-defer `t1 ≈ 155ms`, five-sibling `t5 ≈ 158ms`, ratio `≈ 1.0`. A limit-respecting engine would throttle to 2-at-a-time → `ceil(5/2)=3` waves → ratio `≈ 3.0`; the test asserts `ratio ≥ 2.0` and fails (RED) today. The per-request `maxConcurrency` semaphore is never re-acquired by the sibling defer goroutines. Both unbounded `errgroup` sites (no `SetLimit`) confirmed in our rc.267 source (`resolve.go` defer branch + `loader.go` resolveParallel).

## Notes
- Overlaps with the prior battle-test: F07==BT-2, F09 root cause==B1, F10==B6/B7, and F01/F02 are the error-path origin of the BT-3 termination family.
