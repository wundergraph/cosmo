import { describe, it, expect } from "vitest";

/**
 * F02 · KI-DEFER-STREAM-UNTERMINATED-ON-INITIAL-ERROR · SYS-REQ-781
 *
 * Finding: in ResolveGraphQLDeferResponse the engine registers
 * `writer.Complete()` as the LAST statement, AFTER every initial-phase
 * early-return. If the initial (non-deferred) wave produces an error, the
 * function returns BEFORE Complete() is ever called, so the terminating
 * multipart boundary (`--<boundary>--`) is never written and no terminal
 * `hasNext:false` frame is emitted. A spec-compliant multipart/mixed client
 * waits for the closing delimiter that never arrives -> client hang +
 * goroutine leak.
 *
 * Engine evidence (CONFIRMED present in our rc.267):
 *   graphql-go-tools/v2@rc.267 pkg/engine/resolve/resolve.go
 *   func (r *Resolver) ResolveGraphQLDeferResponse (around line 452):
 *     - render initial response:
 *         err = resolvable.Resolve(...)            // ~line 495
 *         if err != nil { return nil, err }        // ~line 497  EARLY RETURN
 *     - flush initial response:
 *         err = writer.Flush()                     // ~line 500
 *         if err != nil { return nil, err }        // ~line 501  EARLY RETURN
 *     - hasErrors gate (the path this test exercises):
 *         if resolvable.hasErrors() {              // ~line 505
 *             return resolveInfo, nil              // ~line 506  EARLY RETURN
 *         }
 *     - ... DeferTree resolution ...
 *     - writer.Complete()                          // ~line 528  registered AFTER all
 *                                                  // of the above; SKIPPED on any early return
 *
 *   resolve/resolvable.go Resolve (around line 212) renders a data-level
 *   subgraph error into the frame and returns nil (printErr stays nil for a
 *   pure data error), then sets hasErrors() true -> the line ~505 gate fires
 *   and the function returns at ~line 506, NEVER reaching writer.Complete().
 *
 *   The router-side writer that Complete() drives:
 *   router/core/defer_response_writer.go HttpDeferWriter.Complete (line 22):
 *     writes "\r\n--" + multipartBoundary + "--\r\n" (the terminating
 *     `--graphql--` delimiter) and flushes. Because Complete() is never called
 *     on the early-return path, that closing delimiter is never written.
 *
 * Symptom REPRODUCED over HTTP (localhost:3002) with the demo's reachable
 * recoverable error: user(id:"u1").reviews contains a review whose article is
 * null (non-null violation -> DOWNSTREAM_SERVICE_ERROR). Selecting that field
 * in the INITIAL wave alongside a sibling @defer yields a multipart response
 * (Content-Type: multipart/mixed; deferSpec=20220824) whose body ENDS with an
 * OPEN boundary `\r\n\r\n--graphql` (no closing `--graphql--`) and contains NO
 * `"hasNext":false` frame. Observed tail bytes: `...,"data":{"user":null}}\r\n\r\n--graphql`.
 *
 * CORRECT (spec-conforming) behavior this test asserts (so it FAILS today):
 *   Even when the initial response carries errors, the engine MUST still
 *   terminate the incremental-delivery stream: the multipart body MUST end
 *   with the closing boundary `--graphql--` and the stream MUST carry a
 *   terminal `hasNext:false` so the client knows delivery is complete. Today
 *   the stream is left unterminated.
 *
 * Overlap: shares the SAME `resolvable.hasErrors()` early-return (resolve.go
 * ~line 505) with F01 (KI-DEFER-RECOVERABLE-ERROR-DROPS-DEFERS). F01 asserts
 * the data-loss angle (the deferred fragment is dropped, never delivered); F02
 * asserts the transport angle (the stream is never terminated -> client hang).
 * Both reproduce on the same query. Sibling of the termination cluster
 * (F01/F02/F03/F04). Does not map to BT-1/BT-2/BT-3 or B1/B6/B7.
 *
 * NOTE on the audit's original PROBE: the audit framed F02 around a
 * writer-Flush() error driving the early return, which the router's
 * HttpDeferWriter only produces on client disconnect (ctx.Err() != nil) and is
 * therefore not client-inducible as a hang. The DECISIVE, client-reachable
 * early-return on the demo is the `hasErrors()` gate at the same call site, ahead
 * of the same single `writer.Complete()` — so the finding's core claim ("no
 * terminating multipart boundary -> client hangs") is HTTP-reproduced here.
 */

const ROUTER_URL = process.env.ROUTER_URL || "http://localhost:3002/graphql";

// Initial wave selects user.reviews (which carries the demo's reachable
// recoverable error: a review whose non-null `article` is null) alongside a
// sibling @defer on the same entity. The initial error trips the hasErrors()
// early-return, so writer.Complete() is never reached.
const QUERY = `{ user(id:"u1"){ id reviews { id article { id } } ... @defer { username } } }`;

async function fetchMultipart(query: string): Promise<{ status: number; ctype: string; body: string }> {
  const res = await fetch(ROUTER_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "multipart/mixed" },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  return { status: res.status, ctype: res.headers.get("content-type") || "", body };
}

describe("F02 KI-DEFER-STREAM-UNTERMINATED-ON-INITIAL-ERROR (REPRODUCED_HTTP)", () => {
  it("terminates the incremental stream even when the initial response errors", async () => {
    const { status, ctype, body } = await fetchMultipart(QUERY);

    // Sanity: we are on the defer multipart transport (not a single JSON body).
    expect(status).toBe(200);
    expect(ctype).toBe('multipart/mixed; deferSpec=20220824; boundary="graphql"');

    // CORRECT behavior: the multipart body must be terminated with the closing
    // boundary `--graphql--` (written by HttpDeferWriter.Complete). Today the
    // body ends with an open `\r\n\r\n--graphql` and this assertion FAILS.
    expect(body.endsWith("--graphql--\r\n")).toBe(true);

    // CORRECT behavior: a terminal frame must announce hasNext:false so the
    // client knows incremental delivery is complete. Today no such frame is
    // emitted and this assertion FAILS.
    expect(body.includes('"hasNext":false')).toBe(true);
  });
});
