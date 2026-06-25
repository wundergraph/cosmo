import { describe, it } from "vitest";

/**
 * F03 · KI-DEFER-GROUP-FETCH-ERROR-NO-TERMINATION · SYS-REQ-793
 *
 * Finding: `resolveDeferSingle` returns the `groupLoader.ResolveFetchNode` error
 * BEFORE it reaches the atomic `remaining` decrement. The failing leaf therefore
 * never decrements `remaining`, so NO node ever computes `isLast == true`, and
 * `hasNext:false` (the terminal frame) is never written. Under a PARALLEL defer
 * node the returned error is SWALLOWED (the request still returns success) while a
 * sibling group emits `hasNext:true` — leaving an orphaned `pending` and a client
 * hang.
 *
 * Engine evidence (CONFIRMED present in our rc.267):
 *   resolve/resolve.go resolveDeferSingle (func @ line 569):
 *     line 578:  if err := groupLoader.ResolveFetchNode(group.Fetches); err != nil {
 *     line 579:      dc.db.Lock()
 *     line 580:      groupLoader.appendSubgraphErrorsToContext()
 *     line 581:      dc.db.Unlock()
 *     line 582:      return err                              // <-- early return
 *     line 583:  }
 *     line 589:  isLast := syncatomic.AddInt64(remaining, -1) == 0  // <-- NEVER reached on err
 *     line 606:  dc.resolvable.ResolveDefer(... , !isLast)          // writes hasNext:false when isLast
 *
 *   So a fetch-phase Go error short-circuits BEFORE the decrement at line 589:
 *   the leaf's `isLast` token is never consumed, no group ever sees remaining==0,
 *   and no terminal frame is emitted.
 *
 *   resolve/resolve.go resolveDeferTree PARALLEL branch (func @ line 617):
 *     line 645:  err := r.resolveDeferTree(dc, ctx, child, remaining)
 *     line 650:  if err != nil && ctx.ctx.Err() != nil {           // only surface on client disconnect
 *     line 651:      return err
 *     line 652:  }
 *     line 653:  return nil                                         // <-- otherwise SWALLOWED
 *
 *   So under a Parallel node the failing group's error is discarded unless the
 *   client context was cancelled; the request returns success with a dangling
 *   pending id. Mechanism present in rc.267 exactly as the audit describes.
 *
 * What actually makes `ResolveFetchNode` return a non-nil Go error (the trigger):
 *   resolve/loader.go loadSingleFetch (func @ line 1351) / validatePreFetch
 *   (func @ line 1340):
 *     line 1381: allowed, err := l.validatePreFetch(fetchInput, fetch.Info, res)
 *     line 1382: if err != nil { return err }               // <-- the ONLY pre-merge Go-error path
 *   validatePreFetch returns a non-nil err only from:
 *     (a) l.ctx.authorizer.AuthorizePreFetch(...) returning err  (loader.go:1306-1309)
 *     (b) l.ctx.rateLimiter.RateLimitPreFetch(...) returning err (loader.go:1327-1330)
 *   plus an astjson merge mismatch (ErrMergeResult) in mergeResult.
 *
 *   Crucially, an ordinary subgraph/transport failure is NOT a Go error here:
 *   `executeSourceLoad` (loadSingleFetch line 1388) sets `res.err`, and
 *   mergeResult -> renderErrorsFailedToFetch RENDERS it and returns nil
 *   (loader.go:536-537). An authorizer/rate-limiter DENY (reject, not err) is
 *   likewise rendered via res.authorizationRejected / res.rateLimitRejected and
 *   returns nil. Only a HARD authorizer/rate-limiter error propagates.
 *
 * Why there is NO live RED test possible on the demo (CONFIRMED_IN_SOURCE_ONLY):
 *   - The demo router (defer-demo/config.json + graph.yaml) wires NO authorizer
 *     and NO rate-limiter, so l.ctx.authorizer and l.ctx.rateLimiter are nil and
 *     validatePreFetch always returns (true, nil) — line 1382 never fires.
 *   - For QUERY operations, isFetchAuthorized short-circuits to (true, nil)
 *     regardless (loader.go:1288-1296: only Mutation/Subscription root fields are
 *     pre-fetch-authorized at the load level), and the demo has no mutation /
 *     subscription root.
 *   - The demo's only known reachable deferred-fetch error — user(id:"u1").reviews
 *     containing a review whose `article` is null -> non-null violation — is a
 *     RECOVERABLE subgraph error: it is rendered (res.err -> renderErrorsFailedToFetch
 *     returns nil), so ResolveFetchNode returns nil, the decrement runs, and the
 *     terminal frame IS emitted. VERIFIED via HTTP probe (/tmp/F03.mjs):
 *       query: { user(id:"u1"){ id ... @defer { reviews { id rating article { id title } } } } }
 *       observed: frame0 {data,pending,hasNext:true}; frame1 {incremental:[],completed:[{id:1}],hasNext:false};
 *                 stream ends with the final --graphql-- boundary.
 *     i.e. F03's `return err` path is NOT exercised by any demo-reachable error.
 *
 *   Triggering F03 over HTTP would require ADDING router config that wires an
 *   authorizer or rate-limiter whose pre-fetch hook returns a HARD error (not a
 *   deny) on a deferred group's subgraph fetch — NEEDS_CONFIG territory, outside
 *   the demo's wiring. No deterministic wire-level RED test can be written against
 *   localhost:3002 as configured.
 *
 * Overlap: sibling of the termination cluster (F01/F02/F04/F05 — all "fetch/render
 * error before the hasNext/terminal frame"). The observable symptom (one
 * {pending,hasNext:true} frame, no terminal, client hangs / orphaned pending)
 * matches BT-3's "never delivers + no terminal" family, but BT-3's reproduced
 * trigger is nested/overlapping defer (a pre-walk/render path), NOT a fetch-phase
 * Go error returned before the atomic decrement. Distinct mechanism. Does not map
 * to B1/B6/B7.
 */
// SKIPPED — pre-fetch auth is NOT reachable on this demo: AuthorizePreFetch only fires
// for fetches whose RootFields carry HasAuthorizationRule, which the demo's entity/root
// fetches never set (auth here enforces at AuthorizeObjectField, verified with
// x-defer-sim:authz-prefetch), and the rate-limiter alternative needs a live Redis. The
// SAME termination bug (deferred error -> orphaned pending, no hasNext:false) is
// reproduced LIVE by F04 via `x-defer-sim: authz-objectfield`.
describe("F03 KI-DEFER-GROUP-FETCH-ERROR-NO-TERMINATION (SKIPPED: pre-fetch path not reachable; F04 is the live repro)", () => {
  it.skip(
    "a deferred group whose fetch phase returns a hard Go error (pre-fetch " +
      "authorizer/rate-limiter error, or astjson merge mismatch) should NOT skip " +
      "the atomic `remaining` decrement: the engine must still let some node " +
      "compute isLast and emit exactly one hasNext:false terminal frame (and, " +
      "under a parallel node, must not silently swallow the error leaving an " +
      "orphaned pending id). In rc.267 resolveDeferSingle returns the error at " +
      "resolve.go:582 BEFORE the decrement at resolve.go:589, and the parallel " +
      "branch discards the error (resolve.go:650-653) unless the client " +
      "disconnected. Not HTTP-reproducible on the demo: the only Go-error trigger " +
      "is a hard authorizer/rate-limiter pre-fetch error, and neither is wired; " +
      "the demo's reachable null-article error is recoverable (rendered, " +
      "ResolveFetchNode returns nil) and terminates correctly (verified via HTTP).",
    () => {
      // Intentionally skipped: mechanism confirmed in source (resolve.go:578-583
      // early-return-before-decrement; resolve.go:589 decrement; resolve.go:650-653
      // parallel swallow) but the trigger is not reachable through the demo's HTTP
      // path. Correct (spec-conforming) behavior that a live test WOULD assert, if
      // an authorizer/rate-limiter that returns a hard error on a deferred group's
      // fetch were wired:
      //   - the multipart stream ends with exactly one frame carrying hasNext:false
      //   - the terminating multipart boundary (--graphql--) is written
      //   - the failing group's pending id is completed (with its error rendered),
      //     never left orphaned; no client hang
    },
  );
});
