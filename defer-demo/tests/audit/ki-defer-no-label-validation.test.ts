import { describe, it, expect } from "vitest";

/**
 * F10 · KI-DEFER-NO-LABEL-VALIDATION · SYS-REQ-762
 *
 * Finding: our engine (graphql-go-tools rc.267) has NO validation rule that
 * enforces the GraphQL incremental-delivery spec's @defer/@stream `label`
 * constraints:
 *   (a) "Defer And Stream Directive Labels Are Unique" — every @defer/@stream
 *       `label` in a single document must be unique. Colliding labels MUST be a
 *       validation error.
 *   (b) "Defer And Stream Directives Have No Variable Argument On `label`" — the
 *       `label` argument MUST be a static string literal, never a variable.
 *
 * Engine evidence (CONFIRMED present in our rc.267):
 *   pkg/astvalidation/operation_validation.go — DefaultOperationValidator()
 *   registers exactly 18 rules (lines 54-71): AllVariablesUsed,
 *   AllVariableUsesDefined, DocumentContainsExecutableOperation,
 *   OperationNameUniqueness, LoneAnonymousOperation, SubscriptionSingleRootField,
 *   FieldSelections, FieldSelectionMerging, KnownArguments, Values,
 *   ArgumentUniqueness, RequiredArguments, Fragments, DirectivesAreDefined,
 *   DirectivesAreInValidLocations, VariableUniqueness,
 *   DirectivesAreUniquePerLocation, VariablesAreInputTypes. None is a
 *   defer/stream label rule, and there is no operation_rule_*defer* /
 *   *stream* / *label* file in the package at all (grep for "label"/"defer"/
 *   "stream" across pkg/astvalidation/*.go (non-test) hits only an unrelated
 *   stream-equality comment in operation_rule_field_selection_merging.go).
 *
 *   The directive definitions allow the gap: base.graphql declares
 *     directive @defer(label: String, if: Boolean! = true) on FRAGMENT_SPREAD | INLINE_FRAGMENT
 *   and stream.graphql declares `label: String` likewise — a plain `String`
 *   argument with no uniqueness / literal-only constraint, which the generic
 *   argument rules (Values / VariablesAreInputTypes) happily accept for a
 *   `$var` of type String.
 *
 * HTTP verification performed against the live branch router (rc.267, run under
 * -race, http://localhost:3002/graphql):
 *
 *   (a) DUPLICATE label — two sibling @defer(label:"dup") on article(id:"a1"):
 *         { article(id:"a1"){ id
 *             ... @defer(label:"dup"){ title }
 *             ... @defer(label:"dup"){ reviews { id } } } }
 *       => HTTP 200 multipart, NO validation error, BOTH pending entries carry
 *          the same label:
 *          pending: [{"id":"1","path":["article"],"label":"dup"},
 *                    {"id":"2","path":["article"],"label":"dup"}]
 *       Spec-correct behavior: a validation error (colliding labels), NOT a
 *       successful response with two identical labels.
 *
 *   (b) VARIABLE label — @defer(label:$l):
 *         query($l:String){ article(id:"a1"){ id
 *             ... @defer(label:$l){ reviews { id } } } }   vars {"l":"v"}
 *       => HTTP 500 with an EMPTY body (router crash / unhandled internal error),
 *          for every accept header and for {"l":null} too.
 *       Spec-correct behavior: a clean validation error rejecting a variable
 *       `label`, NOT an HTTP 500. (Worse than the audit's "admitted unchecked":
 *       the un-validated variable label drives an internal error.)
 *
 * Overlap with existing confirmed bugs:
 *   (a) == B6 ("dup label accepted").
 *   (b) sibling of B7 ("@defer(if:$strVar) not type-checked") — same class of
 *       missing-validation on a @defer argument, but on `label` (and it crashes
 *       rather than silently mis-behaving). Distinct from BT-1/BT-2/BT-3 (runtime
 *       defer behaviors) and B1 (`if` literal handling).
 *
 * These tests assert the SPEC-CORRECT behavior and therefore FAIL against the
 * current router (RED), proving the missing label-validation.
 */

const ROUTER = process.env.ROUTER_URL || "http://localhost:3002/graphql";

async function postDefer(query: string, variables?: Record<string, unknown>) {
  const r = await fetch(ROUTER, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "multipart/mixed" },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  const ctype = r.headers.get("content-type") || "";
  const text = await r.text();
  if (!ctype.includes("multipart")) {
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: r.status, mode: "single" as const, json, raw: text };
  }
  const frames: any[] = [];
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
  return { status: r.status, mode: "multipart" as const, frames, raw: text };
}

function collectErrors(res: any): any[] {
  if (res.mode === "single") return (res.json && res.json.errors) || [];
  return res.frames.flatMap((f: any) => f.errors || []);
}
function collectPending(res: any): any[] {
  if (res.mode === "single") return [];
  return res.frames.flatMap((f: any) => f.pending || []);
}

describe("F10 KI-DEFER-NO-LABEL-VALIDATION (REPRODUCED_HTTP)", () => {
  it("(a) rejects two @defer fragments sharing the same label as a validation error", async () => {
    const res = await postDefer(
      `{ article(id:"a1"){ id ` +
        `... @defer(label:"dup"){ title } ` +
        `... @defer(label:"dup"){ reviews { id } } } }`,
    );

    const errors = collectErrors(res);
    const pending = collectPending(res);

    // Spec-correct: a duplicate-label validation error and NO deferred pending
    // payloads. Today the router returns 200 with no error and two pending
    // entries both labelled "dup" -> this assertion FAILS (RED).
    expect({ errorCount: errors.length, pending }).toEqual({
      errorCount: 1,
      pending: [],
    });
  });

  it("(b) rejects a variable @defer label with a clean validation error, not HTTP 500", async () => {
    const res = await postDefer(
      `query($l:String){ article(id:"a1"){ id ` +
        `... @defer(label:$l){ reviews { id } } } }`,
      { l: "v" },
    );

    // Spec-correct: this must NOT crash. A variable `label` is forbidden and
    // should yield a normal (HTTP 200) GraphQL validation error. Today the
    // router returns HTTP 500 with an empty body -> this assertion FAILS (RED).
    expect(res.status).toBe(200);
    expect(collectErrors(res).length).toBe(1);
  });
});
