import { describe, it } from "vitest";

/**
 * F08 · KI-DEFER-ASSIGNDEFER-UNDEFINED-FIELD-PANIC · SYS-REQ-778
 *
 * Finding: the planning Visitor's `assignDefer` indexes the tail of `currentFields`
 * unconditionally. On an UNDEFINED field the Enter/Leave field events become
 * asymmetric (a Leave fires without a matching push), so `currentFields` can be
 * empty and the tail index evaluates to `[-1]` → `index out of range [-1]` panic.
 *
 * Engine evidence (CONFIRMED present in our rc.267):
 *   plan/visitor.go assignDefer (func @ line 597):
 *     line 598:  currentField := v.currentFields[len(v.currentFields)-1]
 *                ^-- if v.currentFields is empty, this is v.currentFields[-1] => panic.
 *   plan/visitor.go LeaveField (func @ line 567) calls assignDefer(fieldRef) at
 *     line 577 BEFORE popping the field stack at line 580
 *     (`v.currentFields = v.currentFields[:len(v.currentFields)-1]`), so an
 *     asymmetric Enter/Leave (undefined field) can drive assignDefer with an
 *     already-empty/underflowed stack. The unguarded tail index is present in
 *     our rc.267 exactly as the audit describes.
 *
 * Why this is NOT request-path reachable (CONFIRMED_IN_SOURCE_ONLY — latent):
 *   The cosmo router runs full operation validation (FieldsAreOnTypeOrInterface,
 *   "Cannot query field X on type Y") BEFORE the planner's Visitor ever walks the
 *   operation. An undefined field is rejected at validation, so the planner —
 *   and therefore assignDefer — is never invoked with the malformed AST. The
 *   `[-1]` panic is reachable only by driving the planning Visitor directly
 *   (an embedder bypassing validation), which the demo router does not do.
 *
 * HTTP verification performed against the live branch router (rc.267, localhost:3002),
 * all returned HTTP 200 with a clean structured validation error, NO 500 and NO panic
 * in the router log (grep panic/index-out-of-range = 0 hits):
 *
 *   Query: { article(id:"a1"){ id title ... @defer { bogusField } } }
 *     => {"errors":[{"message":"Cannot query field \"bogusField\" on type \"Article\".","path":["query","article"]}]}
 *
 *   Query: { article(id:"a1"){ id title ...F @defer } } fragment F on Article { bogusField }
 *     => {"errors":[{"message":"Cannot query field \"bogusField\" on type \"Article\".","path":["query","article"]}]}
 *
 *   Query: { article(id:"a1"){ id ... @defer { reviews { id bogusField } } } }
 *     => {"errors":[{"message":"Cannot query field \"bogusField\" on type \"Review\".","path":["query","article","reviews"]}]}
 *
 *   Control (valid @defer) streams correctly: initial {pending,hasNext:true} +
 *   incremental + completed {hasNext:false}, proving the @defer path is live and
 *   it is validation (not a missing-feature build) that rejects the undefined field.
 *
 * Why there is NO meaningful RED HTTP test:
 *   The CORRECT, spec-conforming behavior here is precisely the clean validation
 *   rejection the router already produces. An HTTP assertion of that behavior
 *   would be GREEN today, not RED — there is no buggy observable symptom to pin a
 *   failing test against, because the latent panic is gated out before it can fire.
 *   Fabricating a RED test would mean asserting a panic/500 that the router does
 *   not (and should not) produce. The defect lives only in the embedder-facing
 *   planning Visitor, not on the wire.
 *
 * Overlap with existing BT-1/BT-2/BT-3/B1-B7: NONE. F08 is a latent planner-internal
 * index bug, unrelated to the runtime defer/termination/data-race/validation bugs
 * those entries cover.
 */
// SKIPPED — NOT a live bug. Planner.Plan rejects the undefined field FIRST (validator +
// nodesResolvableVisitor), so the router returns a clean HTTP 200 validation error with
// no panic. The index-out-of-range in assignDefer is reachable only by driving the
// planning Visitor directly (an embedder hand-walking it), which no HTTP request can do.
describe("F08 KI-DEFER-ASSIGNDEFER-UNDEFINED-FIELD-PANIC (SKIPPED: gated out of the request path — router rejects cleanly, no live panic)", () => {
  it.skip(
    "an undefined field inside @defer must be cleanly rejected by operation " +
      "validation (HTTP 200, 'Cannot query field ... on type ...', no 500/panic) — " +
      "which the rc.267 router DOES do, so this assertion is GREEN, not RED. The " +
      "latent assignDefer index-out-of-range[-1] (plan/visitor.go:598, called from " +
      "LeaveField:577 before the stack pop at :580) is reachable only by driving the " +
      "planning Visitor directly, bypassing validation; it is not on the demo's HTTP " +
      "request path, so no failing wire-level test can be written.",
    () => {
      // Intentionally skipped. Mechanism confirmed present in source
      // (plan/visitor.go:597-598, LeaveField:567-580); gated out of the request path
      // by operation validation (FieldsAreOnTypeOrInterface). HTTP probe verified the
      // router rejects undefined-field-in-@defer with a structured error and no panic.
    },
  );
});
