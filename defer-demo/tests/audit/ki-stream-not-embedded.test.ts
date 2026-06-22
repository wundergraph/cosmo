import { describe, it, expect } from "vitest";

/**
 * F12 · KI-STREAM-NOT-EMBEDDED · SYS-REQ-776/777/786/787
 *
 * Finding: the `@stream` directive DEFINITION ships in the engine as an ORPHAN
 * file that is never `//go:embed`-ed into the base schema, so the directive is
 * unknown to the router's schema and every `@stream` query is hard-rejected at
 * validation with "directive: stream undefined".
 *
 * Mechanism confirmed in OUR engine (graphql-go-tools rc.267) by code structure:
 *   - pkg/asttransform/baseschema.go embeds ONLY:
 *       //go:embed base.graphql      -> baseSchema          (contains @defer)
 *       //go:embed internal.graphql  -> internalDefinition  (contains @__defer_internal)
 *     and MergeDefinitionWithBaseSchemaWithInternal appends only those two.
 *   - pkg/asttransform/stream.graphql EXISTS and declares `directive @stream(...)`,
 *     but NOTHING references it (grep `stream.graphql` across pkg = no embed, no
 *     loader). It is dead on disk.
 *
 * CLASS: REPRODUCED_HTTP. The "stream is not part of the schema" symptom is
 * directly observable on the live demo router two independent ways (both asserted
 * below): schema introspection omits `stream`, and a `@stream` query is rejected
 * as an unknown directive. `@defer` (embedded in base.graphql) works in both.
 *
 * CORRECT (spec-conforming) behavior this RED test asserts:
 *   The GraphQL Incremental Delivery spec defines `@stream` as a standard
 *   directive that a conformant server MUST expose on its schema alongside
 *   `@defer`. So:
 *     (1) `__schema.directives` MUST contain "stream" (just as it contains "defer").
 *     (2) A `{ articles @stream(initialCount: 1) { id } }` query MUST NOT be
 *         rejected with "directive: stream undefined".
 *
 *   FAILS today because the live router reports directives
 *     ["defer","deprecated","include","oneOf","skip","specifiedBy"]  (no "stream")
 *   and answers the @stream query with
 *     {"errors":[{"message":"directive: stream undefined","path":["query","articles"]}]}.
 *
 * Overlap: shares its HTTP observable with F14 (KI-STREAM-UNIMPLEMENTED), which
 * covers the dead resolve path; this test pins the upstream cause (definition not
 * embedded in the schema). Does NOT map to BT-1/BT-2/BT-3 or B1-B7 (all @defer).
 */

const ROUTER_URL = process.env.ROUTER_URL || "http://127.0.0.1:3002/graphql";

async function postJson(query: string): Promise<{ status: number; json: any }> {
  const r = await fetch(ROUTER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const raw = await r.text();
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    json = { __unparsable: raw };
  }
  return { status: r.status, json };
}

describe("F12 KI-STREAM-NOT-EMBEDDED (REPRODUCED_HTTP)", () => {
  it("the @stream directive must be present in the schema (introspection), like @defer", async () => {
    const { status, json } = await postJson(`{ __schema { directives { name } } }`);
    expect(status).toBe(200);
    const names: string[] = (json.data?.__schema?.directives ?? [])
      .map((d: { name: string }) => d.name)
      .sort();

    // Spec-conforming directive set MUST include both incremental-delivery
    // directives. Today "stream" is missing.
    expect(names).toEqual([
      "defer",
      "deprecated",
      "include",
      "oneOf",
      "skip",
      "specifiedBy",
      "stream",
    ]);
  });

  it("@stream(initialCount:1) must NOT be rejected as an unknown directive", async () => {
    const { status, json } = await postJson(
      `{ articles @stream(initialCount: 1) { id } }`,
    );
    expect(status).toBe(200);

    // The directive must be recognized. Today the router returns exactly:
    //   {"errors":[{"message":"directive: stream undefined","path":["query","articles"]}]}
    const messages: string[] = Array.isArray(json.errors)
      ? json.errors.map((e: { message: string }) => e.message)
      : [];
    expect(messages).toEqual([]);
  });
});
