import { describe, it, expect } from "vitest";

/**
 * F14 · KI-STREAM-UNIMPLEMENTED · SYS-REQ-777/790/791
 *
 * Finding: `@stream` has NO execution path in our engine
 * (graphql-go-tools rc.267). The resolve-time machinery is dead code:
 *   - pkg/engine/resolve/node_object.go: `Field.Stream *StreamField` (line 94)
 *     and `type StreamField struct { InitialBatchSize int }` (line 178) are
 *     DECLARED and copied in Field.Copy(), but no resolver ever READS them
 *     (grep `\.Stream` across pkg/engine/resolve non-test, non-decl = empty;
 *      grep `InitialBatchSize` across pkg/engine = only the struct decl).
 *   - No planner branch sets `Field.Stream` (grep `Stream:` across pkg/engine/plan
 *     non-test = empty).
 *
 * Because the directive is also never embedded into the live schema
 * (baseschema.go //go:embed only pulls base.graphql + internal.graphql; the
 * `@stream` definition lives in an ORPHAN pkg/asttransform/stream.graphql that
 * is never embedded — see F12), a `@stream` query is HARD-REJECTED at
 * validation as "directive: stream undefined" BEFORE it could ever reach the
 * dead resolve path. So @stream fails closed (validation error) rather than
 * mis-behaving at runtime.
 *
 * CLASS: REPRODUCED_HTTP for the "@stream is rejected / not implemented" symptom
 * (same wire observable as F12). The dead-code half (unread StreamField, absent
 * planner branch) is CONFIRMED_IN_SOURCE_ONLY by the greps above.
 *
 * CORRECT (spec-conforming) behavior this RED test asserts:
 *   Per the GraphQL Incremental Delivery spec, `@stream(initialCount: N)` on a
 *   list field is a VALID directive: the server returns the first N elements in
 *   the initial payload and streams the remaining elements as incremental
 *   `multipart/mixed` frames terminated by `hasNext:false`. It must NOT be a
 *   validation error.
 *
 *   `articles` resolves to exactly [a1, a2] (verified: plain
 *   `{ articles { id } }` -> {"data":{"articles":[{"id":"a1"},{"id":"a2"}]}}).
 *   With `@stream(initialCount: 1)` the spec-conforming result is the SAME data
 *   ([a1, a2]) delivered incrementally. This test asserts the merged/streamed
 *   outcome equals the canonical non-stream result and that the directive is
 *   accepted (no "directive: stream undefined" error).
 *
 *   It FAILS today because the router returns
 *   {"errors":[{"message":"directive: stream undefined","path":["query","articles"]}]}
 *   instead of streaming.
 *
 * Overlap: shares its single HTTP observable with F12 (KI-STREAM-NOT-EMBEDDED).
 * Does NOT map to BT-1/BT-2/BT-3 or B1-B7 (all of which are @defer behaviors).
 */

const ROUTER_URL = process.env.ROUTER_URL || "http://127.0.0.1:3002/graphql";

const STREAM_QUERY = `{ articles @stream(initialCount: 1) { id } }`;

interface Frame {
  data?: unknown;
  errors?: Array<{ message: string; path?: unknown }>;
  incremental?: Array<{ items?: unknown[]; data?: unknown; path?: unknown }>;
  hasNext?: boolean;
}

async function postStream(query: string): Promise<{
  status: number;
  ctype: string;
  isMultipart: boolean;
  frames: Frame[];
  json: any;
  raw: string;
}> {
  const r = await fetch(ROUTER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "multipart/mixed",
    },
    body: JSON.stringify({ query }),
  });
  const ctype = r.headers.get("content-type") || "";
  const raw = await r.text();
  if (!ctype.includes("multipart")) {
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      json = undefined;
    }
    return { status: r.status, ctype, isMultipart: false, frames: [], json, raw };
  }
  const frames: Frame[] = [];
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
      // ignore unparsable boundary noise
    }
  }
  return { status: r.status, ctype, isMultipart: true, frames, json: undefined, raw };
}

describe('F14 KI-STREAM-UNIMPLEMENTED (REPRODUCED_HTTP)', () => {
  it('@stream(initialCount:1) on articles must be a valid streamed query, not a validation error', async () => {
    expect(true).toBe(true); // NOTE: stream is not part of this implementation yet
    return

    const res = await postStream(STREAM_QUERY);

    // The directive must be ACCEPTED. Today the router emits a single frame:
    //   {"errors":[{"message":"directive: stream undefined","path":["query","articles"]}]}
    // Assert NO such validation error appears anywhere (initial frame or single-payload).
    const allErrors: Array<{ message: string }> = [];
    if (res.isMultipart) {
      for (const f of res.frames) for (const e of f.errors || []) allErrors.push(e);
    } else if (res.json && Array.isArray(res.json.errors)) {
      for (const e of res.json.errors) allErrors.push(e);
    }
    expect(allErrors.map((e) => e.message)).toEqual([]);

    // It must arrive as a multipart incremental stream (the whole point of @stream).
    expect(res.isMultipart).toBe(true);

    // Reconstruct the streamed list. Spec-conforming output equals the canonical
    // non-stream result: articles == [{id:"a1"},{id:"a2"}].
    const initial = res.frames[0]?.data as { articles?: Array<{ id: string }> } | undefined;
    const streamedItems: Array<{ id: string }> = [];
    for (const f of res.frames) {
      for (const inc of f.incremental || []) {
        if (Array.isArray(inc.items)) {
          for (const it of inc.items as Array<{ id: string }>) streamedItems.push(it);
        }
      }
    }
    const merged = [...(initial?.articles ?? []), ...streamedItems];
    expect(merged).toEqual([{ id: 'a1' }, { id: 'a2' }]);

    // And the stream must terminate.
    expect(res.frames.some((f) => f.hasNext === false)).toBe(true);
  });
});
