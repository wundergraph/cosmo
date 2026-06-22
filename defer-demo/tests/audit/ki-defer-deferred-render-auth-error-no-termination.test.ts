import { describe, it } from "vitest";

/**
 * F04 · KI-DEFER-DEFERRED-RENDER-AUTH-ERROR-NO-TERMINATION · SYS-REQ-794
 *
 * Finding: when an AUTHORIZER returns a HARD error (an error value, NOT an
 * AuthorizationDeny result) for a field reached during the FIRST (pre-walk) pass
 * of a deferred fragment, `ResolveDefer` returns that error BEFORE writing the
 * per-defer envelope `lBrace`. Nothing is written for this defer. Meanwhile the
 * atomic `remaining` counter has ALREADY been decremented (consuming this leaf's
 * chance to become the `isLast` node that emits `hasNext:false`). Under a Parallel
 * defer node the returned error is SWALLOWED, so the request "succeeds" with an
 * orphaned `pending` id and NO terminal frame — the client hangs.
 *
 * Engine evidence (CONFIRMED present in our rc.267):
 *
 *   resolve/resolvable.go authorizeField (func @ line 1198):
 *     line 1218:  result, authErr := r.authorize(value, dataSourceID, gc)
 *     line 1219:  if authErr != nil {
 *     line 1220:      r.authorizationError = authErr   // HARD error stashed (distinct from a deny)
 *     line 1221:      return true
 *     line 1222:  }
 *     (the `result != nil` branch below, line 1223, is the DENY path — that one
 *      appends a field error and keeps going; only the hard-error path stashes
 *      authorizationError and triggers the early return in ResolveDefer.)
 *
 *   resolve/resolvable.go authorize (func @ line 1233) — the hard error originates
 *   from the configured authorizer:
 *     line 1246:  result, err = r.ctx.authorizer.AuthorizeObjectField(r.ctx, dataSourceID, r.marshalBuf, coordinate)
 *     line 1247:  if err != nil { return nil, err }    // hard error propagated up
 *
 *   resolve/resolvable.go ResolveDefer (func @ line 270):
 *     line 284:  _ = r.walkObject(rootData, r.data)    // FIRST (pre-walk) pass — runs authorizeField
 *     line 285:  if r.authorizationError != nil {
 *     line 286:      return r.authorizationError        // <-- returns BEFORE the envelope lBrace
 *     line 287:  }
 *     line 292:  r.printBytes(lBrace)                   // envelope never reached on the auth-error path
 *     line 340:  r.printHasNext(hasNext)                // never reached
 *
 *   resolve/resolve.go resolveDeferSingle (func @ line 569):
 *     line 589:  isLast := syncatomic.AddInt64(remaining, -1) == 0   // decrement HAPPENS FIRST
 *     line 606:  if err := dc.resolvable.ResolveDefer(...); err != nil {
 *     line 607:      return err                          // <-- early return, this leaf's isLast token is gone
 *     line 608:  }
 *     line 609:  return dc.writer.Flush()                // <-- SKIPPED on the error path: nothing flushed
 *
 *   resolve/resolve.go resolveDeferTree, Parallel branch (func @ line 617):
 *     line 645:  err := r.resolveDeferTree(dc, ctx, child, remaining)
 *     line 650:  if err != nil && ctx.ctx.Err() != nil { return err }  // ONLY surfaced on client disconnect
 *     line 653:  return nil                              // <-- otherwise the auth error is SWALLOWED
 *
 *   So an authorizer hard error during a deferred render => ResolveDefer returns
 *   pre-lBrace (nothing written) => remaining already decremented => Flush skipped
 *   => under a Parallel node the error is swallowed => orphaned pending, no
 *   `hasNext:false`, client hangs. Mechanism is present in rc.267 exactly as the
 *   audit describes.
 *
 * Why there is NO live RED test possible on the demo (CONFIRMED_IN_SOURCE_ONLY):
 *   The hard-error path is gated by THREE conditions in authorizeField that the
 *   demo cannot satisfy through HTTP:
 *     - line 1202: `if !field.Info.HasAuthorizationRule { return false }` — no field
 *       in the demo supergraph carries an authorization rule. The demo SDL
 *       (config.json engineConfig serviceSdl) imports only
 *       @key/@shareable/@inaccessible/@tag/@external from the federation spec —
 *       NO @authenticated and NO @requiresScopes — so HasAuthorizationRule is
 *       false for every field and authorizeField returns early.
 *     - line 1205: `if r.ctx.authorizer == nil { return false }` — the demo router
 *       (defer-demo/config.json) wires NO authorizer module, so ctx.authorizer is
 *       nil. An authorizer is installed only via a custom router module
 *       (core.WithAuthorizer / RouterEngineConfiguration), which the demo lacks.
 *   With no auth rule on any field and no authorizer present, AuthorizeObjectField
 *   is never called, so the hard-error early-return in ResolveDefer is unreachable
 *   from a client query.
 *
 *   Triggering this would require BOTH (a) a supergraph whose deferred field has
 *   @authenticated/@requiresScopes and (b) a router module installing an authorizer
 *   whose AuthorizeObjectField returns a non-nil error (not a deny) for that field.
 *   That is NEEDS_CONFIG territory, outside the demo's wiring; no deterministic
 *   wire-level RED test can be written against localhost:3002 as configured.
 *
 *   (Independently, the live router at localhost:3002 currently rejects @defer
 *   entirely with `directive: defer undefined`, so even the non-auth defer path is
 *   not exercisable on this instance — but the auth-rule/authorizer gate above is
 *   the decisive reason F04 is not HTTP-reachable on the demo.)
 *
 * Overlap: sibling of the termination cluster (F01/F02/F03/F04 — all "fetch/render
 * error before the hasNext/terminal frame, then swallowed under a Parallel node").
 * F04 is the AUTHORIZER-HARD-ERROR trigger; F03 is the same return-before-decrement
 * shape driven by a pre-fetch rate-limiter/authorizer error in resolveDeferSingle.
 * The observable symptom (one `{pending,hasNext:true}` frame, no terminal, client
 * hangs) matches BT-3's "never delivers + no terminal" family, but F04's specific
 * trigger is distinct from BT-3's reproduced nested/overlapping-defer trigger.
 * Does not map to B1/B6/B7.
 */
describe("F04 KI-DEFER-DEFERRED-RENDER-AUTH-ERROR-NO-TERMINATION (CONFIRMED_IN_SOURCE_ONLY)", () => {
  it.skip(
    "an authorizer HARD error during the pre-walk of a deferred fragment should NOT " +
      "leave the response unterminated: the engine must still emit a terminating " +
      "frame (hasNext:false / multipart boundary) and Flush, so the client never " +
      "hangs and no pending id is orphaned. In rc.267 ResolveDefer returns the " +
      "authorizationError before the envelope lBrace (resolvable.go:285-287), " +
      "resolveDeferSingle has already decremented `remaining` (resolve.go:589) and " +
      "skips Flush on the error path (resolve.go:606-609), and the Parallel branch " +
      "swallows the error (resolve.go:650-653). Not HTTP-reproducible on the demo: " +
      "no field carries @authenticated/@requiresScopes (HasAuthorizationRule false) " +
      "and no authorizer is wired (ctx.authorizer nil), so AuthorizeObjectField is " +
      "never called.",
    () => {
      // Intentionally skipped: mechanism confirmed in source (resolvable.go:285-287
      // + 1218-1222 + 1246-1247, resolve.go:589/606-609/650-653) but the trigger is
      // not reachable through the demo's HTTP path. Correct (spec-conforming)
      // behavior that a live test WOULD assert, if a deferred field with an auth
      // rule + a hard-erroring authorizer module were wired:
      //   - the multipart stream ends with a frame carrying hasNext:false
      //   - the terminating multipart boundary (--<boundary>--) is written
      //   - every announced pending id is closed (no orphaned pending) / no client hang
    },
  );
});
