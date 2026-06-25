// F05 · KI-DEFER-RENDER-PHASE-PRINTERR-NO-TERMINATION · SYS-REQ-795 · HIGH
//
// LIVE RED — wired via the defer-audit simulation. A custom field-value renderer
// that errors during the deferred render walk sets `r.printErr`, which NO-OPs the
// subsequent `printHasNext`; the buffered frame is partial, Flush is skipped, and
// under a Parallel node the error is swallowed -> the announced `pending` id is
// never `completed` and there is no `hasNext:false` terminal -> the client hangs.
//
// HOW IT IS TRIGGERED (no custom module needed by the test):
//   - this request defers `reviews { body }` and sends `x-defer-sim: render-error`,
//     which installs a custom FieldValueRenderer that returns an error when
//     rendering `Review.body` (router/core/defer_sim.go — TEST-ONLY simulation; it
//     does NOT change the @defer engine, only triggers the existing bug path).
//   - `body` appears ONLY inside the deferred fragment, so the renderer fails during
//     the deferred render pass, exactly where the audit finding lives.
//
// Run the router built from this branch (it contains core/defer_sim.go).
// Engine path (his v2.5.1): RenderFieldValue error -> r.printErr -> printHasNext
// no-op -> ResolveDeferBatch returns the printErr, Flush skipped, error swallowed.
// (Audit termination cluster 5/5.)
import { describe, it, expect } from "vitest";

const ROUTER = process.env.ROUTER_URL || "http://127.0.0.1:3002/graphql";

async function runDefer(query: string, sim: string) {
  const r = await fetch(ROUTER, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "multipart/mixed", "x-defer-sim": sim },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  const frames: any[] = [];
  for (const part of text.split(/\r?\n--graphql/)) {
    const i = part.indexOf("\r\n\r\n");
    if (i < 0) continue;
    const body = part.slice(i + 4).trim();
    if (!body || body.startsWith("--")) continue;
    frames.push(JSON.parse(body));
  }
  return { status: r.status, ctype: r.headers.get("content-type") || "", frames };
}

describe("F05 KI-DEFER-RENDER-PHASE-PRINTERR-NO-TERMINATION (LIVE, needs x-defer-sim renderer)", () => {
  it("a deferred-render field-renderer error must still terminate the stream and complete the pending", { timeout: 30000 }, async () => {
    const r = await runDefer(`{ user(id:"u1"){ id ... @defer { reviews { body } } } }`, "render-error");
    expect(r.ctype).toContain("multipart");
    const announced = new Set<string>();
    const completed = new Set<string>();
    for (const f of r.frames) {
      for (const p of f.pending ?? []) announced.add(String(p.id));
      for (const c of f.completed ?? []) completed.add(String(c.id));
    }
    expect(announced.has("1")).toBe(true);
    // SPEC: the deferred fragment's render error must be delivered and its pending
    // completed (not orphaned). Today: completed is empty -> RED.
    for (const id of announced) expect(completed.has(id)).toBe(true);
    // SPEC: exactly one hasNext:false terminal. Today: none -> RED.
    expect(r.frames.filter((f) => f.hasNext === false).length).toBe(1);
  });
});
