import { describe, it } from "vitest";

/**
 * F05 · KI-DEFER-RENDER-PHASE-PRINTERR-NO-TERMINATION · SYS-REQ-795
 *
 * Finding: during the RENDER phase of a deferred fragment, AFTER the per-defer
 * envelope `lBrace` has already been written, the render walk can set
 * `r.printErr`. Once `printErr` is non-nil, `printHasNext` no-ops, so the
 * incremental frame is emitted WITHOUT its `hasNext` terminator, and the frame
 * is never flushed — the client receives a partial frame and then hangs (no
 * terminating multipart boundary, no `hasNext:false`).
 *
 * Engine evidence (CONFIRMED present in our rc.267):
 *   resolve/resolvable.go ResolveDefer (func @ line 270):
 *     line 292:  r.printBytes(lBrace)                      // envelope opened
 *     line 306:  _ = r.walkObject(rootData, r.data)        // render walk can set printErr
 *     line 340:  r.printHasNext(hasNext)                   // <-- no-ops if printErr set
 *     line 344:  return r.printErr                          // returns the error upward
 *
 *   resolve/resolvable.go printHasNext (func @ line 428):
 *     line 429:  if r.printErr != nil { return }            // hasNext silently skipped
 *
 *   resolve/resolvable.go renderFieldValue (func @ line 794) — the 3 sources that
 *   set printErr DURING the post-lBrace walk:
 *     (a) line 814: r.printErr = r.ctx.fieldRenderer.RenderFieldValue(...)  // custom renderer error
 *     (b) line 819: _, r.printErr = r.out.Write(valueBytes)                 // writer Write error
 *     (c) line 787: r.printErr = err  (renderScalarFieldBytes)              // astjson parse error
 *
 *   resolve/resolve.go resolveDeferSingle (func @ line 569):
 *     line 606:  if err := dc.resolvable.ResolveDefer(...); err != nil {
 *     line 607:      return err                              // <-- early return
 *     line 608:  }
 *     line 609:  return dc.writer.Flush()                    // <-- SKIPPED on the error path
 *
 *   So a render-phase printErr => partial frame (no hasNext) => Flush() skipped
 *   => no terminal frame. Mechanism is present in rc.267 exactly as the audit
 *   describes. The `printErr != nil { return }` guard in printHasNext is the
 *   load-bearing defect.
 *
 * Why there is NO live RED test possible on the demo (CONFIRMED_IN_SOURCE_ONLY):
 *   All three printErr sources are NOT client-inducible against the demo router:
 *     (a) Custom FieldValueRenderer: only installed via
 *         requestContext.SetCustomFieldValueRenderer (router/core/context.go:356)
 *         from a CUSTOM MODULE, then wired into the resolve context at
 *         router/core/graphql_handler.go:182-183. The demo router (defer-demo/
 *         config.json) wires NO such module, so r.ctx.fieldRenderer is nil and
 *         line 814 is never reached — the else-branch (plain Write, line 819) runs.
 *     (b) Writer Write error: the demo client cannot force the router's response
 *         writer to fail mid-frame (same un-inducible condition as F02).
 *     (c) astjson parse error: only fires on malformed bytes already present in
 *         the response tree; the engine's own fetch path produces valid JSON, so
 *         a client query cannot inject a parse failure here.
 *
 *   Triggering path (a) would require ADDING a custom router module that installs
 *   a deliberately-failing FieldValueRenderer (NEEDS_CONFIG territory), which is
 *   outside the demo's wiring. Therefore no deterministic wire-level RED test can
 *   be written against localhost:3002 as configured.
 *
 * Overlap: sibling of the termination cluster (F01/F02/F03/F04 — all "render/fetch
 * error before the hasNext/terminal frame"). The observable symptom (one
 * `{pending,hasNext:true}` frame, no terminal, client hangs) matches BT-3's
 * "never delivers + no terminal" family, but F05's specific trigger (post-lBrace
 * render-phase printErr via custom renderer / write error / astjson parse error)
 * is distinct from BT-3's reproduced nested/overlapping-defer trigger. Does not
 * map to B1/B6/B7.
 */
describe("F05 KI-DEFER-RENDER-PHASE-PRINTERR-NO-TERMINATION (CONFIRMED_IN_SOURCE_ONLY)", () => {
  it.skip(
    "a render-phase printErr after the defer envelope lBrace should NOT leave the " +
      "frame unterminated: the engine must still emit a terminating frame " +
      "(hasNext:false / multipart boundary) and Flush, so the client never hangs. " +
      "In rc.267 printHasNext no-ops on printErr and resolveDeferSingle skips Flush " +
      "on the error path. Not HTTP-reproducible on the demo: all 3 printErr sources " +
      "(custom FieldValueRenderer error, writer Write error, astjson parse error) " +
      "are not client-inducible without a custom router module.",
    () => {
      // Intentionally skipped: mechanism confirmed in source (resolvable.go:340/428-431,
      // resolve.go:606-609) but the trigger is not reachable through the demo's HTTP path.
      // Correct (spec-conforming) behavior that a live test WOULD assert, if a failing
      // FieldValueRenderer module were wired:
      //   - the multipart stream ends with a frame carrying hasNext:false
      //   - the terminating multipart boundary (--<boundary>--) is written
      //   - no client hang / no orphaned pending id
    },
  );
});
