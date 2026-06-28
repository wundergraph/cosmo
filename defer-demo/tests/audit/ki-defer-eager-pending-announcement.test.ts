import { describe, it, expect } from "vitest";

/**
 * F16 · KI-DEFER-EAGER-PENDING-ANNOUNCEMENT · SYS-REQ-773/775
 *
 * Finding: for a NESTED @defer (a @defer fragment that lives inside another
 * @defer fragment), our engine (graphql-go-tools rc.267) announces the INNER
 * defer's `pending` entry EAGERLY in the very first (initial) frame, instead of
 * LAZILY — i.e. only once the enclosing parent defer is released. The GraphQL
 * incremental-delivery spec / graphql-js v17 announce a child defer's `pending`
 * in the same frame that delivers its parent's `completed`, not before the
 * parent has been resolved.
 *
 * This is a WIRE-SHAPE divergence (the eager pending set is a strict superset of
 * the lazy set; every announced id is still eventually completed, so the
 * oracle's pending-closure / path-validity invariants pass). It is NOT a
 * data-loss or hang defect — hence LOW. But it is HTTP-observable.
 *
 * Engine evidence (CONFIRMED present in our rc.267):
 *   pkg/engine/resolve/response.go:
 *     - GraphQLDeferResponse.DeferDescriptors is documented as "lists every
 *       @defer fragment in the operation, keyed by ID" — i.e. it includes
 *       nested defers (DeferDescriptor.ParentID != 0), not just top-level ones.
 *   pkg/engine/resolve/resolvable.go:
 *     - In the initial-response render (resolveObject path), after the root data
 *       is printed:
 *           if r.deferMode && !r.hasErrors() {
 *               r.printPendingEntries(r.deferDescriptors)   // line ~261
 *               r.printHasNext(true)
 *           }
 *     - printPendingEntries (line ~366) iterates the ENTIRE descriptor map,
 *       sorted by id ascending, with NO filter on ParentID. So every defer in
 *       the operation — including ones nested inside an as-yet-unresolved parent
 *       defer — is emitted into the FIRST frame's `pending` array.
 *     There is no per-defer-release path that emits a child's `pending` lazily;
 *     ResolveDefer (line ~270) emits only `incremental` + `completed`, never a
 *     fresh `pending`.
 *
 * HTTP verification performed against the live branch router (rc.267, run under
 * -race, http://localhost:3002/graphql), nested-defer probe:
 *
 *   {
 *     article(id: "a1") {
 *       id
 *       ... @defer {                 # OUTER defer  -> id 1, path ["article"]
 *         reviews {
 *           id
 *           ... @defer {             # INNER defer  -> id 2, path ["article","reviews"]
 *             body
 *             article { id title }
 *           }
 *         }
 *       }
 *     }
 *   }
 *
 *   Observed (deterministic across runs), 3 frames:
 *     frame 0 (initial): pending = [ {id:"1",path:["article"]},
 *                                    {id:"2",path:["article","reviews"]} ]   <-- EAGER
 *                        hasNext = true
 *     frame 1: incremental id "1" (reviews), completed id "1", hasNext true
 *     frame 2: incremental id "2" (x2, subPath [0]/[1]), completed id "2", hasNext false
 *
 *   Spec-correct (lazy) shape:
 *     frame 0: pending = [ {id:"1",path:["article"]} ]                       <-- ONLY parent
 *     frame 1: incremental id "1", pending = [ {id:"2",...} ], completed id "1"
 *     frame 2: incremental id "2", completed id "2", hasNext false
 *
 * Overlap with existing confirmed bugs: NONE. BT-1/BT-2/BT-3 are runtime defer
 * defects (null-propagation, data race, non-delivery/termination); B1/B6/B7 are
 * `if`/`label` validation gaps. F16 is purely the timing/placement of the
 * `pending` announcement for nested defers and maps to none of them.
 *
 * RESOLUTION: nested defers are now announced lazily. The initial frame announces
 * only the top-level defer; the inner defer's `pending` is emitted in the frame
 * that releases its parent. The test below asserts that lazy shape (GREEN).
 */

const ROUTER = process.env.ROUTER_URL || "http://localhost:3002/graphql";

const NESTED_DEFER_QUERY = `{
  article(id: "a1") {
    id
    ... @defer {
      reviews {
        id
        ... @defer {
          body
          article { id title }
        }
      }
    }
  }
}`;

async function postDefer(query: string) {
  const r = await fetch(ROUTER, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "multipart/mixed" },
    body: JSON.stringify({ query }),
  });
  const ctype = r.headers.get("content-type") || "";
  const text = await r.text();
  const frames: any[] = [];
  if (ctype.includes("multipart")) {
    for (const part of text.split(/\r?\n--graphql/)) {
      const sep = part.indexOf("\r\n\r\n") >= 0
        ? part.indexOf("\r\n\r\n") + 4
        : part.indexOf("\n\n") >= 0
          ? part.indexOf("\n\n") + 2
          : -1;
      if (sep < 0) continue;
      const body = part.slice(sep).trim();
      if (!body || body.startsWith("--")) continue;
      frames.push(JSON.parse(body));
    }
  }
  return { status: r.status, ctype, frames };
}

describe("F16 KI-DEFER-EAGER-PENDING-ANNOUNCEMENT (RESOLVED: lazy nested pending)", () => {
  it("announces a nested @defer's pending lazily (on parent release), not eagerly in the initial frame", async () => {
    const res = await postDefer(NESTED_DEFER_QUERY);

    expect(res.status).toBe(200);
    expect(res.ctype).toContain("multipart");

    // The INITIAL frame announces ONLY the top-level defer (id "1" on ["article"]).
    expect(res.frames[0].pending).toEqual([{ id: "1", path: ["article"] }]);

    // The inner defer (id "2" on ["article","reviews"]) is announced lazily, in a
    // later frame — the one that releases its parent (id "1").
    const announcedAfterInitial = res.frames
      .slice(1)
      .flatMap((f: any) => (f.pending ?? []) as any[]);
    expect(announcedAfterInitial).toContainEqual({
      id: "2",
      path: ["article", "reviews"],
    });

    // The same frame that announces id "2" also completes id "1".
    const childAnnounceFrame = res.frames.find((f: any) =>
      (f.pending ?? []).some((p: any) => p.id === "2"),
    );
    expect(childAnnounceFrame?.completed).toEqual([{ id: "1" }]);

    // The stream terminates exactly once.
    expect(res.frames.filter((f: any) => f.hasNext === false).length).toBe(1);
  });
});
