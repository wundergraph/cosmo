import { describe, it, expect } from "vitest";

/**
 * KI-DEFER-RECOVERABLE-ERROR-DROPS-SURVIVING-DEFER (REPRODUCED_HTTP)
 *
 * Isolated, confound-free variant of F01 (ki-defer-recoverable-error-drops-defers).
 *
 * WHY A NEW TEST: the original F01 repro queries
 *     user(id:"u1") { reviews { article { id } } ... @defer { recommendedArticles } }
 * where `User.reviews: [Review!]!` is NON-NULL. The recoverable error (r5.article
 * is null on the non-null `Review.article`) therefore null-propagates all the way
 * up to null `user` itself — i.e. it kills the defer's OWN anchor (`["user"]`).
 * That conflates two different questions:
 *   (a) should a defer be delivered when its anchor object was nulled? (debatable;
 *       graphql-js v17 would NOT deliver it), and
 *   (b) should a recoverable error ANYWHERE drop a defer whose anchor SURVIVED?
 *       (unambiguously no — that is the real bug).
 * The original F01 asserts delivery onto a nulled anchor, which is the wrong
 * (spec-questionable) behavior to pin. This test removes the confound.
 *
 * SETUP: two independent root fields.
 *   - `erroring: user(id:"u1") { reviews { article { id } } }` triggers the SAME
 *     recoverable error, but because `Query.user: User` is NULLABLE the error is
 *     bounded — it nulls `erroring` only, leaving the root data object intact.
 *   - `anchor: user(id:"u1") { id ... @defer { recommendedArticles } }` is a
 *     pristine, fully-resolved object. Its deferred fragment is anchored at
 *     `["anchor"]`, a path that has NO error and was NOT null-propagated.
 *
 * OBSERVED TODAY (RED), single frame, defer silently dropped:
 *   {"errors":[...on "erroring"...],"data":{"erroring":null,"anchor":{"id":"u1"}},
 *    "hasNext":false}\r\n--graphql\r\n--graphql--
 *
 * HEALTHY shape for the same `anchor` defer WITHOUT the erroring sibling:
 *   frame0: {"data":{"anchor":{"id":"u1"}},"pending":[{"id":"1","path":["anchor"]}],"hasNext":true}
 *   frame1: {"incremental":[{"data":{"recommendedArticles":[{"id":"a2","title":"World News"}]},"id":"1"}],
 *            "completed":[{"id":"1"}],"hasNext":false}
 *
 * ROOT CAUSE (engine, current branch):
 *   - resolvable.go: the initial render announces `pending` and `hasNext:true`
 *     only when `!r.hasErrors()` (printObject, ~line 294-298).
 *   - resolve.go ResolveGraphQLResponse: `if resolvable.hasErrors() { return ... }`
 *     (~line 530) early-returns BEFORE resolveDeferTree.
 *   `hasErrors()` is a single global boolean over the whole errors array; it does
 *   not consider whether any error path actually touches a given defer's anchor.
 *   So ONE recoverable error on an unrelated path drops EVERY defer.
 *
 * SPEC-CORRECT behavior (asserted below; RED today): a defer whose anchor survived
 * must still be announced (`pending`), delivered (`incremental`), completed, and the
 * stream must terminate with exactly one `hasNext:false`. The unrelated recoverable
 * error rides along in the initial frame's `errors`.
 */

const ROUTER_URL = process.env.ROUTER_URL || "http://localhost:3002/graphql";

const QUERY = `{
  erroring: user(id: "u1") {
    id
    reviews { id article { id } }
  }
  anchor: user(id: "u1") {
    id
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

describe("KI-DEFER-RECOVERABLE-ERROR-DROPS-SURVIVING-DEFER (REPRODUCED_HTTP)", () => {
  it("delivers a defer whose anchor survived, even though an unrelated path has a recoverable error", async () => {
    const res = await postDefer(QUERY);

    // Deferred transport must be used (defer requested + accepted).
    expect(res.status).toBe(200);
    expect(res.ctype).toContain("multipart/mixed");

    const initial = res.frames[0];

    // The recoverable error is bounded to the unrelated `erroring` root field;
    // the defer's anchor object is fully resolved and intact.
    expect((initial?.data as any)?.erroring).toBeNull();
    expect((initial?.data as any)?.anchor).toEqual({ id: "u1" });
    expect(Array.isArray(initial?.errors)).toBe(true);

    // 1) The surviving anchor's defer MUST be announced + hasNext:true.
    //    (Today: neither — the global hasErrors() gate drops it.)
    expect(initial?.pending).toEqual([{ id: "1", path: ["anchor"] }]);
    expect(initial?.hasNext).toBe(true);

    // 2) The deferred payload MUST be delivered in a follow-up incremental frame.
    const allIncremental = res.frames.flatMap(
      (f) => (f.incremental as Frame[] | undefined) ?? [],
    );
    expect(allIncremental).toEqual([
      {
        id: "1",
        data: {
          recommendedArticles: [{ id: "a2", title: "World News" }],
        },
      },
    ]);

    // 3) The stream MUST terminate: a hasNext:false frame AND the close-delimiter.
    const last = res.frames[res.frames.length - 1];
    expect(last?.hasNext).toBe(false);
    expect(res.raw.includes("--graphql--")).toBe(true);
  });
});
