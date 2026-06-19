# Canonical Fixture Dataset — @defer Federation Demo

Status: source of truth.
Scope: the single, internally-consistent dataset that ALL 7 subgraphs implement and that the TypeScript test suite asserts against.

Rules that produced this file:
- All values are fixed, small, human-readable, deterministic. No randomness. No clock-derived timestamps (every timestamp is a literal `"2024-01-15T00:00:00Z"`-style string).
- Cross-subgraph joins are wired by id so `_entities` follow-ups line up exactly.
- Every `@requires`-computed field has an explicit formula and a precomputed value.
- Section 9 contains the EXACT expected `{"data":{...}}` JSON for normal-mode queries N-01..N-14 (DESIGN §5.2). These are the ground truth for `assert.deepEqual`, and every `@defer` round-trip must reconstruct one of them.

Each subgraph's resolver MUST seed exactly the values below. The list ordering shown here is the canonical ordering; resolvers must return list elements in this order (the suite asserts ordered arrays except for the parallel-defer frame-ordering caveat in DESIGN §5).

---

## 1. Users (home: accounts)

| field | u1 | u2 |
|-------|----|----|
| id | `"u1"` | `"u2"` |
| username | `"alice"` | `"bob"` |
| displayName | `"Alice Author"` | `"Bob Builder"` |
| email | `"alice@example.com"` | `"bob@example.com"` |
| internalAuthToken (`@inaccessible`) | `"tok_alice_001"` | `"tok_bob_002"` |
| organization | `o1` | `o1` |

Both users belong to organization `o1`.

`User.displayName` is `@shareable` (accounts + reviews + recommendations all return the same string).

---

## 2. Organization (home: accounts; extended by billing)

| field | o1 |
|-------|----|
| id | `"o1"` |
| name | `"Example Media Co"` |
| memberCount | `12` |

`memberCount = 12` is the input to billing's `seatUtilization` `@requires`.

---

## 3. Articles (home: content; `heroImageUrl` overridden by media)

| field | a1 | a2 |
|-------|----|----|
| id | `"a1"` | `"a2"` |
| slug | `"hello"` | `"world"` |
| locale | `"en"` | `"en"` |
| title (`@shareable`) | `"Hello World"` | `"World News"` |
| body | `"This is the hello article body."` | `"This is the world article body."` |
| wordCount | `400` | `1000` |
| publishedAt | `"2024-01-15T00:00:00Z"` | `"2024-02-20T00:00:00Z"` |
| heroImageUrl (`@override` from content → media) | `"https://cdn.example.com/hero/a1.jpg"` | `"https://cdn.example.com/hero/a2.jpg"` |
| author | `u1` | `u2` |

Composite-key lookup test: `articleBySlug(slug:"hello", locale:"en")` → `a1`; `articleBySlug(slug:"world", locale:"en")` → `a2`.

`heroImageUrl` is owned by **media** at runtime (the `@override(from:"content")` migrates ownership). Values above are the ones media serves.

---

## 4. Podcasts (home: content)

| field | p1 |
|-------|----|
| id | `"p1"` |
| title (Publishable) | `"The Hello Podcast"` |
| publishedAt | `"2024-03-10T00:00:00Z"` |
| durationSeconds | `1800` |
| host | `u1` |

---

## 5. Reviews (home: reviews; contributes Article/Podcast/User `.reviews`)

`readingTimeAdjusted` formula (deterministic, assertable):

```
readingTimeAdjusted = ceil(wordCount / 200) + rating
```

`wordCount` is pulled from content via `@requires(fields: "article { wordCount }")`. Reviews of podcasts/users have no article, so `readingTimeAdjusted` is only meaningful (and only queried) for article reviews; for non-article reviews the resolver returns `0` (no article ⇒ `ceil(0/200)+rating` is NOT used; the field is simply not part of any non-article query path). The suite only selects `readingTimeAdjusted` where an `article` is present.

| field | r1 | r2 | r3 | r4 | r5 |
|-------|----|----|----|----|----|
| id | `"r1"` | `"r2"` | `"r3"` | `"r4"` | `"r5"` |
| rating | `5` | `3` | `4` | `5` | `2` |
| body | `"Loved it."` | `"It was fine."` | `"Great read."` | `"Best podcast."` | `"Decent author."` |
| author (User) | `u2` | `u1` | `u1` | `u2` | `u1` |
| article (Article) | `a1` | `a1` | `a2` | none (podcast) | none (user) |
| podcast (Podcast) | — | — | — | `p1` | — |
| reviews-of-user target | — | — | — | — | `u1` |

Per-review `readingTimeAdjusted` (only where `article` exists):

- r1: article a1, wordCount 400 → `ceil(400/200)=2`; `2 + rating(5) = 7`.
- r2: article a1, wordCount 400 → `ceil(400/200)=2`; `2 + rating(3) = 5`.
- r3: article a2, wordCount 1000 → `ceil(1000/200)=5`; `5 + rating(4) = 9`.

So: `r1.readingTimeAdjusted = 7`, `r2.readingTimeAdjusted = 5`, `r3.readingTimeAdjusted = 9`.

### 5.1 The `.reviews` join lists (canonical ordering)

- `Article("a1").reviews` = `[r1, r2]`
- `Article("a2").reviews` = `[r3]`
- `Podcast("p1").reviews` = `[r4]`
- `User("u1").reviews` = `[r2, r3, r5]` (reviews authored by u1)
- `User("u2").reviews` = `[r1, r4]` (reviews authored by u2)

`User.reviews` is "reviews authored by this user" (author = the user). This is consistent with the `author` column above:
- r1 author u2, r2 author u1, r3 author u1, r4 author u2, r5 author u1.
- u1 authored r2, r3, r5. u2 authored r1, r4.

---

## 6. Recommendations (home: none; extends User + Article)

- `User("u1").recommendedArticles` = `[a2]`
- `User("u2").recommendedArticles` = `[a1]`
- `Article("a1").relatedContent` = `[a2, p1]` (mixes Article + Podcast → `[Publishable!]`)
- `Article("a2").relatedContent` = `[p1]`

`relatedContent` element `__typename` values:
- a1.relatedContent → `["Article" (a2), "Podcast" (p1)]`
- a2.relatedContent → `["Podcast" (p1)]`

When `relatedContent`/`recommendedArticles` resolve `title`/`publishedAt`, those come from content (the `@external` fields); values match §3/§4.

---

## 7. Metrics — `ContentStats` per `ContentItem` id (`@interfaceObject`)

`avgReadSeconds` is `Float` (always written with a decimal point so JSON is byte-stable).

| id | views | shares | avgReadSeconds |
|----|-------|--------|----------------|
| a1 | `1500` | `42` | `95.5` |
| a2 | `3200` | `88` | `210.0` |
| p1 | `500` | `10` | `1750.0` |

`stats` is contributed to `Article` and `Podcast` via the interface object keyed by `id`.

---

## 8. Media (home: media) — entity interface `Asset` + `MediaAsset` + `heroImageUrl` override

`asset(id)` returns the `Asset` interface; concrete members:

ImageAsset `i1`:
| field | value |
|-------|-------|
| id | `"i1"` |
| url | `"https://cdn.example.com/img/i1.jpg"` |
| width | `1200` |
| height | `630` |

VideoAsset `v1`:
| field | value |
|-------|-------|
| id | `"v1"` |
| url | `"https://cdn.example.com/vid/v1.mp4"` |
| durationSeconds | `300` |
| transcodeProgress (`Float`) | `0.75` |

MediaAsset `m1`:
| field | value |
|-------|-------|
| id | `"m1"` |
| storageKey (`@inaccessible`) | `"s3://bucket/m1"` |

`Article.heroImageUrl` (override-owned by media): a1 → `"https://cdn.example.com/hero/a1.jpg"`, a2 → `"https://cdn.example.com/hero/a2.jpg"` (same values as §3, served by media).

---

## 9. Billing (home: billing; extends Organization)

`Organization("o1").subscription` = `s1`.
`Organization("o1").invoices` = `[inv1, inv2]`.

Subscription `s1` (`@key("orgId planId")` + `@key(id)`):
| field | value |
|-------|-------|
| id | `"s1"` |
| orgId | `"o1"` |
| planId | `"pro"` |
| status | `"active"` |
| internalLedgerRef (`@inaccessible`) | `"ldgr_s1_ref"` |
| org | `o1` |

`seatUtilization` formula (deterministic, assertable):

```
seatUtilization = round(seatsUsed / memberCount, 2)
```

- `seatsUsed = 9` (fixed in billing).
- `memberCount = 12` (pulled from accounts via `@requires(fields:"org { memberCount }")`).
- `seatUtilization = round(9 / 12, 2) = round(0.75, 2) = 0.75`.

Invoices:
| field | inv1 | inv2 |
|-------|------|------|
| id | `"inv1"` | `"inv2"` |
| amountCents | `9900` | `4900` |
| paid | `true` | `false` |

---

## 10. Cross-subgraph relationship map (quick reference)

```
u1 ──author──> a1                a1 ──author──> u1
u2 ──author──> a2                a2 ──author──> u2
u1 ──host────> p1
u1, u2 ──member──> o1            o1 ──subscription──> s1, ──invoices──> [inv1, inv2]
                                 s1 ──org──> o1

a1.reviews = [r1, r2]            r1.author=u2 r1.article=a1
a2.reviews = [r3]                r2.author=u1 r2.article=a1
p1.reviews = [r4]                r3.author=u1 r3.article=a2
u1.reviews = [r2, r3, r5]        r4.author=u2 r4.podcast=p1
u2.reviews = [r1, r4]            r5.author=u1 (review of user u1)

u1.recommendedArticles = [a2]    a1.relatedContent = [a2, p1]
u2.recommendedArticles = [a1]    a2.relatedContent = [p1]

stats(a1)=(1500,42,95.5)  stats(a2)=(3200,88,210.0)  stats(p1)=(500,10,1750.0)

asset i1 (Image), v1 (Video, transcodeProgress 0.75), m1 (MediaAsset)
```

---

## 11. EXACT normal-mode expected responses (N-01..N-14)

Each block is the complete `{"data":{...}}` object the router returns for the normal-mode (no `@defer`) query. The TS suite asserts these with `assert.deepEqual` against the parsed JSON. Defer-mode round-trips must reconstruct the matching object.

JSON-shape notes:
- Object key order is not significant for `deepEqual`; the order below follows selection-set order for readability.
- List element order IS significant and follows the canonical ordering in §§5–9.
- `Float` values are shown with the exact JSON number the router emits (`210.0` → JSON `210`, `95.5` → JSON `95.5`, `0.75` → JSON `0.75`). JSON has no float/int distinction, so `avgReadSeconds` for a2 serializes as `210` and for p1 as `1750`. The suite compares parsed numbers, so `210.0 === 210`.

### N-01 — single `@key` + cross-subgraph author
Query: `{ article(id:"a1"){ id title author{ id displayName } } }`
```json
{"data":{"article":{"id":"a1","title":"Hello World","author":{"id":"u1","displayName":"Alice Author"}}}}
```

### N-02 — composite key lookup
Query: `{ articleBySlug(slug:"hello", locale:"en"){ id title } }`
```json
{"data":{"articleBySlug":{"id":"a1","title":"Hello World"}}}
```

### N-03 — `@requires` (reviews)
Query: `{ article(id:"a1"){ reviews{ id rating readingTimeAdjusted } } }`
```json
{"data":{"article":{"reviews":[{"id":"r1","rating":5,"readingTimeAdjusted":7},{"id":"r2","rating":3,"readingTimeAdjusted":5}]}}}
```

### N-04 — `@requires` (billing)
Query: `{ organization(id:"o1"){ subscription{ status seatUtilization } } }`
```json
{"data":{"organization":{"subscription":{"status":"active","seatUtilization":0.75}}}}
```

### N-05 — `@provides`
Query: `{ featuredArticle{ title author{ displayName } } }`
`featuredArticle` returns `a1`.
```json
{"data":{"featuredArticle":{"title":"Hello World","author":{"displayName":"Alice Author"}}}}
```

### N-06 — `@override`
Query: `{ article(id:"a1"){ heroImageUrl } }`
```json
{"data":{"article":{"heroImageUrl":"https://cdn.example.com/hero/a1.jpg"}}}
```

### N-07 — `@interfaceObject` stats
Query: `{ article(id:"a1"){ stats{ views shares } } podcast(id:"p1"){ stats{ views } } }`
```json
{"data":{"article":{"stats":{"views":1500,"shares":42}},"podcast":{"stats":{"views":500}}}}
```

### N-08 — union across subgraphs
Query: `{ search(term:"x"){ __typename ... on Article{ id title } ... on Podcast{ id durationSeconds } } }`
`search` returns, in canonical order: `[a1, a2, p1]`.
```json
{"data":{"search":[{"__typename":"Article","id":"a1","title":"Hello World"},{"__typename":"Article","id":"a2","title":"World News"},{"__typename":"Podcast","id":"p1","durationSeconds":1800}]}}
```

### N-09 — interface `Publishable` (relatedContent)
Query: `{ article(id:"a1"){ relatedContent{ __typename ... on Article{ title } ... on Podcast{ title } } } }`
`a1.relatedContent = [a2, p1]`.
```json
{"data":{"article":{"relatedContent":[{"__typename":"Article","title":"World News"},{"__typename":"Podcast","title":"The Hello Podcast"}]}}}
```

### N-10 — entity interface `Asset`
Query: `{ asset(id:"v1"){ __typename id url ... on VideoAsset{ transcodeProgress } } }`
```json
{"data":{"asset":{"__typename":"VideoAsset","id":"v1","url":"https://cdn.example.com/vid/v1.mp4","transcodeProgress":0.75}}}
```

### N-11 — `@inaccessible` is hidden (negative)
Query: `{ user(id:"u1"){ internalAuthToken } }`
`internalAuthToken` is `@inaccessible`, so it is not present in the supergraph schema. The router rejects the operation at validation; there is no `data`. Expected error-shaped response (assert the error, not a `data` object):
```json
{"errors":[{"message":"Cannot query field \"internalAuthToken\" on type \"User\"."}]}
```
Note: the exact `message` text is router/engine-dependent. The suite asserts that (a) `data` is absent or `null`, and (b) `errors[0].message` references the field `internalAuthToken`. Record the exact emitted message as a finding; do not patch.

### N-12 — `@tag` round-trips (sanity / introspection)
Query (introspection): `{ __type(name:"User"){ name } }`
`@tag` metadata is composition-level and is not exposed via standard introspection field-level tags; this test only confirms the `User` type exists in the supergraph.
```json
{"data":{"__type":{"name":"User"}}}
```
Note: tags surface in the composed supergraph SDL, not in standard `__type` introspection. The suite asserts the type resolves; tag presence is verified out-of-band against the composed schema, recorded as a finding.

### N-13 — multiple keys (Subscription) then invoices
Query: `{ organization(id:"o1"){ subscription{ id orgId planId status } invoices{ id amountCents paid } } }`
```json
{"data":{"organization":{"subscription":{"id":"s1","orgId":"o1","planId":"pro","status":"active"},"invoices":[{"id":"inv1","amountCents":9900,"paid":true},{"id":"inv2","amountCents":4900,"paid":false}]}}}
```

### N-14 — deep cross-subgraph (accounts → reviews → recommendations)
Query: `{ user(id:"u1"){ displayName reviews{ rating } recommendedArticles{ title } } }`
`u1.reviews = [r2, r3, r5]` (ratings 3, 4, 2); `u1.recommendedArticles = [a2]` (title "World News").
```json
{"data":{"user":{"displayName":"Alice Author","reviews":[{"rating":3},{"rating":4},{"rating":2}],"recommendedArticles":[{"title":"World News"}]}}}
```

---

## 12. Defer round-trip cross-reference (which N-* each DT-* reconstructs)

The defer-mode tests (DESIGN §5.3) reuse these queries with `@defer` fragments. After reconstruction, the merged object MUST equal the listed normal-mode response:

| DT | reconstructs / equals |
|----|-----------------------|
| DT-01, DT-02, DT-04, DT-05, DT-06 | N-01 augmented with `article.reviews = [{id:"r1",rating:5},{id:"r2",rating:3}]` (per query selection). |
| DT-03 | `{"data":{"article":{"id":"a1","title":"Hello World"}}}` |
| DT-07 | `article = {id:"a1", reviews:[{id:"r1"},{id:"r2"}], relatedContent:[{__typename:"Article"},{__typename:"Podcast"}]}` |
| DT-08 | `user = {id:"u1", recommendedArticles:[{id:"a2", reviews:[{rating:9}]}]}` (a2.reviews = [r3], rating 9). |
| DT-09 | `user = {displayName:"Alice Author", reviews:[{id:"r2",rating:3},{id:"r3",rating:4},{id:"r5",rating:2}]}` |
| DT-10 | `article = {id:"a1", wordCount:400, reviews:[{readingTimeAdjusted:7},{readingTimeAdjusted:5}]}` |
| DT-11 | N-05 shape: `featuredArticle = {id:"a1", author:{displayName:"Alice Author"}}` |
| DT-12 | `search` list where a1→{title:"Hello World",wordCount:400}, a2→{title:"World News",wordCount:1000}, p1→{durationSeconds:1800}, each plus `__typename`. |
| DT-13 | a1.relatedContent: a2→{title:"World News",publishedAt:"2024-02-20T00:00:00Z"}, p1→{title:"The Hello Podcast",publishedAt:"2024-03-10T00:00:00Z"}, each plus `__typename`. |
| DT-14 | `article = {id:"a1", stats:{views:1500,shares:42,avgReadSeconds:95.5}}` |
| DT-15 | `articles = [{id:"a1",reviews:[{id:"r1"},{id:"r2"}]},{id:"a2",reviews:[{id:"r3"}]}]` (articles list = [a1,a2]). |
| DT-16 | N-10 shape: `asset = {__typename:"VideoAsset", id:"v1", transcodeProgress:0.75}` |
| DT-17 | `organization = {id:"o1", subscription:{status:"active", seatUtilization:0.75}}` |
| DT-18 | characterization: `article = {id:"a1", author:{username:"alice"}}` reconstructed (exact frame behavior recorded, not asserted as correctness). |
| DT-19 | combination of DT-01/DT-07/DT-14 fields on `article(id:"a1")`. |

Notes:
- `articles` root list canonical order = `[a1, a2]` (only the two seeded articles).
- `search(term:"x")` canonical order = `[a1, a2, p1]`.
- These reconstruction targets are derived strictly from §§1–9 and must remain consistent if any fixture value changes.
