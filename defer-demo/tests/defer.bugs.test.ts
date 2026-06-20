// Regression tests for bugs found by the battle-test loop (defer-demo/battletest).
// Each test asserts the CORRECT behavior, so it FAILS against today's router and
// passes once the bug is fixed. Self-contained (no shared helpers) so it survives
// independently of the main suite. ROUTER_URL defaults to the local demo router.
import { describe, it, expect } from "vitest";

const ROUTER = process.env.ROUTER_URL || "http://localhost:3002/graphql";

async function run(query: string, variables?: any) {
  const r = await fetch(ROUTER, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "multipart/mixed" },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  const ctype = r.headers.get("content-type") || "";
  const text = await r.text();
  if (!ctype.includes("multipart")) return { mode: "single", status: r.status, json: JSON.parse(text) };
  const frames: any[] = [];
  for (const part of text.split(/\r?\n--graphql/)) {
    const i = part.indexOf("\r\n\r\n");
    if (i < 0) continue;
    const body = part.slice(i + 4).trim();
    if (!body || body.startsWith("--")) continue;
    frames.push(JSON.parse(body));
  }
  return { mode: "multipart", status: r.status, frames };
}

describe("battle-test regressions (assert CORRECT behavior — expected to fail until fixed)", () => {
  // BT-1: @defer on a __typename-only fragment combined with a nested in-list defer
  // nulls the parent object and drops the terminal frame.
  it("BT-1 __typename-only defer + nested in-list defer must not null the parent / must terminate", { timeout: 30000 }, async () => {
    const q = `{ article(id:"a1"){ id title ... @defer { __typename } reviews{ id ... @defer { __typename author{ __typename id displayName } } } } }`;
    const r = await run(q);
    expect(r.mode).toBe("multipart");
    if (r.mode !== "multipart") return;
    // the initial payload must NOT null the whole article
    expect(r.frames[0].data?.article).not.toBeNull();
    expect(r.frames[0].data?.article?.id).toBe("a1");
    expect(r.frames[0].data?.article?.title).toBe("Hello World");
    // the stream must terminate exactly once
    const finals = r.frames.filter((f) => f.hasNext === false);
    expect(finals.length).toBe(1);
    expect(r.frames[r.frames.length - 1].hasNext).toBe(false);
  });

  // BT-3: nested defer + a field selected both outside AND inside the defer ->
  // the router sends only the initial frame (hasNext:true) then closes the stream,
  // never delivering the announced pending payloads (client hangs).
  it("BT-3 nested/overlapping defer must deliver all pending and terminate", { timeout: 30000 }, async () => {
    const q = `{ user(id:"u1"){ id recommendedArticles{ id title } ... @defer { recommendedArticles{ id title ... @defer { heroImageUrl stats{ views } reviews{ id rating } } } } } }`;
    const r = await run(q);
    expect(r.mode).toBe("multipart");
    if (r.mode !== "multipart") return;
    const announced = new Set<string>();
    const completed = new Set<string>();
    for (const f of r.frames) {
      for (const p of f.pending ?? []) announced.add(String(p.id));
      for (const c of f.completed ?? []) completed.add(String(c.id));
    }
    // every announced pending fragment must be completed
    for (const id of announced) expect(completed.has(id)).toBe(true);
    // and the stream must terminate
    expect(r.frames.filter((f) => f.hasNext === false).length).toBe(1);
  });
});
