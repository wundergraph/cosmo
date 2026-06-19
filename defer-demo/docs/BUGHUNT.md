# Cosmo Router `@defer` — Adversarial Bug Hunt

Date: 2026-06-19.
Branch: `dazed-geology`.
Method: a multi-perspective adversarial sweep (the "STORM" framing — adapted to defer failure-hunting).
Five independent expert lenses generated and executed adversarial probes against the live router (`localhost:3002`); every candidate was then **reproduced on the wire by the orchestrator** before being recorded.
Claims that did not reproduce were dropped.

Important: no router or subgraph code was modified.
These are characterizations of observed behavior, not fixes.
They sit on top of the `RESULTS.md` suite (33/33 happy-path tests passed) — these are the cases that suite did not cover.

## Why this found things the 33-test suite did not

The passing suite tested the literal `@defer(if:false)`, single-branch abstract defer, and happy-path data only.
The bugs below live in the gaps: **variable-valued directive arguments**, **multiple/sibling defers**, **abstract + interfaceObject combinations**, and **error / null-propagation paths**.
Single-pass, confirmation-biased test design is structurally blind to exactly these.

## Confirmed bugs

| # | Severity | Bug | Trigger | Verified |
|---|----------|-----|---------|----------|
| B1 | **High** | `@defer(if:)` not evaluated at runtime — a variable resolving to `false` still defers | `@defer(if:$d)`, `$d=false` | streams multipart instead of single JSON |
| B2 | **High** | Panic → HTTP 500 (empty body) on multiple variable-`if` defers | two `@defer(if:$x)` in one op | `index out of range [2] with length 2`, recovered |
| B3 | **High** | Panic → HTTP 500 (empty body) on `@defer(label:$var)` | `@defer(label:$l)` | same panic; should be a validation error |
| B4 | **High** | Sibling type-conditional `@defer` onto an `@interfaceObject` field: 2nd branch silently dropped | `...on Article @defer{stats}` + `...on Podcast @defer{stats}` | 6/6: `pending id 3` never completes, data lost |
| B5 | **High** | Errors inside a deferred fragment are silently swallowed | deferred selection that null-propagates a non-null error | error vanishes; client sees clean success |
| B6 | Medium | "Defer/stream labels are unique" validation missing | two `@defer(label:"dup")` | both accepted, both `label:"dup"` |
| B7 | Low | `@defer(if:)` variable type not checked | `@defer(if:$s)` with `$s: String!` | executes; no variable-type error |

### B1 — `@defer(if:)` ignores runtime variable value (only the literal is folded)

`HIGH` · spec/protocol divergence · confirmed on wire.

```graphql
query($d: Boolean!){ article(id:"a1"){ id title ... @defer(if:$d){ reviews{ id rating } } } }
# variables: { "d": false }
```

Observed: `Content-Type: multipart/mixed; deferSpec=20220824` with two frames — `reviews` is deferred exactly as if `if:true`.
Same for `query($d: Boolean = false)` with no variable passed.
By contrast the literal `... @defer(if:false){...}` correctly returns a single `application/json` response with `reviews` inline (this is what test DT-05 covered).

Expected: per the GraphQL incremental-delivery spec the `if` argument is a runtime Boolean; when it resolves to `false` the fragment must be treated as if `@defer` were absent — a single, non-incremental response — regardless of literal vs variable.

Root cause (from the code): the router has no defer config flag; defer is selected at planning time when the op contains `@defer`, and `astnormalization.WithInlineDefer()` can statically fold a literal-`false` defer.
A variable-valued `if` is unknown at normalization, so a `*plan.DeferResponsePlan` is still produced and the coerced value is never re-checked at execution.

### B2 / B3 — index-out-of-range panic (HTTP 500) on variable-valued defer arguments

`HIGH` · robustness / availability · confirmed on wire (recovery middleware catches the panic).

```graphql
# B2 — two variable-if defers (panics for ALL combinations of a/b true|false):
query($a:Boolean!,$b:Boolean!){
  article(id:"a1"){ id ...@defer(if:$a){ reviews{id} } ...@defer(if:$b){ relatedContent{__typename} } }
}
# variables: { "a": true, "b": true }

# B3 — variable label:
query($l:String!){ article(id:"a1"){ id ...@defer(label:$l){ reviews{id} } } }
# variables: { "l": "dynamic" }
```

Observed: `HTTP 500`, `Content-Type: null`, zero-length body.
Router log: `[Recovery from panic] ... "error": "runtime error: index out of range [2] with length 2"` (and `[1] with length 1` for the single-defer variant), at `requestlogger.go:177`.
The process does not die (the panic is recovered per-request), but every such request 500s — a cheap DoS vector and a clear unhandled code path.

Expected: B2 is a fully valid operation and should return a normal `200 multipart/mixed` (or single JSON if all `if` resolve false).
B3 is invalid per spec (`label` must be a string literal, not a variable) and should return a clean GraphQL validation error (`{"errors":[...]}`), not a panic.

Note: a single `@defer(if:$var)` does **not** panic (it mis-behaves per B1 instead).
The panic needs either multiple variable-arg defers (B2) or a variable `label` (B3).

### B4 — sibling type-conditional defer onto `@interfaceObject`: second branch dropped

`HIGH` · data loss + protocol violation · confirmed 6/6 (deterministic).

```graphql
{ article(id:"a1"){ id ... @defer {
    relatedContent {
      __typename id
      ... on Article @defer { stats { views } }
      ... on Podcast @defer { stats { views } }
    }
} } }
```

`relatedContent` = `[Article a2, Podcast p1]`.
Initial `pending` announces three ids: `1` (`["article"]`), `2` and `3` (both `["article","relatedContent"]`).
Frames delivered: id `1` (relatedContent), then id `2` (`stats.views=3200` for the Article element, `subPath:[0]`) carrying `hasNext:false`.
**id `3` (the Podcast branch) is never delivered and never completed** — `p1.stats` is dropped and the stream terminates with `pending id 3` dangling.

Expected: every announced `pending` id must terminate with a matching `completed`, and `hasNext:false` may only appear after all pending are accounted for.
The Podcast element's `stats` must be delivered.

### B5 — errors in a deferred fragment are silently swallowed

`HIGH` · error + data integrity · confirmed on wire.

```graphql
{ user(id:"u1"){ id ... @defer { reviews { id rating readingTimeAdjusted } } } }
```

`u1.reviews` includes a review whose `article` is null; `readingTimeAdjusted` is non-null, so it null-propagates.

Normal mode (no `@defer`) correctly surfaces the error:
```json
{"errors":[{"message":"Cannot return null for non-nullable field 'Query.user.reviews'.", ...
            "Failed to fetch from Subgraph 'reviews' ... the requested element is null which the schema does not allow"}]}
```

Defer mode returns:
```
{"data":{"user":{"id":"u1"}},"pending":[{"id":"1","path":["user"]}],"hasNext":true}
{"incremental":[],"completed":[{"id":"1"}],"hasNext":false}
```
The reconstructed document is `{"data":{"user":{"id":"u1"}}}` with **no errors** — the failure is completely invisible to the client.

Expected: per the incremental-delivery spec (and this repo's own `DESIGN.md` §3.5), a deferred fragment that null-propagates through a non-nullable chain must carry its `errors` in `completed[].errors` (with the `incremental` payload omitted).
Here the error is dropped entirely.

### B6 — missing "labels are unique" validation

`Medium` · missing validation · confirmed on wire.

```graphql
{ article(id:"a1"){ id
    ...@defer(label:"dup"){ reviews{ id } }
    ...@defer(label:"dup"){ relatedContent{ __typename } }
} }
```

Observed: `200 multipart`, `pending:[{id:"1",...,label:"dup"},{id:"2",...,label:"dup"}]` — both accepted.
Expected: the spec validation rule *Defer And Stream Directive Labels Are Unique* should reject this at validation with an `{"errors":[...]}` response.

### B7 — `@defer(if:)` variable type not checked

`Low` · missing validation · confirmed on wire.

```graphql
query($l:String!){ article(id:"a1"){ id ...@defer(if:$l){ reviews{ id } } } }
# variables: { "l": "x" }
```

A `String!`-typed variable is accepted in the `Boolean!` `if` position and the fragment defers normally.
Expected: a variables-in-allowed-position validation error.

## Minor / spec nits (reproduced, low impact)

- **Trailing multipart framing.** Every deferred stream ends with `...}\r\n\r\n--graphql\r\n--graphql--\r\n` — a dangling opening boundary immediately before the close-delimiter.
  Lenient parsers (Apollo client, and the parser in `tests/`) tolerate it; a strict RFC 2046 reader could reject the empty trailing part.
- **Empty `incremental:[]` under a null parent.** `{ organization(id:"NOPE"){ id ...@defer{ subscription{ status } } } }` announces a `pending` entry, then emits a frame with `"incremental":[]` rather than omitting `incremental` (or not announcing the pending at all). Reconstructs fine.

## Investigated, NOT confirmed

- **Nested-defer over-delivery / duplicate delivery.** One lens reported a single capture where an outer (`id:1`) frame carried inner-deferred fields (and they were re-delivered later).
  Re-running the exact 3-level nested query **12 times** produced clean, identical results every time (`dangling=[]`, exactly one `hasNext:false`, outer frame never carries inner fields).
  Could not reproduce; if real it is extremely rare/timing-dependent.
  Not counted as a bug.

## Honest scope notes

- All findings are about the response protocol / planner / error handling, not about the gqlgen subgraphs (whose data resolves correctly in normal mode).
- B2/B3 share one root panic (`index out of range` in defer argument handling with variables); they are listed separately because the triggers and correct outcomes differ.
- These were found by deliberately attacking variable-args, multi/sibling defers, abstract+interfaceObject, and error paths — the dimensions a happy-path suite skips. The five-lens diversity is what surfaced them: B1/B2 (spec-lawyer + engine-archaeologist), B2/B3/B6/B7 (chaos-adversary), B4 (federation-breaker), B5 (error-nullability inspector).

## Independent verification (OpenAI Codex)

An independent second opinion (OpenAI Codex, read-only, reasoning=high) reviewed the router source plus these repro docs and **confirmed all seven bugs (B1–B7) and minor (a)**, with the same severities and the same fix order (B2/B3 → B5/B4 → B1 → B6/B7 → framing).
It classified minor (b) as tolerable (reconstruction is unchanged).
Two refinements it added:

- **B1 cache-key gap.** The normalization cache key salts only `@skip`/`@include` directive variables, not `@defer(if:)` (`router/core/operation_processor.go` ~1262 / ~1450).
  So a correct fix must both re-check the coerced `if` value AND include the defer variable in the normalization cache key, or cached plans would cross-contaminate.
- **Minor (a) router-side root cause.** `defer_response_writer.go` `Flush()` always appends the next opening boundary after each JSON payload, and `Complete()` writes the close delimiter separately — producing the empty trailing part before `--graphql--`.

Cross-model agreement is corroboration, not proof — but two independent systems reaching the same verdicts from different evidence (Codex from source, this hunt from the wire) materially raises confidence.
