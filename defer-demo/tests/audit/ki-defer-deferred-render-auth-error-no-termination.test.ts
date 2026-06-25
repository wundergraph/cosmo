// F04 · KI-DEFER-DEFERRED-RENDER-AUTH-ERROR-NO-TERMINATION · SYS-REQ-794 · HIGH
//
// LIVE RED — wired via the defer-audit simulation. An authorizer HARD error during
// the deferred render walk leaves the @defer stream unterminated: the announced
// `pending` id is never `completed` and no `hasNext:false` terminal is emitted, so
// a multipart client hangs forever.
//
// HOW IT IS TRIGGERED (no real auth backend needed):
//   - the demo defers `User.reviews`, which carries `@requiresScopes` ONLY so the
//     router authorizer fires on it (it is allowed by default — normal traffic is
//     unaffected; see defer-demo/subgraphs/reviews/schema.graphqls);
//   - this request sends header `x-defer-sim: authz-objectfield`, which makes the
//     router's authorizer return a hard error from AuthorizeObjectField on that
//     field (router/core/defer_sim.go — TEST-ONLY simulation; it does NOT change the
//     @defer engine, it only triggers the existing bug path).
//
// Run the router built from this branch (it contains core/defer_sim.go):
//   EXECUTION_CONFIG_FILE_PATH=defer-demo/config.json DEV_MODE=true \
//     LISTEN_ADDR=localhost:3002 go run ./router/cmd/router
//
// Engine path (his v2.5.1): AuthorizeObjectField error -> r.authorizationError ->
// ResolveDeferBatch returns before the per-defer envelope, AFTER `remaining` was
// already decremented; the Parallel branch swallows the error -> orphaned pending,
// no terminal frame. (Audit termination cluster 4/5.)
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

describe("F04 KI-DEFER-DEFERRED-RENDER-AUTH-ERROR-NO-TERMINATION (LIVE, needs x-defer-sim authorizer)", () => {
  it("a deferred-render authorizer error must still terminate the stream and complete the pending", { timeout: 30000 }, async () => {
    const r = await runDefer(`{ user(id:"u1"){ id ... @defer { reviews { id } } } }`, "authz-objectfield");
    expect(r.ctype).toContain("multipart"); // the defer transport was used
    const announced = new Set<string>();
    const completed = new Set<string>();
    for (const f of r.frames) {
      for (const p of f.pending ?? []) announced.add(String(p.id));
      for (const c of f.completed ?? []) completed.add(String(c.id));
    }
    // the deferred fragment was announced...
    expect(announced.has("1")).toBe(true);
    // SPEC: ...so it MUST be completed (its error delivered, not silently orphaned).
    // Today: completed is empty -> RED (client hangs waiting for id "1").
    for (const id of announced) expect(completed.has(id)).toBe(true);
    // SPEC: the stream MUST terminate with exactly one hasNext:false frame.
    // Today: no frame has hasNext:false -> RED.
    expect(r.frames.filter((f) => f.hasNext === false).length).toBe(1);
  });
});
