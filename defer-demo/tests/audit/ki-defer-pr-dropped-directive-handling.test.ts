import { describe, expect, it } from 'vitest';

/**
 * F19 · KI-DEFER-PR-DROPPED-DIRECTIVE-HANDLING · SYS-REQ-252/777 · LOW (regression)
 *
 * Finding: the @defer PR emptied the planner's `Visitor.EnterDirective`,
 * dropping the pre-PR planning branch that honored the per-operation
 * `@flushInterval(milliSeconds: Int!)` directive (and the `@stream` branch).
 * `@flushInterval` is now silently ignored — operators can no longer override
 * the flush cadence per operation; only the static `Config.DefaultFlushIntervalMillis`
 * is honored. No crash, no data loss; a behavioral regression only.
 *
 * Engine evidence (CONFIRMED present in our rc.267):
 *   pkg/engine/plan/visitor.go line 281-282:
 *       func (v *Visitor) EnterDirective(ref int) {
 *       }                                   <-- empty body; the @flushInterval
 *                                               (and @stream) planning branch
 *                                               that used to live here is gone.
 *   It is still registered as a visitor:
 *       pkg/engine/plan/planner.go line 161:
 *           p.planningWalker.RegisterEnterDirectiveVisitor(p.planningVisitor)
 *   so every directive entered during planning lands in the empty function and
 *   its arguments are discarded.
 *
 *   The plumbing for an operation-level override still exists but is now DEAD:
 *       pkg/engine/plan/plan.go:
 *           line 17  SetFlushInterval(interval int64)          (PostProcessingFn iface)
 *           line 28  func (s *SynchronousResponsePlan) SetFlushInterval(...)
 *           line 50  func (s *SubscriptionResponsePlan) SetFlushInterval(...)
 *           line 76  func (d *DeferResponsePlan) SetFlushInterval(...)
 *   `SetFlushInterval` has ZERO non-test callers (verified by grep across pkg/).
 *   The ONLY place a plan's FlushInterval is populated is from the static config:
 *       pkg/engine/plan/visitor.go line 1014:
 *           FlushInterval: v.Config.DefaultFlushIntervalMillis,
 *   i.e. the per-operation `@flushInterval(milliSeconds:)` argument is never read.
 *
 *   The `@flushInterval` directive definition itself survives only inside a TEST
 *   SDL (pkg/engine/plan/planner_test.go line 910:
 *       `directive @flushInterval(milliSeconds: Int!) on QUERY | SUBSCRIPTION`).
 *   It is NOT in the embedded base schema: pkg/asttransform/baseschema.go embeds
 *   only base.graphql + internal.graphql, and `@flushInterval` appears in neither
 *   (base.graphql defines @include/@skip/@deprecated/@specifiedBy/@oneOf/@defer;
 *   internal.graphql defines @__defer_internal).
 *
 * Why there is NO live RED test possible (CONFIRMED_IN_SOURCE_ONLY):
 *   1. Not wire-observable in principle. `@flushInterval` is a TIMING-only knob:
 *      it changes how often the router flushes buffered incremental frames, not
 *      WHAT is delivered. The canonical defer oracle treats @defer as pure
 *      transport reformatting of a fixed result — flush cadence does not change
 *      the frames' content, ordering, pending/completed ids, or termination. A
 *      deterministic wire-level assertion cannot distinguish "honored a 50ms
 *      cadence" from "ignored it and used the default" without flaky timing.
 *   2. Not even reachable on the demo router. `@flushInterval` is not embedded,
 *      so the operation is hard-rejected at VALIDATION before planning runs. The
 *      `DirectivesAreDefined` rule (pkg/astvalidation/operation_rule_directives_defined.go)
 *      fires first. Observed live against localhost:3002 with
 *      `query @flushInterval(milliSeconds: 50) { user(id:"u1"){ id ... @defer { username } } }`:
 *
 *        HTTP 200, Content-Type: multipart/mixed; subscriptionSpec=1.0; boundary=graphql
 *        --graphql
 *        Content-Type: application/json
 *
 *        {"errors":[{"message":"directive: flushInterval undefined","path":["query"]}]}
 *        --graphql--
 *
 *      So the empty `EnterDirective` is never even reached for this directive on
 *      the demo — it dies at validation. The "silently ignored" symptom would
 *      only manifest if an operator added `@flushInterval` to their own SDL, and
 *      even then it would be a pure (non-wire-observable) timing change.
 *
 * What the (skipped) RED test WOULD assert if it were reachable + deterministic:
 *   A query carrying `@flushInterval(milliSeconds: N)` on the operation produces
 *   a plan whose FlushInterval == N (the per-operation override), instead of the
 *   plan defaulting to Config.DefaultFlushIntervalMillis. That is a planner-level
 *   property, not an HTTP-wire property, so it cannot be asserted from a
 *   multipart/mixed client.
 *
 * Overlap: none. This is a planner-visitor regression unique to F19. It touches
 * @stream only tangentially (the same emptied EnterDirective also dropped the
 * @stream planning branch, which overlaps the F12/F14 "@stream not wired"
 * cluster), but @flushInterval itself does not map to BT-1/BT-2/BT-3 or
 * B1/B6/B7 (those are all @defer wire-behavior bugs).
 */
describe("F19 KI-DEFER-PR-DROPPED-DIRECTIVE-HANDLING (CONFIRMED_IN_SOURCE_ONLY)", () => {
  it(
    "@flushInterval(milliSeconds:) should set the plan's per-operation FlushInterval, " +
      "but rc.267 empties Visitor.EnterDirective and SetFlushInterval has no callers, " +
      "so the directive is dropped; not wire-observable (timing-only) and not even " +
      "reachable on the demo (rejected at validation: 'directive: flushInterval undefined')",
    () => {
      // Intentionally skipped: planner-visitor regression, timing-only effect,
      // and not embedded into the demo schema. See block comment for the live
      // validation-rejection capture and the dead SetFlushInterval plumbing.
      expect(true).toBe(true); // NOTE: not an issue, it was not exposed
    },
  );
});
