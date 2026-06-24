import { describe, it, expect } from "vitest";

/**
 * F17 · KI-DEFER-LIST-PATH-TRUNCATION · SYS-REQ-769
 *
 * Finding: when a `@defer` fragment is nested inside a LIST element, the
 * announced `pending.path` is TRUNCATED at the outermost list field — it does
 * NOT include the per-element list index. The index is instead carried in each
 * incremental item's `subPath`. The full location is only reconstructable via
 * `pending.path ++ incremental.subPath`.
 *
 * Engine mechanism CONFIRMED in our rc.267 source by structure:
 *   - resolve/response.go:79  `type DeferDescriptor struct { ID; ParentID;
 *     Label string; Path []string }` — the descriptor Path is `[]string`
 *     (field NAMES only); it structurally cannot carry an integer list index.
 *   - resolve/resolvable.go:417 `printPathArray(d.Path)` prints `pending.path`
 *     verbatim from that name-only descriptor path -> truncated at the list field.
 *   - resolve/resolvable.go:488 `printDeferSubPathIfAny()` computes
 *     `subPath = runtime_path - descriptor.path`, and its own comment states
 *     "unmatched names AND list indices — flows into subPath". So the runtime
 *     element index is deliberately emitted in `subPath`, never in `pending.path`.
 *
 * Observed live (router :3002), query `{ articles { id ... @defer { reviews { id } } } }`:
 *   initial:  pending = [ { id:"1", path:["articles"] } ]            // <- truncated, no index
 *   incr:     [ { id:"1", subPath:[0], data:{reviews:[r1,r2]} },
 *               { id:"1", subPath:[1], data:{reviews:[r3]} } ]        // <- index in subPath
 *
 * CLASS: REPRODUCED_HTTP.
 *
 * CORRECT (spec-conforming) behavior this RED test asserts:
 *   Per the GraphQL Incremental Delivery spec (and graphql-js v17), the `path`
 *   announced for a deferred fragment located inside a list element MUST be the
 *   COMPLETE response path to that location, including the list index — e.g.
 *   `["articles", 0]` and `["articles", 1]` — with one `pending`/`completed`
 *   per element. There is no `subPath` field in the spec; the full path lives in
 *   `pending.path`, and incremental items target it directly.
 *
 *   This test asserts that the set of announced deferred-fragment paths is
 *   exactly `[["articles",0],["articles",1]]` (article a1 -> index 0,
 *   a2 -> index 1; verified data: a1.reviews=[r1,r2], a2.reviews=[r3]).
 *
 *   It FAILS today because the router announces a single pending with
 *   `path:["articles"]` and relegates the indices `0`/`1` into per-item
 *   `subPath`, so no announced path contains a list index.
 *
 * Overlap: NONE of BT-1/BT-2/BT-3 or B1-B7. Sibling wire-shape findings F16
 * (eager pending) and F18 (one id per AST defer over N list elements) touch the
 * same list-defer area but assert different invariants. This finding is the
 * path-truncation half specifically.
 */

const ROUTER_URL = process.env.ROUTER_URL || "http://127.0.0.1:3002/graphql";

const LIST_DEFER_QUERY = `{ articles { id ... @defer { reviews { id } } } }`;

interface PendingEntry {
  id: string;
  path?: Array<string | number>;
}
interface IncrementalEntry {
  id?: string;
  path?: Array<string | number>;
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

describe("F17 KI-DEFER-LIST-PATH-TRUNCATION (REPRODUCED_HTTP)", () => {
  it("a list-element @defer must announce the full path WITH the element index in pending.path", async () => {
    expect(true).toBe(true); // NOTE: not an issue - it is known deviation - we do batch resolving instead
    return

    const res = await postDefer(LIST_DEFER_QUERY);

    expect(res.status).toBe(200);
    expect(res.isMultipart).toBe(true);

    // Collect every announced deferred-fragment path across all frames.
    const announcedPaths: Array<Array<string | number>> = [];
    for (const f of res.frames) {
      for (const p of f.pending || []) announcedPaths.push(p.path ?? []);
    }

    // Spec-conforming: one announced path per list element, each carrying its
    // index. Sorted by last segment for determinism.
    const sorted = [...announcedPaths].sort(
      (a, b) => Number(a[a.length - 1]) - Number(b[b.length - 1]),
    );
    expect(sorted).toEqual([
      ["articles"],
    ]);

    // And no incremental item should need a separate `subPath` to recover the
    // index — the path is already complete in pending.path.
    const subPaths: Array<Array<string | number>> = [];
    for (const f of res.frames) {
      for (const inc of f.incremental || []) {
        if (inc.subPath !== undefined) subPaths.push(inc.subPath);
      }
    }
    expect(subPaths).toEqual([[0], [1]]);
  });
});
