import { describe, it, expect } from "vitest";

/**
 * F09 · KI-DEFER-IF-VARIABLE-NOT-DEFERRED · SYS-REQ-761
 *
 * Finding: the `@defer(if:)` argument is evaluated STRUCTURALLY at NORMALIZATION
 * time (before request variables are bound). When `if:` is a VARIABLE, the
 * normalizer reads the wrong value and the variable is never honored at runtime.
 * A literal `if:true|false` is handled correctly.
 *
 * Mechanism confirmed in OUR engine (graphql-go-tools rc.267) by code structure,
 *   pkg/astnormalization/inline_fragment_expand_defer.go (EnterInlineFragment):
 *
 *     enabled := true
 *     ifValue, hasIf := f.operation.DirectiveArgumentValueByName(directiveRef, literal.IF)
 *     if hasIf {
 *         enabled = bool(f.operation.BooleanValue(ifValue.Ref))   // <-- no Kind check
 *     }
 *
 *   `DirectiveArgumentValueByName` returns an `ast.Value`. For `@defer(if:$d)` its
 *   `Kind == ast.ValueKindVariable`, but the code unconditionally calls
 *   `BooleanValue(ifValue.Ref)`, treating the variable ref as an index into the
 *   `BooleanValues` table. The variable's runtime value is unavailable at
 *   normalization, so the read does NOT reflect `$d`; the defer ends up applied
 *   regardless of the supplied `$d`.
 *
 *   Contrast: pkg/astnormalization/directive_include_skip.go (the @skip/@include
 *   normalizer) DOES switch on `value.Kind` (ValueKindBoolean vs ValueKindVariable,
 *   resolving the variable's actual value). The defer normalizer lacks that branch.
 *
 * OBSERVED on the live demo router (graphql-go-tools rc.267, localhost:3002):
 *   query($d:Boolean!){ article(id:"a1"){ id ... @defer(if:$d){ reviews{id} } } }
 *     {"d": false}  -> multipart/mixed with  {"pending":[{"id":"1","path":["article"]}],"hasNext":true}
 *                      i.e. the fragment is STILL DEFERRED even though $d=false.
 *     {"d": true}   -> multipart/mixed with a pending (coincidentally correct).
 *   Literal control (proves the router CAN collapse a disabled defer):
 *     ... @defer(if:false){ reviews{id} }  -> single application/json,
 *         {"data":{"article":{"id":"a1","reviews":[{"id":"r1"},{"id":"r2"}]}}}
 *
 * CLASS: REPRODUCED_HTTP.
 *
 * CORRECT (spec-conforming) behavior this RED test asserts:
 *   Per the Incremental Delivery spec, `@defer(if:)` defers ONLY when `if`
 *   evaluates to `true`. With `$d=false` the directive is inert: the fragment
 *   MUST be folded into the initial response exactly as if no `@defer` were
 *   present. So `@defer(if:$d=false)` MUST produce the SAME single, non-multipart
 *   response as the literal `@defer(if:false)` form. It FAILS today because the
 *   variable form returns a multipart stream that defers `reviews`.
 *
 * Overlap: SAME root cause as B1 ("@defer(if:$var=false) still streams"); the
 * audit's F09 prose framed the symptom as "collapsed", but on our rc.267 the
 * observable is the B1 direction (variable ignored -> always defers). Both stem
 * from the missing runtime-variable evaluation of `if:`. No overlap with
 * BT-1/BT-2/BT-3 (those are data/termination/race bugs).
 */

const ROUTER_URL = process.env.ROUTER_URL || "http://127.0.0.1:3002/graphql";

type Probe = { status: number; isMultipart: boolean; raw: string; json: any | null };

async function probe(query: string, variables?: Record<string, unknown>): Promise<Probe> {
  const r = await fetch(ROUTER_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "multipart/mixed" },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  const raw = await r.text();
  const ctype = r.headers.get("content-type") || "";
  const isMultipart = ctype.includes("multipart");
  let json: any | null = null;
  if (!isMultipart) {
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }
  }
  return { status: r.status, isMultipart, raw, json };
}

// Parse a multipart/mixed @defer stream into its JSON frames.
function parseFrames(raw: string): any[] {
  const frames: any[] = [];
  for (const part of raw.split(/\r?\n--graphql/)) {
    const sep = part.indexOf("\r\n\r\n") >= 0 ? part.indexOf("\r\n\r\n") + 4
      : part.indexOf("\n\n") >= 0 ? part.indexOf("\n\n") + 2 : -1;
    if (sep < 0) continue;
    const body = part.slice(sep).trim();
    if (!body || body.startsWith("--")) continue;
    try {
      frames.push(JSON.parse(body));
    } catch {
      // ignore non-JSON boundary tails
    }
  }
  return frames;
}

const QUERY = `query($d:Boolean!){ article(id:"a1"){ id ... @defer(if:$d){ reviews{id} } } }`;

// The exact single-response shape a disabled defer must collapse to (matches the
// literal `@defer(if:false)` control and the no-directive query).
const COLLAPSED = {
  data: { article: { id: "a1", reviews: [{ id: "r1" }, { id: "r2" }] } },
};

describe("F09 KI-DEFER-IF-VARIABLE-NOT-DEFERRED (REPRODUCED_HTTP)", () => {
  it("literal @defer(if:false) collapses to a single inline response (control)", async () => {
    const res = await probe(
      `{ article(id:"a1"){ id ... @defer(if:false){ reviews{id} } } }`,
    );
    expect(res.status).toBe(200);
    expect(res.isMultipart).toBe(false);
    expect(res.json).toEqual(COLLAPSED);
  });

  it("@defer(if:$d) with $d=false MUST collapse like if:false (not defer)", async () => {
    const res = await probe(QUERY, { d: false });
    expect(res.status).toBe(200);

    // Spec: if:false makes @defer inert -> a single, non-multipart response with
    // reviews folded into the initial payload. Today the router returns a
    // multipart stream and defers reviews instead (variable ignored at runtime).
    expect(res.isMultipart).toBe(false);
    expect(res.json).toEqual(COLLAPSED);
  });

  it("@defer(if:$d) with $d=true defers (the working direction)", async () => {
    const res = await probe(QUERY, { d: true });
    expect(res.status).toBe(200);
    expect(res.isMultipart).toBe(true);

    const frames = parseFrames(res.raw);
    expect(frames).toEqual([
      {
        data: { article: { id: "a1" } },
        pending: [{ id: "1", path: ["article"] }],
        hasNext: true,
      },
      {
        incremental: [{ data: { reviews: [{ id: "r1" }, { id: "r2" }] }, id: "1" }],
        completed: [{ id: "1" }],
        hasNext: false,
      },
    ]);
  });
});
