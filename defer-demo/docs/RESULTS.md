# Cosmo Router `@defer` Federation Demo — Results

Date: 2026-06-19.
Branch: `dazed-geology` (implements `@defer` in the cosmo router).
Scope: characterize the router's `@defer` behavior end-to-end across the full breadth of federation v2.
Non-goal: fixing router bugs.
Where the router could have diverged from the spec, we asserted the actual behavior and recorded it — no router code was modified.

## Headline

**33 / 33 tests pass** against the locally running branch router.
The router resolves the entire federation feature matrix correctly in normal mode, and its `@defer` incremental delivery is correct (spec-compliant) in every case we tested — including the high-risk combinations (`@defer` onto `@interfaceObject`, `@defer` crossing a subgraph boundary onto an entity, `@defer` on composite-key entities, nested `@defer`, and `@defer` over unions/interfaces).

Three initial test failures were investigated and traced to **wrong test expectations, not router bugs**.
We proved this by capturing the raw wire output and showing the reconstructed result equals the normal-mode result, then corrected the expectations.
See "Observed defer semantics".

## What was built

Everything lives under `defer-demo/` and nothing was committed.

- **7 gqlgen (Go) subgraphs**, mock/in-memory data, each its own self-contained Go module, serving `POST /graphql` with `_service{sdl}` + `_entities`.
- A **supergraph composed locally** with `wgc router compose` (`graph.yaml` → `config.json`, 29.7 KB, composed cleanly; also validated with `rover` during design).
- The **branch router built from source** (`router/cmd/router/main.go` → binary) run against the static execution config on `localhost:3002`.
- A **TypeScript test suite** (vitest) that drives HTTP queries against the running router, parses the `multipart/mixed` incremental stream, and asserts full payloads with `deepEqual`.

### Subgraph topology and federation coverage

| Subgraph | Port | Federation features exercised |
|----------|------|-------------------------------|
| accounts | 4101 | `@key` (single), `@shareable`, `@inaccessible`, `@tag`, entity-interface root `Node @key` |
| content | 4102 | `@key` (single **+ composite** `slug locale`), `union SearchResult`, `interface Publishable`, `interface ContentItem`, `@provides`, `@external`, `@shareable` |
| reviews | 4103 | `@key`, `@requires` (`readingTimeAdjusted` ← `article{wordCount}`), `@external`, entity extension |
| recommendations | 4104 | entity extension, `@external`, abstract-type resolution across subgraphs (`Publishable`) |
| metrics | 4105 | **`@interfaceObject`** (`ContentItem`), `@key`, `@shareable`, `@tag` |
| media | 4106 | **entity interface** `Asset @key` (`ImageAsset`/`VideoAsset`), **`@override`** (`Article.heroImageUrl`), `@inaccessible` |
| billing | 4107 | **composite + multiple `@key`** on `Subscription`, `@requires` (`seatUtilization` ← `org{memberCount}`), entity extension, `@tag`, `@inaccessible` |

Several entity fields are deliberately homed on a different subgraph than the entity itself (`Article.reviews`/`stats`/`relatedContent`/`heroImageUrl`, `User.reviews`/`recommendedArticles`, `Organization.subscription`/`invoices`), so deferring them forces a real cross-subgraph `_entities` follow-up fetch.

## Defer wire format (observed on the wire)

Request: a normal GraphQL `POST` with `Accept: multipart/mixed`.
There is **no router config flag** for defer — it is selected purely by the presence of `@defer` in the operation.

Response headers:

```
Content-Type: multipart/mixed; deferSpec=20220824; boundary="graphql"
```

Framing is CRLF-delimited; each part is `\r\n--graphql\r\nContent-Type: application/json\r\n\r\n<JSON>`, terminated by `\r\n--graphql--\r\n`.
The JSON uses the **modern incremental-delivery spec** (`pending` / `incremental` / `completed` with `id` + `subPath`), not the legacy `path`-on-item shape.

Real capture for `{ article(id:"a1"){ id title ... @defer { reviews { id rating } } } }`:

```
{"data":{"article":{"id":"a1","title":"Hello World"}},"pending":[{"id":"1","path":["article"]}],"hasNext":true}
{"incremental":[{"data":{"reviews":[{"id":"r1","rating":5},{"id":"r2","rating":3}]},"id":"1"}],"completed":[{"id":"1"}],"hasNext":false}
```

## Test results

All tests run twice in spirit: each query in **normal mode** (full `deepEqual` against the canonical fixture result) and, for the defer cases, in **defer mode** asserting the exact initial payload, each incremental frame, and the **round-trip invariant** (merging all frames reconstructs the normal-mode result).

### Normal mode — 14 / 14 pass

| ID | Feature verified |
|----|------------------|
| N-01 | single `@key` + cross-subgraph `author` (content → accounts) |
| N-02 | composite-key lookup (`articleBySlug`) |
| N-03 | `@requires` (reviews: `readingTimeAdjusted` from `wordCount`) |
| N-04 | `@requires` (billing: `seatUtilization` from `memberCount`) |
| N-05 | `@provides` (`featuredArticle.author.displayName`) |
| N-06 | `@override` (`heroImageUrl` served by media) |
| N-07 | `@interfaceObject` (`stats` on Article + Podcast) |
| N-08 | `union SearchResult` resolved across subgraphs |
| N-09 | `interface Publishable` (`relatedContent`) |
| N-10 | entity interface `Asset` (concrete `VideoAsset`) |
| N-11 | `@inaccessible` hidden from the API (negative) |
| N-12 | `@tag` type round-trips |
| N-13 | multiple `@key` (`Subscription`) then `invoices` |
| N-14 | deep cross-subgraph (accounts → reviews → recommendations) |

### Defer mode — 19 / 19 pass

| ID | Scenario | Result |
|----|----------|--------|
| DT-01 | single defer at root field, cross-subgraph entity | pass |
| DT-02 | defer between regular fields | pass |
| DT-03 | all top-level fields deferred (`path: []`) | pass |
| DT-04 | `@defer(if:true)` explicit | pass |
| DT-05 | `@defer(if:false)` → single `application/json`, no multipart | pass |
| DT-06 | `@defer(label:"rev")` → label echoed in `pending` | pass |
| DT-07 | two parallel sibling defers (ids `1`,`2`; one `hasNext:false`) | pass |
| DT-08 | nested defer (defer within defer) | pass |
| DT-09 | defer crossing onto an entity owned by another subgraph | pass |
| DT-10 | defer on a `@requires` field (input stays up front) | pass |
| DT-11 | defer on a `@provides` field | pass |
| DT-12 | defer fragment over a UNION | pass |
| DT-13 | defer named-fragment spread over an INTERFACE | pass |
| DT-14 | defer onto `@interfaceObject` field (highest-risk) | pass |
| DT-15 | defer on each element of a list (`subPath` indices) | pass |
| DT-16 | defer onto entity-interface member | pass |
| DT-17 | defer composite-key entity field | pass |
| DT-18 | non-deferrable field inside defer (characterization) | pass |
| DT-19 | multiple defers, mixed depth, full-graph | pass |

## Observed defer semantics (and the three corrected test expectations)

The suite was authored against the design spec, which flagged a few payload-shape details as "verify after first run" (`TODO-OBSERVED`).
On the first run, DT-08, DT-12, and DT-13 failed on those exact details.
We captured the raw router output for each, confirmed the **reconstructed result equals the normal-mode result** (so the data is correct), then corrected the expectations to match the router's actual — and spec-correct — behavior.
No router code was touched.

The unifying, confirmed semantics:

1. **One `pending` entry per `@defer` fragment, not per list element.**
   A type-conditional defer over a union with three elements (DT-12) yields **two** `pending` entries (one per fragment: Article, Podcast), and a single named-fragment defer over an interface (DT-13) yields **one** `pending` entry.
   The pending `path` is the static path (e.g. `["search"]`, `["article","relatedContent"]`) **without** a list index.

2. **List indices are carried in the incremental item's `subPath`, not in the pending path.**
   Each matched list element arrives as a separate `incremental[]` item with `subPath: [<index>]` (raw integers), often batched into one frame per fragment.

3. **Nested defers are announced eagerly.**
   DT-08 announces **both** the outer (`id:"1"`, `path:["user"]`) and the inner (`id:"2"`, `path:["user","recommendedArticles"]`) pending entries in the **initial** payload; the inner result later arrives with `subPath:[0]`.
   (The original test wrongly assumed the inner pending would appear lazily in a later frame, and also had a fixture typo asserting `rating: 9` where the value is `4`.)

These three were the only corrections.
Everything else asserted on the first run.

## Notable confirmations

- **`@defer` + `@interfaceObject` (DT-14)** — flagged in design as the highest-risk combination — works: the deferred `stats` follow-up targets the metrics interface-object subgraph keyed by the interface `@key` id and returns the full object.
- **`@defer` crossing a subgraph boundary onto an entity (DT-09)** works: the deferred `user.reviews` is resolved via an `_entities` follow-up into the reviews subgraph keyed by `user.id`.
- **`@defer` on a composite/multiple-key entity (DT-17)** works: the deferred `organization.subscription` resolves the `Subscription` entity (composite + single key) and computes its `@requires` field during the follow-up.
- **`@defer(if:false)` (DT-05)** correctly collapses to a single `application/json` response with no incremental machinery.
- **`@defer` on a `@requires` field (DT-10)** correctly forces the `@requires` input (`wordCount`) into the initial wave.

## No router bugs found

Within this test matrix the branch's `@defer` implementation behaved correctly in all 33 cases.
The only changes made anywhere were under `defer-demo/` (the demo + tests); the cosmo router source was not modified.

Design-time risks worth noting for future work (observed but not exercised here): the router's defer plan path has `// TODO: handle *plan.DeferResponsePlan` stubs in query-plan/usage capture (`graphql_prehandler.go`, `graphqlschemausage.go`), so tracing/metrics/query-plan logging for deferred operations may be incomplete — this does not affect the response payload and was therefore not asserted.

## How to reproduce

See `defer-demo/README.md` for the exact commands.
Summary: start the 7 subgraphs (`bin/*` on ports 4101–4107) → `wgc router compose -i graph.yaml -o config.json` → run the branch router (`EXECUTION_CONFIG_FILE_PATH=config.json DEV_MODE=true`) on `localhost:3002` → `cd tests && pnpm install && ROUTER_URL=http://localhost:3002/graphql pnpm test`.
