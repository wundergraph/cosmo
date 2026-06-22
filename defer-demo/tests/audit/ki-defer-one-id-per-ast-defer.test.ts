import { describe, it, expect } from "vitest";

/**
 * F18 · KI-DEFER-ONE-ID-PER-AST-DEFER · SYS-REQ-770
 *
 * Finding: a `@defer` fragment nested inside an N-element list is delivered
 * under a SINGLE incremental id. One `pending` is announced and one `completed`
 * closes the whole list, regardless of how many list elements matched. Per
 * graphql-js v17 / the Incremental Delivery spec, the executor mints ONE id per
 * list element (one `pending` and one `completed` per element). No data is lost
 * in our engine — every element's data still arrives via per-item `subPath` —
 * but per-element completion granularity is lost (a client cannot observe that
 * `articles[0]` finished before `articles[1]`).
 *
 * Engine mechanism CONFIRMED in our rc.267 source by structure:
 *   - resolve/response.go:110 `type DeferFetchGroup struct { DeferID int; ... }`
 *     — there is exactly ONE fetch group per AST `@defer` (keyed by DeferID),
 *     NOT one per matched list element.
 *   - resolve/response.go:79 `type DeferDescriptor struct { ID; ParentID;
 *     Label string; Path []string }` — one descriptor per AST defer; its `ID`
 *     is a single integer.
 *   - resolve/resolve.go:604 `descriptor := dc.resolvable.deferDescriptors[group.DeferID];
 *     dc.resolvable.currentDefer = &descriptor` then a single call to
 *     `ResolveDefer(...)` renders the ENTIRE list under that one descriptor.
 *   - resolve/resolvable.go:270 `ResolveDefer` emits exactly ONE `completed`
 *     entry: `{"id":"<currentDefer.ID>"}` (line 312-336), after walking all list
 *     elements into multiple `incremental` items distinguished only by `subPath`.
 *   - resolve/resolvable.go:366 `printPendingEntries` announces one `pending`
 *     entry per descriptor (one per AST defer), not per element.
 *
 * Observed live (router :3002), query
 *   `{ articles { id ... @defer { reviews { id } } } }`  (a1, a2 -> 2 elements):
 *   initial:  pending   = [ { id:"1", path:["articles"] } ]      // ONE id
 *   incr:     [ { id:"1", subPath:[0], data:{reviews:[r1,r2]} },
 *               { id:"1", subPath:[1], data:{reviews:[r3]} } ]    // same id, two items
 *   final:    completed = [ { id:"1" } ]                          // ONE completed
 *
 * CLASS: REPRODUCED_HTTP.
 *
 * CORRECT (spec-conforming) behavior this RED test asserts:
 *   For a `@defer` located inside a list of N elements, the executor MUST mint
 *   one distinct id per element: N `pending` entries (one per element) and N
 *   `completed` entries (one per element). With the demo's two articles this is
 *   exactly 2 distinct pending ids and 2 completed entries.
 *
 *   This test FAILS today because the router announces exactly ONE pending id
 *   and emits exactly ONE completed for the whole list — collapsing per-element
 *   completion onto a single AST-defer id.
 *
 * Overlap: NONE of BT-1/BT-2/BT-3 or B1-B7. Shares the list-defer surface with
 * F16 (eager pending) and F17 (path truncation) but asserts a distinct
 * invariant: id/completion CARDINALITY (one-per-element), not path shape.
 */

const ROUTER_URL = process.env.ROUTER_URL || "http://127.0.0.1:3002/graphql";

const LIST_DEFER_QUERY = `{ articles { id ... @defer { reviews { id } } } }`;

interface PendingEntry {
  id: string;
  path?: Array<string | number>;
}
interface IncrementalEntry {
  id?: string;
  subPath?: Array<string | number>;
  data?: unknown;
}
interface Frame {
  data?: unknown;
  pending?: PendingEntry[];
  incremental?: IncrementalEntry[];
  completed?: Array<{ id: string }>;
  hasNext?: boolean;
}

async function postDefer(query: string): Promise<{
  status: number;
  ctype: string;
  isMultipart: boolean;
  frames: Frame[];
  raw: string;
}> {
  const r = await fetch(ROUTER_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "multipart/mixed" },
    body: JSON.stringify({ query }),
  });
  const ctype = r.headers.get("content-type") || "";
  const raw = await r.text();
  const frames: Frame[] = [];
  if (ctype.includes("multipart")) {
    for (const part of raw.split(/\r?\n--graphql/)) {
      const sep =
        part.indexOf("\r\n\r\n") >= 0
          ? part.indexOf("\r\n\r\n") + 4
          : part.indexOf("\n\n") >= 0
            ? part.indexOf("\n\n") + 2
            : -1;
      if (sep < 0) continue;
      const body = part.slice(sep).trim();
      if (!body || body.startsWith("--")) continue;
      try {
        frames.push(JSON.parse(body));
      } catch {
        // ignore boundary noise
      }
    }
  }
  return {
    status: r.status,
    ctype,
    isMultipart: ctype.includes("multipart"),
    frames,
    raw,
  };
}

describe("F18 KI-DEFER-ONE-ID-PER-AST-DEFER (REPRODUCED_HTTP)", () => {
  it("a list-element @defer must mint one id per element (one pending + one completed per element)", async () => {
    const res = await postDefer(LIST_DEFER_QUERY);

    expect(res.status).toBe(200);
    expect(res.isMultipart).toBe(true);

    // Collect every announced pending id and every completed id across frames.
    const pendingIds: string[] = [];
    const completedIds: string[] = [];
    const incrementalIds: string[] = [];
    for (const f of res.frames) {
      for (const p of f.pending || []) pendingIds.push(p.id);
      for (const c of f.completed || []) completedIds.push(c.id);
      for (const inc of f.incremental || []) if (inc.id !== undefined) incrementalIds.push(inc.id);
    }

    const distinctPending = [...new Set(pendingIds)];
    const distinctCompleted = [...new Set(completedIds)];

    // The demo has two articles (a1, a2) -> two list elements with deferred
    // `reviews`. Spec-conforming: one id per element.
    expect(distinctPending.length).toBe(2);
    expect(distinctCompleted.length).toBe(2);

    // The two deferred elements deliver under TWO distinct incremental ids,
    // not a single shared id with subPath disambiguation.
    expect([...new Set(incrementalIds)].length).toBe(2);
  });
});
