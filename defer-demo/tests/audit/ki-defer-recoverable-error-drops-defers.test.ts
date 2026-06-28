import { describe, it, expect } from "vitest";

/**
 * F01 · KI-DEFER-RECOVERABLE-ERROR-DROPS-DEFERS · SYS-REQ-780 · HIGH
 *
 * Finding: a RECOVERABLE initial-response error (any subgraph error, or a
 * non-null violation that the engine can null-and-continue on) triggers an
 * early return in ResolveGraphQLResponse BEFORE the DeferTree is resolved and
 * BEFORE the terminating multipart frame is written. `hasErrors()` does not
 * distinguish recoverable from fatal, so EVERY initial-response error drops all
 * deferred fields: no `pending`, no `incremental`, no `hasNext:false`, and no
 * terminating multipart close-delimiter. The client hangs.
 *
 * Engine evidence (CONFIRMED present in our rc.267):
 *
 *   resolve/resolve.go ResolveGraphQLResponse (func @ line 321):
 *     line 495:  err = resolvable.Resolve(...)        // render initial response
 *     line 500:  err = writer.Flush()                 // flush initial frame
 *     line 505:  if resolvable.hasErrors() {
 *     line 506:      return resolveInfo, nil          // <-- EARLY RETURN on ANY error
 *     line 507:  }
 *     line 511:  if response.DeferTree != nil {       // never reached on the error path
 *     line 523:      r.resolveDeferTree(...)          // deferred fetches never run
 *     line 528:  writer.Complete()                    // terminal boundary never written
 *
 *   resolve/resolvable.go hasErrors (func @ line 730):
 *     line 730:  func (r *Resolvable) hasErrors() bool {
 *     line 734:      values, err := r.errors.Array()
 *     line 738:      return len(values) > 0           // ANY error => true (recoverable or fatal)
 *
 *   So a recoverable error in the initial render populates resolvable.errors,
 *   hasErrors() returns true, and the function returns at line 506 before
 *   resolveDeferTree (511-526) and before writer.Complete() (528). The deferred
 *   fragment is permanently dropped and the multipart stream is never terminated.
 *   Mechanism is present in rc.267 exactly as the audit describes.
 *
 * Reproduced over HTTP on the demo (REPRODUCED_HTTP):
 *   The demo's reviews subgraph returns r5 (a review-of-a-user) whose `article`
 *   is null, violating `Review.article: Article!`. That nulls the non-null
 *   `User.reviews`, which nulls `user`, producing a recoverable error in the
 *   INITIAL (non-deferred) response. A sibling `@defer { recommendedArticles }`
 *   on the same `user` selection is then silently dropped:
 *
 *     Observed buggy wire (1 frame, no pending / no hasNext / no terminator):
 *       --graphql\r\n...{"errors":[...],"data":{"user":null}}\r\n\r\n--graphql
 *     vs the healthy defer terminator (same query without the erroring field):
 *       ...{"...","hasNext":false}\r\n\r\n--graphql\r\n--graphql--\r\n
 *
 * RESOLUTION: with the per-defer anchor-survival gate, the engine cancels a defer
 * whose OWN anchor null-propagated (here `user` becomes null because the non-null
 * `User.reviews` could not be satisfied) and terminates the stream cleanly — it is
 * never announced and never delivered, matching graphql-js "Cancels deferred
 * fields when initial result exhibits null bubbling cancelling the defer". This
 * test now asserts that corrected behavior (GREEN). The inverse — a defer whose
 * anchor SURVIVES an unrelated recoverable error must still be delivered — is
 * covered by ki-defer-recoverable-error-drops-surviving-defer.
 *
 * Overlap: head of the termination cluster (F01/F02/F03/F04 — "error before the
 * hasNext/terminal frame"). F01 is the RECOVERABLE-INITIAL-ERROR trigger and is
 * the only one in the cluster reachable on the demo (no authorizer/rate-limiter
 * needed). The "never delivers + no terminal" symptom is in the same family as
 * BT-3, but BT-3's reproduced trigger is nested/overlapping defer; F01's trigger
 * is an initial-response recoverable error. Does not map to B1/B6/B7.
 */

const ROUTER_URL = process.env.ROUTER_URL || "http://localhost:3002/graphql";

// A query whose INITIAL (non-deferred) selection produces a recoverable error
// (User.reviews -> r5.article is null on a non-null field) that null-propagates
// onto the defer's OWN anchor (`user`), so the @defer fragment must be cancelled
// and the stream must still terminate cleanly.
const QUERY = `{
  user(id: "u1") {
    id
    reviews { id article { id } }
    ... @defer { recommendedArticles { id title } }
  }
}`;

type Frame = Record<string, unknown>;
interface MultipartResult {
  status: number;
  ctype: string;
  raw: string;
  frames: Frame[];
}

async function postDefer(query: string): Promise<MultipartResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let r: Response;
  try {
    r = await fetch(ROUTER_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "multipart/mixed" },
      body: JSON.stringify({ query }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const ctype = r.headers.get("content-type") || "";
  const raw = await r.text();
  const frames: Frame[] = [];
  for (const part of raw.split(/\r?\n--graphql/)) {
    const idxCRLF = part.indexOf("\r\n\r\n");
    const idxLF = part.indexOf("\n\n");
    const i = idxCRLF >= 0 ? idxCRLF + 4 : idxLF >= 0 ? idxLF + 2 : -1;
    if (i < 0) continue;
    const body = part.slice(i).trim();
    if (!body || body.startsWith("--")) continue;
    frames.push(JSON.parse(body) as Frame);
  }
  return { status: r.status, ctype, raw, frames };
}

describe("F01 KI-DEFER-RECOVERABLE-ERROR-DROPS-DEFERS (REPRODUCED_HTTP)", () => {
  it("cancels a defer whose own anchor null-propagated and terminates the stream cleanly", async () => {
    const res = await postDefer(QUERY);

    // It must be a real multipart stream (deferred mode was requested + accepted).
    expect(res.status).toBe(200);
    expect(res.ctype).toContain("multipart/mixed");

    const initial = res.frames[0];

    // 1) The recoverable error null-propagated onto the defer's OWN anchor, so
    //    `user` is null and the defer is cancelled: never announced via `pending`.
    expect(initial?.data).toEqual({ user: null });
    expect(initial?.pending).toBeUndefined();

    // 2) No incremental payload is delivered for the cancelled defer.
    const allIncremental = res.frames.flatMap(
      (f) => (f.incremental as Frame[] | undefined) ?? [],
    );
    expect(allIncremental).toEqual([]);

    // 3) The stream still terminates cleanly: a frame carrying hasNext:false AND
    //    the multipart close-delimiter `--graphql--`.
    const last = res.frames[res.frames.length - 1];
    expect(last?.hasNext).toBe(false);
    expect(res.raw.includes("--graphql--")).toBe(true);
  });
});
