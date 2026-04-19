# @openfed__requestScoped Directive

Per-request coordinate L1 cache for fields that resolve to the same value within a request.
Eliminates redundant subgraph calls when multiple fields in a subgraph share an identity
that only depends on the request context (current viewer, tenant, locale, feature flags, etc.).

## TL;DR

```graphql
directive @openfed__requestScoped(key: String!) on FIELD_DEFINITION

# Every participating field declares the directive with the SAME key.
type Query {
  currentViewer: Viewer @openfed__requestScoped(key: "currentViewer")
}

type Personalized @key(fields: "id") @interfaceObject {
  id: ID!
  currentViewer: Viewer @inaccessible @openfed__requestScoped(key: "currentViewer")
}
```

Both fields share L1 key `{subgraphName}.currentViewer`.
Whichever resolves first populates the per-request L1;
subsequent fields inject from L1 and skip their subgraph fetch.

## Semantics

### Symmetric — no receiver, no provider

There is no receiver/provider distinction.
Every field annotated with `@openfed__requestScoped(key: "X")` in the same subgraph is BOTH:

- **A reader** — the planner emits a hint so the resolver can inject from L1 and skip the fetch
- **A writer** — the planner emits an export so the resolver stores the value in L1 after the fetch

The first field in the execution order populates L1.
Every subsequent field with the same key is a candidate for injection.

### L1 key format

`{subgraphName}.{key}`

The subgraph prefix isolates L1 entries across subgraphs.
Two subgraphs that happen to use the same `key` do not collide.

### Scope

Per request, in-memory, on a `sync.Map` stored on the resolver's `Loader`.
Discarded when the request completes.
No cross-request sharing — that's what L2 is for.

### Participation requires ≥ 2 fields

Composition emits a warning when a key is declared on only one field in the subgraph.
The directive is meaningless without a second reader — there would be no one to benefit from the cache.

## When to use it

Use `@openfed__requestScoped` when:

- Multiple fields in the same subgraph resolve to a value that depends ONLY on the request context
- The value is identical across all entities/rows/items within the request
- Fetching the same value multiple times is wasteful

Typical use cases:

| Scenario | Key examples |
|----------|--------------|
| Current authenticated user | `currentViewer`, `me`, `session` |
| Current tenant / organization | `tenantConfig`, `currentOrg` |
| Request-level locale / feature flags | `locale`, `flags` |
| Rate limit / quota status | `quotaRemaining` |
| A/B test bucket | `experimentBucket` |

Do NOT use `@openfed__requestScoped` when:

- The value depends on entity identity (use normal entity resolution)
- The value changes between requests but should persist (use `@openfed__entityCache` / L2)
- The field has arguments that affect the value per call (use normal fetch)

## Compared to `@openfed__entityCache`

| Concern | `@openfed__entityCache` | `@openfed__requestScoped` |
|---------|---------------|------------------|
| Scope | Cross-request | Per-request |
| Cache layer | L2 (Redis/Ristretto) + L1 | Coordinate L1 only |
| Keyed by | Entity `@key` fields | Directive `key` argument |
| TTL | Configurable | Request duration |
| Purpose | Avoid re-fetching entities across requests | Avoid re-fetching the same request-scoped value within a request |

The two directives are complementary and can be used together.
A field with `@openfed__entityCache` on its return type and `@openfed__requestScoped` on the field itself
gets request-scoped deduplication AND cross-request caching.

## Example: `Personalized` via `@interfaceObject`

The canonical use case.
An interface that carries request-scoped fields
is implemented by many concrete entities.

```graphql
# viewer subgraph
extend schema
  @link(
    url: "https://specs.apollo.dev/federation/v2.5"
    import: ["@key", "@interfaceObject", "@inaccessible"]
  )

directive @openfed__requestScoped(key: String!) on FIELD_DEFINITION

type Personalized @key(fields: "id") @interfaceObject {
  id: ID!
  currentViewer: Viewer @inaccessible @openfed__requestScoped(key: "currentViewer")
}

type Viewer @key(fields: "id") {
  id: ID!
  name: String!
  email: String!
}

type Query {
  currentViewer: Viewer @openfed__requestScoped(key: "currentViewer")
}
```

```graphql
# cachegraph subgraph — Article implements Personalized via @interfaceObject
type Article @key(fields: "id") {
  id: ID!
  title: String!
  body: String!
}
```

For the query:

```graphql
{
  currentViewer { id name email }     # root fetch to viewer
  articles {                          # root fetch to cachegraph
    id
    title
    currentViewer { id name }         # would require N entity fetches to viewer
  }
}
```

Without `@openfed__requestScoped`:
`Query.currentViewer` resolves on the viewer subgraph,
then `Personalized._entities` is called on the viewer subgraph with N articles,
each returning the same viewer data.

With `@openfed__requestScoped`:
`Query.currentViewer` populates L1 under `viewer.currentViewer`.
The `Personalized._entities` batch for N articles is SKIPPED entirely —
the cached value is injected onto each article's `currentViewer` field.
**The viewer subgraph is called exactly once per request regardless of N.**

## Implementation architecture

### Four cache layers

```
┌─────────────────────────────────────────────────────────┐
│                    GraphQL Request                       │
└─────────────────────────────┬────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│  Coordinate L1 (requestScopedL1, per-request sync.Map)  │
│  Key: "{subgraphName}.{key}"                             │
│  Used by: @openfed__requestScoped                                 │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│  Entity L1 (per-request sync.Map)                       │
│  Key: `{"__typename":"X","key":{"id":"..."}}`           │
│  Used by: entity fetch deduplication, @openfed__entityCache L1   │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│  Entity L2 (cross-request, external — Redis/Ristretto)  │
│  Key: `{"__typename":"X","key":{"id":"..."}}`           │
│  Used by: @openfed__entityCache                                   │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│  Subgraph                                                │
└─────────────────────────────────────────────────────────┘
```

### Unified normalization pipeline

The coordinate L1, entity L1, and entity L2 caches share the same alias-aware
normalization pipeline based on the response plan's `*Object` tree:

- **Write (normalize)**: `normalizeForCache(value, obj)` — renames aliases to schema
  field names, appends arg-hash suffixes for arg-variant fields, walks nested objects/arrays.
  Returns input unchanged if `obj.HasAliases` is false (fast path).

- **Validate (widening check)**: `validateItemHasRequiredData(cached, obj)` — checks
  that the cached value contains every field declared in `obj.Fields`.
  Missing field → widening check fails → fetch proceeds normally instead of using stale cache.

- **Read (denormalize)**: `shallowCopyProvidedFields(cached, obj)` — copies fields
  from the schema-named cache into a response-named object (re-applies aliases for
  the current query's selection set).

### Components

| Layer | File | Role |
|-------|------|------|
| **Composition (TS)** | `composition/src/v1/constants/directive-definitions.ts` | Directive AST |
| | `composition/src/v1/normalization/directive-definition-data.ts` | Validation metadata (key required) |
| | `composition/src/v1/normalization/normalization-factory.ts:extractRequestScopedFields` | Extraction + single-field warning |
| | `composition/src/router-configuration/types.ts:RequestScopedFieldConfig` | Output type |
| **Proto** | `proto/wg/cosmo/node/v1/node.proto:RequestScopedFieldConfiguration` | Wire format |
| **Shared (TS)** | `shared/src/router-config/graphql-configuration.ts` | Serializer |
| **Router (Go)** | `router/core/factoryresolver.go:dataSourceMetaData` | Proto → `plan.RequestScopedField` |
| **Planner (Go)** | `v2/pkg/engine/plan/federation_metadata.go:RequestScopedField` | Plan type |
| | `v2/pkg/engine/datasource/graphql_datasource/graphql_datasource.go:ConfigureFetch` | Emits hint AND export per field (symmetric) |
| | `v2/pkg/engine/plan/visitor.go:configureFetchCaching` | Populates `ProvidesData` from `plannerObjects[fetchID]`; rewrites `FieldName`/`FieldPath` to outer query's alias |
| **Resolver (Go)** | `v2/pkg/engine/resolve/fetch.go:RequestScopedHint/RequestScopedExport` | Carry `ProvidesData *Object` |
| | `v2/pkg/engine/resolve/loader.go:requestScopedL1` | Per-request `sync.Map` |
| | `v2/pkg/engine/resolve/loader_cache.go:tryRequestScopedInjection` | Collect-then-inject with widening check |
| | `v2/pkg/engine/resolve/loader_cache.go:exportRequestScopedFields` | Normalize before storing |

### Execution flow

```
1. Planner walks the response plan and locates the *Object sub-tree for each
   @openfed__requestScoped field. Populates RequestScopedHint.ProvidesData and
   RequestScopedExport.ProvidesData. Rewrites FieldName/FieldPath to use the
   outer query's alias when aliased.

2. For every fetch:
   a. Phase 1 (pre-fetch): tryRequestScopedInjection checks L1 under hint.L1Key.
      - If not found → return false, fetch proceeds.
      - If found → validateItemHasRequiredData against hint.ProvidesData (widening).
        - If check fails → return false, fetch proceeds.
        - If check passes → shallowCopyProvidedFields (re-apply aliases) and
          inject onto items. Mark fetch as skipped.
   b. If the fetch was NOT skipped, it runs normally.
   c. Phase 2 (post-fetch): exportRequestScopedFields reads the field value
      from the response, normalizes via export.ProvidesData, stores in L1
      under export.L1Key.

3. L1 is reset at the start of each request (Loader.Free / LoadGraphQLResponseData).
```

### Field widening check

When a narrower query (`{id, name}`) caches a value and a subsequent wider query
(`{id, name, email}`) tries to inject from L1, the widening check catches the
missing `email` and skips injection. The wider fetch runs normally, then updates L1
with the wider field set. This prevents silent data loss.

### Alias handling

Aliases are transparent to the L1 cache:

- **L1 key** is schema-based (`{subgraphName}.{key}`) — aliases have no effect
- **L1 stored value** uses schema field names (normalized away on write)
- **Widening check** uses schema names (matches normalized L1)
- **Denormalized read** re-applies aliases for the current query

Example:
```graphql
# Request A
{ me: currentViewer { id, displayName: name } }
# L1 stores: {"id": "...", "name": "..."}  (schema names)

# Request B (same request, different fetch)
{ articles { viewer: currentViewer { id, name } } }
# L1 widening check: needs id and name — satisfied
# Inject: produces {"viewer": {"id": "...", "name": "..."}}
```

### Arg-variant sub-fields

Handled for free via the unified pipeline. A query requesting
`currentViewer { posts(first: 5) { id } }` stores the posts under a cacheFieldName
like `posts_<xxhash of args>`. A later query requesting `posts(first: 10)` has a
different arg hash, so the widening check fails and the fetch runs normally.
Both variants coexist in L1 under different sub-field keys.

## Composition validation

### Error: key missing

```graphql
currentViewer: Viewer @openfed__requestScoped  # ERROR: missing required arg "key"
```

### Error: directive repeated

```graphql
# @openfed__requestScoped is NOT repeatable
currentViewer: Viewer @openfed__requestScoped(key: "a") @openfed__requestScoped(key: "b")  # ERROR
```

### Warning: single field with key

```graphql
type Query {
  currentViewer: Viewer @openfed__requestScoped(key: "lonely")  # WARNING: only one field
}
# No other field in the subgraph declares @openfed__requestScoped(key: "lonely")
# → directive is meaningless, warning emitted
```

## Trace reporting

When a fetch is skipped via `tryRequestScopedInjection`:

- `ensureFetchTrace(f).LoadSkipped = true` — ART shows the fetch as skipped
- `res.cacheTraceRequestScopedHits = res.cacheTraceEntityCount` — these get folded
  into `L1Hit` by `buildCacheTrace`, so the playground's red bolt icon and
  "X/Y Cached" badge correctly reflect the request-scoped injection

## Per-request cache control

For debugging / demo purposes, the router supports per-request cache control headers
(gated on dev mode or valid studio token):

- `X-WG-Disable-Entity-Cache: true` → disable L1 and L2
- `X-WG-Disable-Entity-Cache-L1: true` → disable L1 only (including coordinate L1)
- `X-WG-Disable-Entity-Cache-L2: true` → disable L2 only

Disabling L1 via these headers also disables the `@openfed__requestScoped` coordinate L1.

The playground's cache mode dropdown ("Caching enabled / L2 only / L1 only / disabled")
injects these headers transparently.

## Known limitations

### No cross-subgraph participation

Two subgraphs cannot share an L1 entry even if they use the same `key`.
The subgraph prefix in the L1 key is intentional — cross-subgraph sharing would
require cross-subgraph consistency guarantees that don't exist.

If you need the same value in two subgraphs, each subgraph must resolve it
independently. That's still O(subgraphs) calls, not O(entities).

### Planner integration of aliases is partial

The planner populates `ProvidesData` and rewrites `FieldName`/`FieldPath` to aliases
for the top-level `@openfed__requestScoped` field. Sub-field aliases (e.g., `currentViewer { displayName: name }`)
are handled via the unified `*Object` pipeline automatically — nothing extra needed.

### No value validation on key collisions

If two `@openfed__requestScoped` fields in the same subgraph declare the same key but have
incompatible types (e.g., one returns `Viewer`, another returns `String`), composition
does not currently validate this. At runtime, the widening check would catch the
mismatch and fall back to running the fetch, but no warning is emitted at composition time.
This is a potential future enhancement.

## Test coverage

- `composition/tests/v1/directives/entity-cache-fuzz.test.ts` — directive arg validation, single-field warning, repeatable error
- `graphql-go-tools/v2/pkg/engine/resolve/request_scoped_test.go` — resolver primitives: hit, miss, widening, export, round-trip, arena detach, aliases, nested, arrays, arg-variants, `__typename`
- `graphql-go-tools/v2/pkg/engine/plan/federation_metadata_test.go` — `RequestScopedFieldsForType`, `RequestScopedExportsForField`
- `graphql-go-tools/v2/pkg/engine/plan/request_scoped_provides_data_test.go` — planner `ProvidesData` population and alias rewriting
- `router/core/factoryresolver_test.go` — proto → plan mapping
- `router-tests/entity_caching/` — integration tests

## References

- Acceptance criteria: `graphql-go-tools/docs/entity-caching/ENTITY_CACHING_ACCEPTANCE_CRITERIA.md` (AC-RS-01..08)
- Composition CLAUDE.md: `composition/CLAUDE.md` — directive extraction
- graphql-go-tools CLAUDE.md: `graphql-go-tools/CLAUDE.md` — resolver + planner architecture
