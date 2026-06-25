import { describe, it } from "vitest";

/**
 * F15 · KI-DEFER-DUPLICATE-AUTH-ERROR-TWO-PASS · SYS-REQ-782 · LOW
 *
 * Finding: `ResolveDefer` walks the deferred fragment's object tree TWICE —
 * a pre-walk pass and a render pass. For a PASS-THROUGH ANCESTOR object field
 * (an object walked only to reach a deeper deferred field, i.e. it carries no
 * matching defer id of its own), `render()` is FALSE in BOTH passes, so any
 * field-error append guarded by `if !r.render()` fires in BOTH passes and the
 * SAME field error is appended TWICE into the deferred frame's `errors`.
 * Audit confirmed it for (1) auth reject, (2) invalid `__typename`,
 * (3) non-nullable-null.
 *
 * ───────────────────────── ENGINE EVIDENCE (CONFIRMED present in rc.267) ──────
 * graphql-go-tools/v2@v2.0.0-rc.267 — pkg/engine/resolve/resolvable.go
 *
 *   ResolveDefer (func @ line 270) — the two passes:
 *     line 278:  r.enableRender = false           // pass 1 (pre-walk)
 *     line 284:  _ = r.walkObject(rootData, r.data)
 *     ...
 *     line 302:  r.enableRender = true            // pass 2 (render)
 *     line 306:  _ = r.walkObject(rootData, r.data)
 *
 *   render() (func @ line 558):
 *     line 559:  if !r.deferMode { return r.enableRender }
 *     line 563:  return r.enableRender && r.enableDeferRender
 *     // For a PASS-THROUGH ANCESTOR (no defer id of its own) enableDeferRender
 *     // is never set true, so render() == false in BOTH passes.
 *
 *   walkFields (func @ line 1100) — the auth-reject append site:
 *     line 1124:  if !r.render() {
 *     line 1125:      skip := r.authorizeField(value, obj.Fields[i])   // <-- runs in BOTH passes
 *   authorizeField (func @ line 1198), DENY branch:
 *     line 1223:  if result != nil {
 *     line 1224:      r.addRejectFieldError(result.Reason, ...)        // <-- appended TWICE
 *
 *   walkObject (func @ line 885) — the invalid-__typename append site:
 *     line 911:  if !r.render() {                                     // true in BOTH passes
 *     line 916:      r.addErrorWithCode("Subgraph '%s' returned invalid value '%s' for __typename field.", ...)
 *
 *   walkObject — the non-nullable-null append site:
 *     line 895:  r.addNonNullableFieldError(obj.Path, parent)         // reached in BOTH passes
 *   addNonNullableFieldError (func @ line 1713) — NO de-dup:
 *     line 1729:  r.ensureErrorsInitialized()
 *     line 1730:  fastjsonext.AppendErrorToArray(...)                 // blind append
 *   addError (func @ line 1798) / addErrorWithCode (func @ line 1805) likewise
 *   blind-append with no de-dup.
 *
 * The mechanism (two-pass walk + render()==false on both passes for a
 * pass-through ancestor + non-deduping append helpers) is PRESENT in our
 * rc.267 engine.
 *
 * ───────────────────────── WHY NO LIVE RED HTTP TEST IS POSSIBLE ─────────────
 * To OBSERVE the duplicate over HTTP, the duplicated error must be raised by the
 * Resolvable's own walk INSIDE ResolveDefer (one of the three sites above) on a
 * pass-through ANCESTOR within the deferred subtree. None of the three variants
 * is reachable on this demo:
 *
 *   (1) auth-reject — authorizeField short-circuits at resolvable.go line 1205
 *       `if r.ctx.authorizer == nil { return false }`. The demo wires NO
 *       authorizer (NEEDS_CONFIG: a router with an AuthorizeObjectField
 *       authorizer + a deferred fragment under an auth-guarded ancestor).
 *
 *   (2) invalid-__typename — requires a subgraph to return a bogus `__typename`
 *       for an entity reached as a pass-through ancestor of a defer. The demo
 *       subgraph resolvers return correct typenames and may not be modified
 *       (resolver logic/data are frozen).
 *
 *   (3) non-nullable-null — the ONLY reachable non-null violation in the demo is
 *       `Review.article: Article!` being null for r5 (User("u1").reviews =
 *       [r2, r3, r5]; r5 is a review of a user and has no article). But that null
 *       is produced by the REVIEWS SUBGRAPH FETCH as a DOWNSTREAM_SERVICE_ERROR
 *       that nulls the WHOLE `User.reviews` list at the loader boundary; the
 *       error surfaces in the INITIAL frame and COLLAPSES the defer — it never
 *       reaches ResolveDefer's two-pass walk as a pass-through-ancestor
 *       resolvable null-check.
 *
 * Probed shapes (all returned the article-null error EXACTLY ONCE, in the
 * initial frame, never duplicated, never inside an incremental/completed frame):
 *   - user(id:"u1"){ id reviews{ id article{ id title ... @defer{ wordCount } } } }
 *   - user(id:"u1"){ id ... @defer{ reviews{ id article{ id } } } }
 *   - user(id:"u1"){ id reviews{ id rating article{ id } ... @defer{ rating } } }
 *   - user(id:"u1"){ id ... @defer{ reviews{ id article{ id ... @defer{ title } } } } }  (nested)
 *   - user(id:"u1"){ id reviews{ id article{ id ... @defer{ wordCount } } } }
 *
 * Observed (P1, the closest shape) deferred run — ONE occurrence, initial frame:
 *   {"errors":[
 *     {"message":"Failed to fetch from Subgraph 'reviews' at Path 'user'.", ...},
 *     {"message":"Cannot return null for non-nullable field 'Query.user.reviews'.",
 *      "path":["user","reviews"]}],
 *    "data":{"user":null}}
 *
 * Classification: CONFIRMED_IN_SOURCE_ONLY. The duplicate-append mechanism is
 * present in rc.267 but is not triggerable through the demo's HTTP path (no
 * authorizer; frozen subgraph resolvers; the one reachable non-null null nulls
 * the list at the fetch boundary instead of entering the defer walk).
 *
 * Overlap: none of BT-1/BT-2/BT-3/B1-B7 cover error DUPLICATION inside a
 * deferred frame. Distinct finding.
 */
describe("F15 · KI-DEFER-DUPLICATE-AUTH-ERROR-TWO-PASS", () => {
  it.skip("SKIPPED: NOT REPRODUCED. Wired live via x-defer-sim:authz-deny-ancestor (the authorizer returns a DENY on the pass-through ancestor User.reviews) — the deferred frame carried the field error EXACTLY ONCE, never duplicated. The two-pass duplication does not manifest on this demo's shapes against his v2.5.1 engine; mechanism present in source but no live RED repro.", () => {});
});
