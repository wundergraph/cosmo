# Cosmo Router @defer Federation Demo — Build Spec

Status: design / build spec.
Scope: a self-contained federation demo under `defer-demo/` that exercises the cosmo router's `@defer` implementation across the full breadth of federation v2 features the router supports.
Goal: surface and characterize defer behavior end-to-end (compose with `wgc`, run the branch router, drive it from a TypeScript HTTP test suite).
NON-goal: fixing router bugs. When the router diverges from the spec, we record the divergence as an assertion, we do not patch the router.

All paths in this document are absolute. New code lives only under:

```
/Users/jens/.superset/worktrees/cosmo/dazed-geology/defer-demo
```

Nothing in this directory is committed.

---

## 0. Domain

A single coherent domain: a **publishing / media platform**.
- Users author content; content has authors, reviews, media assets, and recommendations.
- Reviews and recommendations are the slow/expensive sidecar data — the natural `@defer` targets.
- The graph is deliberately wired so that several fields of an entity live on a *different* subgraph than the entity's home, so deferring them forces a real cross-subgraph `_entities` follow-up fetch.

Key router constraint that shapes the topology (from the federation understanding agent):
the router can only defer fields that are **subgraph entry points** — root `Query` fields and fields of an **entity type (`@key`)**.
A field on a non-entity object inside a `@defer` is silently resolved in the initial wave.
We therefore make every interesting defer target either (a) a root field or (b) a field on a `@key` entity that is *resolved on another subgraph*.

---

## 1. Subgraph topology

7 subgraphs. Go + gqlgen v0.17.91, Federation v2 (`@link` to `https://specs.apollo.dev/federation/v2.7`), mock/in-memory data only. Each serves `POST /graphql` and auto-answers `_service{sdl}` + `_entities` (gqlgen generates these once federation is enabled).

| # | Subgraph | Port | Owns entities (home) | Federation features exercised | Cross-subgraph relationships (defer-relevant) |
|---|----------|------|----------------------|-------------------------------|-----------------------------------------------|
| 1 | **accounts** | 4101 | `User @key(id)`; `Organization @key(id)` | `@key` (single), `@shareable` (`User.displayName`), `@tag`, `@inaccessible` (`User.internalAuthToken`), entity interface root `Node @key(id)` | Home of `User`/`Organization`. `User.reviews`, `User.recommendedArticles`, `User.activity` are contributed by other subgraphs → deferring them crosses a boundary. |
| 2 | **content** | 4102 | `Article @key(id)`; `Podcast @key(id)`; `ContentItem` interface entity `@key(id) @interfaceObject` is NOT here (see metrics) | `@key` (single + **composite** `Article @key(id) @key("slug locale")`), abstract types: `union SearchResult = Article | Podcast`, `interface Publishable`, `@shareable` (`Article.title`), `@provides` (`Article.author { displayName }` via `@external`), `@external` | `Article.author: User` references `accounts.User`. `Article.reviews` lives on **reviews**. `Article.stats` lives on **metrics** (via `@interfaceObject`). Deferring `reviews`/`stats`/`recommendations` crosses boundaries. |
| 3 | **reviews** | 4103 | `Review @key(id)` | `@key` (single), `@requires` (`Review.readingTimeAdjusted` requires `article { wordCount }`), `@external` (`Article.wordCount`), extends `Article`/`User`/`Podcast` with `reviews` | Contributes `Article.reviews`, `Podcast.reviews`, `User.reviews`. The `@requires` pulls `Article.wordCount` from **content**. Reviews are slow (mock latency) → prime defer target. |
| 4 | **recommendations** | 4104 | (no home entity; only extends) | `@key` re-declared for extension, `@external`, `@provides`, abstract type resolution: returns `union SearchResult` members and `interface Publishable` implementers it does not own | Contributes `User.recommendedArticles: [Article!]`, `Article.relatedContent: [Publishable!]`. Expensive ML mock → defer target. Resolves abstract types across subgraphs. |
| 5 | **metrics** | 4105 | `ContentItem @key(id) @interfaceObject` (interface object); `Article`/`Podcast` are concrete members elsewhere | `@interfaceObject`, `@key` (single), `@shareable`, `@tag` | Contributes `stats: ContentStats!` to **every** `ContentItem` implementer (`Article`, `Podcast`) via the interface object. Deferring `article.stats` exercises defer onto an `@interfaceObject` keyed by interface `@key`. Stats are expensive aggregation → defer target. |
| 6 | **media** | 4106 | `MediaAsset @key(id)`; entity interface `Asset @key(id)` with members `ImageAsset`, `VideoAsset` | **entity interface** (`interface Asset @key`), `@key` (single), `@override` (takes `Article.heroImageUrl` `@override(from: "content")`), `@inaccessible` | Owns media. `@override` migrates `heroImageUrl` ownership from content → media. Abstract entity interface resolved across subgraphs. `VideoAsset.transcodeProgress` slow → defer target. |
| 7 | **billing** | 4107 | extends `Organization @key(id)`; `Subscription @key("orgId planId")` (**composite multi-field key**) | `@key` (**composite** `"orgId planId"`), **multiple `@key`** on `Subscription` (`@key("orgId planId")` + `@key(id)`), `@requires` (`Subscription.seatUtilization` requires `org { memberCount }`), `@external`, `@tag`, `@inaccessible` | Extends `Organization` with `subscription`, `invoices`. `@requires` pulls `Organization.memberCount` from **accounts**. Invoices slow → defer target. |

Feature coverage checklist (every required item is present):
- `@key` single: `User`, `Article`, `Review`, `MediaAsset`, `Organization`, `Podcast`.
- `@key` composite: `Article @key("slug locale")`, `Subscription @key("orgId planId")`.
- `@key` multiple on one type: `Subscription` (`@key("orgId planId")` + `@key(id)`).
- `@external`: `Article.wordCount` (in reviews), `Organization.memberCount` (in billing), `Article.author.displayName` (in content via provides).
- `@requires`: `Review.readingTimeAdjusted`, `Subscription.seatUtilization`.
- `@provides`: `content`'s `Query.featuredArticle` `@provides("author { displayName }")`.
- `@shareable`: `User.displayName` (accounts + reviews + recommendations), `Article.title`, `ContentStats` fields.
- `@override`: `Article.heroImageUrl` `@override(from: "content")` in media.
- `@inaccessible`: `User.internalAuthToken`, `MediaAsset.storageKey`, `Subscription.internalLedgerRef`.
- `@tag`: `User`, `ContentStats`, `Subscription`, `Query.firstArticle`.
- `@interfaceObject`: `metrics.ContentItem`.
- entity interface: `media.Asset @key(id)` with `ImageAsset`/`VideoAsset`.
- abstract types across subgraphs: `union SearchResult` (content) members resolved with help of reviews/recommendations; `interface Publishable` implementers returned by recommendations; `interface Asset` (entity interface) resolved by media.

---

## 2. Full SDL per subgraph

All schemas use the gqlgen-injected Federation v2 directive set; we only `@link`-import what we use. `_service{sdl}` echoes these files verbatim (gqlgen behavior — no SDL post-processing needed for any v2 directive). Mock latency is added in resolvers (see §6), not in SDL.

### 2.1 accounts (4101)

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.7",
        import: ["@key", "@shareable", "@inaccessible", "@tag", "@external"])

type Query {
  user(id: ID!): User
  users: [User!]!
  organization(id: ID!): Organization
  node(id: ID!): Node
}

interface Node @key(fields: "id") {
  id: ID!
}

type User implements Node @key(fields: "id") @tag(name: "pii") {
  id: ID!
  username: String!
  displayName: String! @shareable
  email: String!
  internalAuthToken: String! @inaccessible
  organization: Organization
}

type Organization @key(fields: "id") {
  id: ID!
  name: String!
  memberCount: Int!
}
```

### 2.2 content (4102)

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.7",
        import: ["@key", "@shareable", "@provides", "@external", "@tag"])

type Query {
  article(id: ID!): Article
  articleBySlug(slug: String!, locale: String!): Article
  articles: [Article!]!
  podcast(id: ID!): Podcast
  search(term: String!): [SearchResult!]!
  featuredArticle: Article @provides(fields: "author { displayName }")
  firstArticle: Article @tag(name: "internal")
}

interface Publishable {
  id: ID!
  title: String!
  publishedAt: String!
}

union SearchResult = Article | Podcast

type Article implements Publishable
    @key(fields: "id")
    @key(fields: "slug locale") {
  id: ID!
  slug: String!
  locale: String!
  title: String! @shareable
  body: String!
  wordCount: Int!
  publishedAt: String!
  heroImageUrl: String!
  author: User!
}

type Podcast implements Publishable @key(fields: "id") {
  id: ID!
  title: String!
  publishedAt: String!
  durationSeconds: Int!
  host: User!
}

# Referenced (home in accounts). author.displayName is provided inline by featuredArticle.
type User @key(fields: "id") {
  id: ID!
  displayName: String! @external
}
```

### 2.3 reviews (4103)

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.7",
        import: ["@key", "@requires", "@external", "@shareable"])

type Review @key(fields: "id") {
  id: ID!
  rating: Int!
  body: String!
  author: User!
  article: Article!
  # @requires pulls Article.wordCount from the content subgraph.
  readingTimeAdjusted: Int! @requires(fields: "article { wordCount }")
}

type Article @key(fields: "id") {
  id: ID!
  wordCount: Int! @external
  reviews: [Review!]!          # deferred -> cross-subgraph entity fetch into reviews
}

type Podcast @key(fields: "id") {
  id: ID!
  reviews: [Review!]!
}

type User @key(fields: "id") {
  id: ID!
  displayName: String! @shareable
  reviews: [Review!]!
}
```

### 2.4 recommendations (4104)

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.7",
        import: ["@key", "@external", "@shareable"])

interface Publishable {
  id: ID!
  title: String!
  publishedAt: String!
}

# recommendations returns Article/Podcast it does not own (abstract type across subgraphs)
# NOTE: `implements` MUST come BEFORE directives (GraphQL grammar) — verified via wgc/rover.
type Article implements Publishable @key(fields: "id") {
  id: ID!
  title: String! @external
  publishedAt: String! @external
  relatedContent: [Publishable!]!   # deferred -> abstract type, cross-subgraph
}

type Podcast implements Publishable @key(fields: "id") {
  id: ID!
  title: String! @external
  publishedAt: String! @external
}

type User @key(fields: "id") {
  id: ID!
  displayName: String! @shareable
  recommendedArticles: [Article!]!  # deferred -> expensive ML mock
}
```

### 2.5 metrics (4105) — `@interfaceObject`

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.7",
        import: ["@key", "@interfaceObject", "@shareable", "@tag"])

# Interface object: metrics contributes `stats` to ALL ContentItem implementers
# (Article, Podcast) without knowing the concrete types.
type ContentItem @key(fields: "id") @interfaceObject {
  id: ID!
  stats: ContentStats!     # deferred -> expensive aggregation, onto @interfaceObject
}

type ContentStats @shareable @tag(name: "analytics") {
  views: Int!
  shares: Int!
  avgReadSeconds: Float!
}
```

Composition note: `Article` and `Podcast` must each declare `implements ContentItem`-equivalence implicitly by sharing the `id` key with the interface object. The interface `ContentItem` itself (the abstract interface that `Article`/`Podcast` implement) is declared in the subgraph that owns the concrete members. To keep composition valid we declare the interface in **content** as well:

Add to content (2.2):
```graphql
interface ContentItem @key(fields: "id") {
  id: ID!
}
# and:  type Article implements Publishable & ContentItem ...
#       type Podcast  implements Publishable & ContentItem ...
```
(This is the standard `@interfaceObject` pairing: interface + concrete members in `content`, the `@interfaceObject` stub + extra field in `metrics`.)

### 2.6 media (4106) — entity interface + `@override`

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.7",
        import: ["@key", "@override", "@inaccessible"])

type Query {
  asset(id: ID!): Asset
}

# Entity interface: members are entities resolvable via the interface @key.
interface Asset @key(fields: "id") {
  id: ID!
  url: String!
}

type ImageAsset implements Asset @key(fields: "id") {
  id: ID!
  url: String!
  width: Int!
  height: Int!
}

type VideoAsset implements Asset @key(fields: "id") {
  id: ID!
  url: String!
  durationSeconds: Int!
  transcodeProgress: Float!   # deferred -> slow transcode mock
}

type MediaAsset @key(fields: "id") {
  id: ID!
  storageKey: String! @inaccessible
}

# Takes ownership of heroImageUrl from content via @override.
type Article @key(fields: "id") {
  id: ID!
  heroImageUrl: String! @override(from: "content")
}
```

### 2.7 billing (4107) — composite + multiple keys + `@requires`

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.7",
        import: ["@key", "@requires", "@external", "@tag", "@inaccessible"])

type Organization @key(fields: "id") {
  id: ID!
  memberCount: Int! @external
  subscription: Subscription           # deferred -> cross-subgraph entity fetch
  invoices: [Invoice!]!                # deferred -> slow mock
}

type Subscription
    @key(fields: "orgId planId")
    @key(fields: "id")
    @tag(name: "billing") {
  id: ID!
  orgId: ID!
  planId: ID!
  status: String!
  internalLedgerRef: String! @inaccessible
  # @requires pulls Organization.memberCount from accounts.
  seatUtilization: Float! @requires(fields: "org { memberCount }")
  org: Organization!
}

type Invoice @key(fields: "id") {
  id: ID!
  amountCents: Int!
  paid: Boolean!
}
```

Note: `Subscription` has both a composite key and a single key (covers "multiple `@key`"). The router may use either to resolve the deferred follow-up.

---

## 3. @defer wire format, headers, enablement (EXACT — from the router-internals agents)

### 3.1 Enablement (there is NO config flag)

- The router has **no** `defer`/`incremental` config key (verified: `router/pkg/config/config.go` has none).
- Defer is selected purely by plan type: when the operation contains `@defer`, the engine produces a `*plan.DeferResponsePlan`, and `router/core/graphql_handler.go:326` dispatches to `GetDeferResponseWriter`.
- Normalization wiring: `astnormalization.WithInlineDefer()` (`operation_processor.go:1499`).
- The router does **NOT** branch on the `Accept` header to decide defer. We still send `Accept: multipart/mixed` to match the documented client contract and the test helper.

### 3.2 Request

```
POST /graphql HTTP/1.1
Content-Type: application/json
Accept: multipart/mixed
Connection: keep-alive

{"query":"query { ... ... @defer { ... } }"}
```

### 3.3 Response headers (from `router/core/defer_response_writer.go:91-97`)

```
Content-Type: multipart/mixed; deferSpec=20220824; boundary="graphql"
Transfer-Encoding: chunked
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

### 3.4 On-wire framing (CRLF, boundary token literally `graphql`)

Each payload is one multipart part:
```
\r\n--graphql\r\nContent-Type: application/json\r\n\r\n<RAW JSON PAYLOAD>
```
Stream terminator (from `Complete()`):
```
\r\n--graphql--\r\n
```
The raw body starts with a leading `\r\n--graphql`. Per-part header is `Content-Type: application/json` (no charset). The JSON payload is raw (NOT wrapped in a `payload` field as subscriptions are).

Caveat: checked-in golden `.txt` fixtures under `router-tests/protocol/testdata/queries_defer/` are stored with bare `LF`; the **live writer emits `\r\n`**. The TS suite must split on `\r\n--graphql` (and tolerate `\n` defensively), see §5.

### 3.5 JSON payload shape — NEW incremental-delivery spec (engine graphql-go-tools v2 rc.267)

This is the **pending/incremental/completed with `id`** model, NOT the legacy 2022 `path`-on-item shape.

Initial payload:
```json
{"data":{...non-deferred...},"pending":[{"id":"1","path":["article"]}],"hasNext":true}
```
- `pending[]` — one entry per `@defer` fragment: `{id, path, label?}`. `path` segments are all quoted strings. Sorted by `id` ascending. `label` present only when the query used `@defer(label: ...)`.

Incremental payload:
```json
{"incremental":[{"data":{...deferred fields...},"id":"1","subPath":[0]}],"completed":[{"id":"1"}],"hasNext":false}
```
- `incremental[]` item: `{data, id, subPath?, errors?}`. `id` references a `pending` id. `subPath` is the suffix beyond the pending path; **list indices are raw unquoted integers**, named segments are quoted strings. Omitted when the patch applies directly at the pending path.
- `completed[]`: `{id, errors?}`. Always emitted. Carries `errors` (and the `incremental` array is omitted) when the deferred fragment null-propagated through a non-nullable chain.
- Merge target for a patch = `["data"] + pending[id].path + item.subPath`, deep-merged.
- `hasNext`: `true` until the last frame; final frame is `hasNext:false`. Parallel/sibling defers each get their own `pending` id and their own frame; only one frame carries `hasNext:false`.

`if:false` and fully-discarded defer: the router may fold everything into a single response. When the response `Content-Type` is plain `application/json` (not multipart), there is no incremental machinery — the TS suite detects this via the `Content-Type` prefix and treats the body as the final result directly.

---

## 4. Local runbook

Worktree root: `/Users/jens/.superset/worktrees/cosmo/dazed-geology`.
Demo root: `/Users/jens/.superset/worktrees/cosmo/dazed-geology/defer-demo`.

### 4.1 Project layout to create

```
defer-demo/
  go.mod                      # module defer-demo (go 1.23+; env has go 1.25.3)
  gqlgen.yml                  # shared template; per-subgraph generation
  subgraphs/
    accounts/{schema.graphqls, gqlgen.yml, graph/*, server.go}    # :4101
    content/...                                                   # :4102
    reviews/...                                                   # :4103
    recommendations/...                                           # :4104
    metrics/...                                                   # :4105
    media/...                                                     # :4106
    billing/...                                                   # :4107
  graph.yaml                  # wgc compose input
  router.config.yaml          # router config (optional; env var also works)
  scripts/
    run_subgraphs.sh          # launches all 7 via concurrently / xargs
    compose.sh                # wgc router compose
    run_router.sh             # go run the BRANCH router
  tests/                      # TypeScript suite
    package.json
    defer.test.ts
    helpers/multipart.ts
```

Each subgraph `server.go` mirrors the demo pattern (gqlgen `handler.New(...)` + `transport.POST{}` + `http.Handle("/graphql", srv)` + `http.ListenAndServe(":<port>", nil)`). gqlgen.yml enables federation:
```yaml
federation:
  filename: graph/federation.go
  package: graph
  version: 2
  options:
    computed_requires: true       # for @requires fields (reviews, billing)
call_argument_directives_with_null: true
```

### 4.2 graph.yaml (wgc compose input)

```yaml
version: 1
subgraphs:
  - name: accounts
    routing_url: http://localhost:4101/graphql
    schema: { file: ./subgraphs/accounts/schema.graphqls }
  - name: content
    routing_url: http://localhost:4102/graphql
    schema: { file: ./subgraphs/content/schema.graphqls }
  - name: reviews
    routing_url: http://localhost:4103/graphql
    schema: { file: ./subgraphs/reviews/schema.graphqls }
  - name: recommendations
    routing_url: http://localhost:4104/graphql
    schema: { file: ./subgraphs/recommendations/schema.graphqls }
  - name: metrics
    routing_url: http://localhost:4105/graphql
    schema: { file: ./subgraphs/metrics/schema.graphqls }
  - name: media
    routing_url: http://localhost:4106/graphql
    schema: { file: ./subgraphs/media/schema.graphqls }
  - name: billing
    routing_url: http://localhost:4107/graphql
    schema: { file: ./subgraphs/billing/schema.graphqls }
```

### 4.3 Compose (wgc)

```bash
# one-time: cli deps (worktree has no node_modules)
cd /Users/jens/.superset/worktrees/cosmo/dazed-geology/cli && pnpm install

# compose
cd /Users/jens/.superset/worktrees/cosmo/dazed-geology/cli
pnpm wgc router compose \
  -i /Users/jens/.superset/worktrees/cosmo/dazed-geology/defer-demo/graph.yaml \
  -o /Users/jens/.superset/worktrees/cosmo/dazed-geology/defer-demo/config.json
# fallback if `pnpm wgc` is not wired:
# pnpm dlx tsx src/index.ts router compose -i <graph.yaml> -o <config.json>
```
Recommended: validate composition first with the `federation-composition` skill / `wgc subgraph check` (the gqlgen agent flagged `@link` version-string acceptance as a thing to verify).

### 4.4 Generate gqlgen code + run subgraphs

```bash
# per subgraph, from its dir:
go run github.com/99designs/gqlgen generate

# run all 7 (scripts/run_subgraphs.sh), e.g.:
npx concurrently --kill-others \
  "cd subgraphs/accounts && PORT=4101 go run ." \
  "cd subgraphs/content && PORT=4102 go run ." \
  "cd subgraphs/reviews && PORT=4103 go run ." \
  "cd subgraphs/recommendations && PORT=4104 go run ." \
  "cd subgraphs/metrics && PORT=4105 go run ." \
  "cd subgraphs/media && PORT=4106 go run ." \
  "cd subgraphs/billing && PORT=4107 go run ."
```

### 4.5 Run the BRANCH router (source, not a binary)

```bash
cd /Users/jens/.superset/worktrees/cosmo/dazed-geology/router
EXECUTION_CONFIG_FILE_PATH=/Users/jens/.superset/worktrees/cosmo/dazed-geology/defer-demo/config.json \
DEV_MODE=true \
LOG_LEVEL=debug \
go run cmd/router/main.go
```
- No `GRAPH_API_TOKEN` / no control plane needed (static execution config short-circuits the poller).
- Router serves `http://localhost:3002/graphql` (default `LISTEN_ADDR=localhost:3002`).

### 4.6 Smoke verify

```bash
curl -s http://localhost:3002/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ articles { id title } }"}'
```

### 4.7 Run the TS suite

```bash
cd /Users/jens/.superset/worktrees/cosmo/dazed-geology/defer-demo/tests
pnpm install
ROUTER_URL=http://localhost:3002/graphql pnpm test
```

End-to-end order: (1) start subgraphs → (2) compose → (3) start router → (4) run tests. Recompose whenever any subgraph SDL changes.

---

## 5. Defer test matrix

Conventions for every test:
- Each query is run **twice**: (a) **normal mode** (no `@defer`) → assert the full single JSON response with `assert.deepEqual` on the entire object; (b) **defer mode** (same query with `@defer`) → assert the **initial** payload AND **each** incremental payload exactly, then assert the **reconstructed** merged result equals the normal-mode result.
- Initial-payload assertions are **exact**: full `data`, full `pending[]` (ids + paths), and `hasNext`.
- Incremental-payload assertions are **exact**: full `incremental[].data`, `incremental[].id`, `incremental[].subPath` (present/absent), `completed[]`, `hasNext`.
- Mock data is fixed (§6) so all values are deterministic; the only non-determinism is frame *ordering* for parallel defers (see DT-07, DT-15) — handle by collecting frames into a set keyed by `completed.id` before asserting.

### 5.1 Multipart parser (helpers/multipart.ts)

Replicate the Go `reconstructDeferResponse`:
1. Split raw body on `\r\n--graphql` (also accept `\n--graphql`); drop the part beginning with `--` (terminator).
2. For each part, cut on first `\r\n\r\n`, keep the JSON tail, `trim`, drop empties.
3. Parse part[0] as initial; build `pendingPaths[id] = path` from every frame's `pending`.
4. For each incremental item: deep-merge `item.data` at `["data", ...pendingPaths[id], ...(item.subPath ?? [])]`.
5. Hoist `incremental[].errors` and `completed[].errors` into root `errors`.
6. Delete `hasNext` and `pending`; compare to normal-mode result.

### 5.2 Normal-mode coverage (no defer; exercise the whole graph)

| ID | What | Query (abbrev) | Assert |
|----|------|----------------|--------|
| N-01 | single `@key` + cross-subgraph author | `{ article(id:"a1"){ id title author{ id displayName } } }` | full object; `author` resolved from accounts. |
| N-02 | composite key lookup | `{ articleBySlug(slug:"hello", locale:"en"){ id title } }` | exact object. |
| N-03 | `@requires` (reviews) | `{ article(id:"a1"){ reviews{ id rating readingTimeAdjusted } } }` | `readingTimeAdjusted` computed from `wordCount`. |
| N-04 | `@requires` (billing) | `{ organization(id:"o1"){ subscription{ status seatUtilization } } }` | `seatUtilization` from `memberCount`. |
| N-05 | `@provides` | `{ featuredArticle{ title author{ displayName } } }` | `displayName` provided inline (no extra accounts hop — correctness only, no plan assert). |
| N-06 | `@override` | `{ article(id:"a1"){ heroImageUrl } }` | served by media. |
| N-07 | `@interfaceObject` stats | `{ article(id:"a1"){ stats{ views shares } } podcast(id:"p1"){ stats{ views } } }` | stats present on both members. |
| N-08 | union across subgraphs | `{ search(term:"x"){ __typename ... on Article{ id title } ... on Podcast{ id durationSeconds } } }` | both members resolved. |
| N-09 | interface `Publishable` | `{ article(id:"a1"){ relatedContent{ __typename ... on Article{ title } ... on Podcast{ title } } } }` | recommendations resolves abstract members. |
| N-10 | entity interface `Asset` | `{ asset(id:"v1"){ __typename id url ... on VideoAsset{ transcodeProgress } } }` | concrete `VideoAsset`. |
| N-11 | `@inaccessible` is hidden | introspect / query `internalAuthToken` | field rejected by composition (query errors / not in schema). |
| N-12 | `@tag` round-trips | introspection on `User` | tags present in supergraph (sanity). |
| N-13 | multiple keys | resolve `Subscription` by composite, then `invoices` | exact. |
| N-14 | deep cross-subgraph | `{ user(id:"u1"){ displayName reviews{ rating } recommendedArticles{ title } } }` | accounts→reviews→recommendations. |

### 5.3 Defer-mode coverage

| ID | Scenario | Query (defer fragment in **bold**) | Initial payload assert | Incremental assert |
|----|----------|------------------------------------|------------------------|--------------------|
| DT-01 | **single defer at root field**, cross-subgraph entity | `{ article(id:"a1"){ id title **... @defer { reviews { id rating } }** } }` | `data.article = {id,title}` (no reviews); `pending=[{id:"1",path:["article"]}]`; `hasNext:true`. | one frame: `incremental[0].data = {reviews:[...]}`, `id:"1"`, no `subPath`; `completed=[{id:"1"}]`; `hasNext:false`. |
| DT-02 | **defer between regular fields** | `{ article(id:"a1"){ id **... @defer { reviews{id} }** title } }` | same as DT-01 (order of non-deferred preserved). | same. |
| DT-03 | **all top-level fields deferred** | `{ **... @defer { article(id:"a1"){ id title } }** }` | `data:{}`, `pending=[{id:"1",path:[]}]`, `hasNext:true`. | `incremental[0].data={article:{...}}`, `id:"1"`, no subPath; merged at `data`. |
| DT-04 | **`@defer(if:true)`** explicit | DT-01 with `@defer(if:true)` | identical to DT-01 (defaults to true). | identical to DT-01. |
| DT-05 | **`@defer(if:false)`** | DT-01 with `@defer(if:false)` | MUST behave as if absent: response is **single** payload, `Content-Type: application/json` (or one multipart frame with no `pending`), `data.article` includes `reviews` inline; no `pending`. | no incremental frames. Assert the full inline result. |
| DT-06 | **`@defer(label:"rev")`** | DT-01 with `@defer(label:"rev")` | `pending=[{id:"1",path:["article"],label:"rev"}]`. | label is NOT echoed on the incremental item in the new spec; assert `incremental[0]={data,id:"1"}` and `completed=[{id:"1"}]`. |
| DT-07 | **two parallel sibling defers** | `{ article(id:"a1"){ id **...@defer{reviews{id}}** **...@defer{relatedContent{__typename}}** } }` | `pending=[{id:"1",...},{id:"2",...}]` both `path:["article"]`; `hasNext:true`. | two frames, collected by id: one `{incremental:[{data:{reviews},id:"1"|"2"}],completed,hasNext:true}` and one with `hasNext:false`. Assert both data bodies; assert exactly one frame has `hasNext:false`. |
| DT-08 | **nested defer (defer within defer)** | `{ user(id:"u1"){ id **...@defer{ recommendedArticles{ id **...@defer{ reviews{ rating } }** } }** } }` | `data.user={id}`; `pending=[{id:"1",path:["user"]}]`; `hasNext:true`. | frame A: outer `recommendedArticles` (list) arrives, `id:"1"`, and a NEW `pending` entry for the inner defer appears (id "2" with deeper path incl. list index); `hasNext:true`. frame B: inner `reviews`, `id:"2"`, `subPath` reaching into the list element; `completed=[{id:"2"}]`; `hasNext:false`. Assert both. |
| DT-09 | **defer crossing onto an entity owned by another subgraph** (the headline) | `{ user(id:"u1"){ displayName **...@defer{ reviews{ id rating } }** } }` | `data.user={displayName}`; `pending=[{id:"1",path:["user"]}]`. | one frame: `reviews` from reviews subgraph via `_entities`; full data; `completed`; `hasNext:false`. (Verifies the deferred `_entities` follow-up keyed by `user.id`.) |
| DT-10 | **defer on a `@requires` field** | `{ article(id:"a1"){ id wordCount **...@defer{ reviews{ readingTimeAdjusted } }** } }` | initial includes `wordCount` (the `@requires` input MUST be resolved up front); `data.article={id,wordCount}`. | incremental `reviews[].readingTimeAdjusted` computed; full data; `hasNext:false`. Documents: cannot defer the `@requires` input. |
| DT-11 | **defer on a `@provides` field** | `{ featuredArticle{ id **...@defer{ author{ displayName } }** } }` | `data.featuredArticle={id}`; `pending` present. | `author{displayName}` arrives incrementally. Record whether router still issued a separate fetch (correctness only; no plan assert). |
| DT-12 | **defer fragment over a UNION** | `{ search(term:"x"){ __typename **...on Article @defer { title wordCount }** **...on Podcast @defer { durationSeconds }** } }` | initial: each `SearchResult` has only `__typename`; one `pending` per matched concrete type per element (paths carry list indices). | per-concrete-type incremental frames with `subPath` into the list; assert each member's deferred fields; assert union members get fields only for matching `__typename`. |
| DT-13 | **defer named-fragment spread over an INTERFACE** | `query{ article(id:"a1"){ relatedContent{ __typename ...PubInfo @defer } } } fragment PubInfo on Publishable { title publishedAt }` | `relatedContent[]` present with `__typename` only; `pending` per element. | incremental frames deliver `title`/`publishedAt` per element via `subPath` list indices; assert full per-element data. |
| DT-14 | **defer onto `@interfaceObject` field** | `{ article(id:"a1"){ id **...@defer{ stats{ views shares avgReadSeconds } }** } }` | `data.article={id}`; `pending=[{id:"1",path:["article"]}]`. | `stats` arrives via the metrics `@interfaceObject` `_entities` fetch keyed by interface `@key` id; full `stats` object; `hasNext:false`. (Highest-risk combination — assert exactly.) |
| DT-15 | **defer on each element of a list** (subPath indices) | `{ articles{ id **...@defer{ reviews{ id } }** } }` | `data.articles=[{id},{id},...]`; one `pending` (`path:["articles"]`) OR one per element — assert whatever the router emits exactly. | incremental frames carry `subPath:[<index>]` (raw integers) merging `reviews` into each `articles[i]`; assert per-index data and that union of frames reconstructs the list. |
| DT-16 | **defer onto entity interface member** | `{ asset(id:"v1"){ __typename id **...on VideoAsset @defer { transcodeProgress }** } }` | `data.asset={__typename:"VideoAsset",id}`; `pending` present. | `transcodeProgress` arrives incrementally; assert value; `hasNext:false`. |
| DT-17 | **defer composite-key entity field** | `{ organization(id:"o1"){ id **...@defer{ subscription{ status seatUtilization } }** } }` | `data.organization={id}`. | deferred `_entities` follow-up resolves `Subscription` (composite/multi key) and computes `seatUtilization` (its `@requires` input `memberCount` resolved during follow-up); full data; `hasNext:false`. |
| DT-18 | **non-deferrable field inside defer** (negative/characterization) | defer a field on a non-entity nested object, e.g. `{ article(id:"a1"){ id ...@defer { author { username } } } }` where the deferred selection is a plain field on a referenced entity but the *enclosing object* is non-entity — pick a concrete non-entity case from the final schema | document actual behavior: router resolves it up front (folded into initial) or still multipart. Assert whatever it does exactly; this is characterization, not a pass/fail of correctness. |
| DT-19 | **multiple defers, mixed depth, full-graph** | one big query combining DT-01/07/14 fields | exact initial + collected frames | reconstruct equals the normal-mode N-* full query; single `hasNext:false`. |

For every DT-*, the final reconstructed object MUST equal the corresponding normal-mode result (the defer "round-trip invariant").

---

## 6. gqlgen caveats + hand-authored / post-processed SDL

- **No SDL post-processing needed for any v2 directive.** `_service{sdl}` echoes the `.graphqls` files verbatim; `@shareable/@override/@inaccessible/@tag/@interfaceObject/@link/@provides/@external` all reach the published SDL unchanged.
- **`@requires` requires config flags**: set `federation.options.computed_requires: true` AND top-level `call_argument_directives_with_null: true`. The resolver then receives a `federationRequires map[string]any` argument (values JSON-decoded, not typed). Used by `reviews` (`readingTimeAdjusted`) and `billing` (`seatUtilization`). Cast manually.
- **`@interfaceObject`** is `SkipRuntime` metadata in gqlgen — no runtime middleware. The interface (`ContentItem`) must be declared in the subgraph that owns the concrete members (**content**), and the `@interfaceObject` stub + extra field declared in **metrics**. `Article`/`Podcast` must `implements ContentItem` in content.
- **Entity interface** (`Asset @key` in media): gqlgen supports `interface X @key` + `type Y implements X @key`, BUT it **silently drops** a `@key` on an interface that has no implementing type in that subgraph (logs `@key directive found on unused interface ... Will be ignored`). Ensure `ImageAsset`/`VideoAsset` are declared `implements Asset` in **media** itself.
- **Multiple `@key`** (`Subscription`): `@key` is `repeatable`; each distinct key generates its own `Find...` entity resolver (`FindSubscriptionByOrgIdAndPlanId`, `FindSubscriptionByID`). Implement both.
- **Composite key** generates a multi-arg `Find` (`FindArticleBySlugAndLocale(ctx, slug, locale)`).
- **`@link` version string**: gqlgen accepts `v2.7`. Verify wgc accepts the exact URL/version (gqlgen testdata uses v2.3/v2.7). If wgc rejects, drop to the version the existing demo uses (`v2.5`) and adjust imports — `v2.5` already imports the full directive set in the demo.
- **`@external` on Fed2 key fields** is not required; only declare `@external` where a non-owning subgraph references a field it does not resolve (e.g. `Article.wordCount @external` in reviews, `Organization.memberCount @external` in billing).
- **Mock latency** lives in resolvers (e.g. `time.Sleep(150*time.Millisecond)` in `reviews`, `recommendations`, `metrics`, `billing`, `media.VideoAsset.transcodeProgress`) — NOT in SDL. Keep data fixed/deterministic so payloads are byte-stable.
- **gqlgen does not need subgraphs running at compose time** — wgc reads SDL from `schema.file`. But subgraphs MUST run for the router to resolve at query time.

---

## 7. Risks

1. **Wire-format divergence (LF vs CRLF, NEW vs OLD spec).** The live writer emits `\r\n` and the engine (rc.267) emits the NEW `pending/incremental/completed/id/subPath` shape, but some checked-in tests/fixtures still reflect the OLD `{data,hasNext}`+`{incremental:[{data,path}]}` shape, and golden `.txt` files are stored with LF. The TS parser must split on `\r\n--graphql` with `\n` fallback and assert the NEW shape; if the live router emits the OLD shape for simple single-level defers, record it as a finding (do not patch).
2. **Defer-plan stubs are incomplete in the router.** `graphql_prehandler.go` and `graphqlschemausage.go` have `// TODO: handle` for `*plan.DeferResponsePlan` — normalized-query capture and field→subgraph mapping are NOT populated for defer plans. This can affect tracing/metrics/query-plan logging but not the response payload; do not assert on query-plan logs for deferred ops.
3. **`@interfaceObject` + defer (DT-14) is the highest-risk combination.** The deferred follow-up must target the interface-object subgraph keyed by the interface `@key`. Apollo docs do not fully specify this; cosmo behavior must be observed, not assumed. Treat DT-14 as characterization-first.
4. **Non-deferrable field handling (DT-18).** The router may silently resolve non-entity nested fields up front rather than defer them. The exact fold/keep decision lives in the planner (not read). Assert observed behavior.
5. **Parallel-defer frame ordering is non-deterministic** (parallel groups use a plain errgroup). DT-07/DT-12/DT-13/DT-15 must collect frames keyed by `completed.id`/`subPath` before asserting, and assert exactly one `hasNext:false`.
6. **`@requires`/`@provides` × defer interactions** (DT-10, DT-11): deferring a `@requires` field forces its inputs into the initial wave; deferring a `@provides` field may negate the provides optimization. These are correctness-only assertions; no plan-shape assertions, since the planner internals are not pinned here.
7. **wgc `@link` version acceptance** (see §6) — pre-validate composition with the `federation-composition` skill before wiring the router; a composition failure blocks everything downstream.
8. **gqlgen `@requires` values are untyped `map[string]any`** — manual casting in `readingTimeAdjusted`/`seatUtilization` is error-prone; unit-cover those two resolvers.
9. **Port collisions**: subgraphs 4101-4107, router 3002. Avoid the demo's 4001-4010 range to prevent clashes if the existing demo is also running.
