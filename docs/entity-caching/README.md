# Entity Caching with Cosmo Cloud

Entity caching lets the router serve resolved federation entities from a cache (in-memory L1
and/or a shared L2 store such as Redis) instead of re-fetching them from your subgraphs on every
request. You declare what is cacheable with directives in your subgraph SDL, publish your
subgraphs to Cosmo Cloud, and Cosmo Cloud composition turns those directives into router
configuration automatically.

This guide uses the **hosted Cosmo Cloud control plane** for composition. You do **not** need to
compose locally or build the router from source — publish your subgraphs as usual and Cosmo Cloud
produces an execution config that carries the cache metadata to your router.

## How It Works

```text
your subgraph SDL (with cache directives)
        │  wgc subgraph publish
        ▼
Cosmo Cloud composition  →  execution config (with cache metadata)
        ▼
router (entity caching enabled, L1 in-memory + L2 Redis)
```

1. You annotate subgraph SDL with `@openfed__*` cache directives.
2. You publish the subgraphs to Cosmo Cloud (`wgc subgraph publish`). Composition runs on the
   hosted control plane and validates the directives.
3. Your router pulls the composed execution config and enforces the cache behavior, backed by L1
   (in-memory) and optionally L2 (Redis).

## Prerequisites

- A Cosmo Cloud account and a federated graph already created and publishing successfully.
  See the [Cosmo docs](https://cosmo-docs.wundergraph.com/) for the basics of creating a
  namespace, federated graph, and subgraphs.
- The [`wgc`](https://cosmo-docs.wundergraph.com/cli) CLI, authenticated against your
  organization.
- A router connected to your Cosmo Cloud graph.
- A Redis instance reachable from the router if you want the shared L2 cache (recommended for
  multi-replica deployments). L1 alone works for a single router instance.

## Step 1 — Add Cache Directives To Your Subgraph SDL

Add the directive definitions to every subgraph SDL that uses caching, so your subgraph server
also accepts them at runtime. Cosmo Cloud composition understands these `@openfed__*` directives;
this block keeps your subgraph server from rejecting them when it parses its own schema.

```graphql
directive @openfed__entityCache(
  maxAge: Int!
  negativeCacheTTL: Int = 0
  includeHeaders: Boolean = false
  partialCacheLoad: Boolean = false
  shadowMode: Boolean = false
) on OBJECT

directive @openfed__cacheInvalidate on FIELD_DEFINITION

directive @openfed__cachePopulate(maxAge: Int) on FIELD_DEFINITION
```

Then annotate your schema. A minimal cacheable entity:

```graphql
type Product @key(fields: "id") @openfed__entityCache(maxAge: 120, partialCacheLoad: true) {
  id: ID!
  name: String!
}
```

> If your GraphQL server rejects unknown directives, register these definitions (as above) or
> configure the server to ignore unknown directives.

## Step 2 — Publish To Cosmo Cloud

Publish each subgraph the same way you normally do. Composition runs on Cosmo Cloud and emits the
cache metadata into the execution config:

```bash
wgc subgraph publish products \
  --schema ./subgraphs/products/schema.graphqls \
  --namespace default
```

If composition rejects a directive (for example, a non-positive `maxAge`), `wgc` reports the
error. Fix the SDL and republish. There is no local composition step and no source-built router
required — the hosted control plane does the work.

## Step 3 — Enable Entity Caching On The Router

Entity caching is **off by default**. Enable it in your router configuration and point L2 at a
Redis storage provider:

```yaml
# Define the Redis store used for the shared L2 cache.
storage_providers:
  redis:
    - id: "entity-cache-redis"
      urls:
        - "redis://localhost:6379"
      cluster_enabled: false

entity_caching:
  enabled: true
  # Optional prefix applied to every cache key (useful to isolate environments).
  global_cache_key_prefix: ""
  l1:
    # In-memory, per-router-instance cache.
    enabled: true
  l2:
    # Shared cache across router instances, backed by Redis.
    enabled: true
    storage:
      provider_id: "entity-cache-redis"
      key_prefix: "cosmo_entity_cache"
    circuit_breaker:
      enabled: false
      failure_threshold: 5
      cooldown_period: 10s
```

Equivalent environment variables exist for most of these settings, e.g.
`ENTITY_CACHING_ENABLED`, `ENTITY_CACHING_L1_ENABLED`, `ENTITY_CACHING_L2_ENABLED`, and
`ENTITY_CACHING_L2_STORAGE_PROVIDER_ID`.

- **L1 only** (single instance): set `l2.enabled: false`. Cache lives in router memory and is
  lost on restart.
- **L1 + L2** (recommended): keep both enabled so the cache survives restarts and is shared
  across replicas.

## Available Directives

| Directive                   | Location                                | Purpose                                                               |
| --------------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| `@openfed__entityCache`     | Object type                             | Marks an entity type (with `@key`) as cacheable.                     |
| `@openfed__cacheInvalidate` | Root `Mutation` / `Subscription` field  | Evicts the returned entity from the cache after the field resolves.  |
| `@openfed__cachePopulate`   | Root `Mutation` / `Subscription` field  | Writes the returned entity to the cache after the field resolves.    |

### `@openfed__entityCache`

Use it on entity object types that have at least one federation `@key`.

```graphql
type Product @key(fields: "id") @openfed__entityCache(maxAge: 120, partialCacheLoad: true) {
  id: ID!
  name: String!
}
```

| Argument           | Required | Default | Use it for                                                                                        |
| ------------------ | -------- | ------- | ------------------------------------------------------------------------------------------------- |
| `maxAge`           | yes      | none    | Entity TTL in seconds. Must be greater than zero.                                                 |
| `negativeCacheTTL` | no       | `0`     | Cache "not found" (null) results briefly to avoid repeated lookups for missing entities.          |
| `includeHeaders`   | no       | `false` | Include forwarded request headers in the cache key (tenant-, auth-, or locale-specific data).     |
| `partialCacheLoad` | no       | `false` | For batch entity fetches, fetch only the missing entities instead of refetching the whole batch.  |
| `shadowMode`       | no       | `false` | Read and write cache metadata without serving cached data — use it to validate before going live. |

### `@openfed__cacheInvalidate`

Use it on root `Mutation` or `Subscription` fields that return a cacheable entity. After the field
resolves, the router evicts the returned entity from the cache.

```graphql
type Mutation {
  updateProduct(id: ID!, name: String!): Product @openfed__cacheInvalidate
}

type Subscription {
  productDeleted: Product @openfed__cacheInvalidate
}
```

### `@openfed__cachePopulate`

Use it on root `Mutation` or `Subscription` fields that return a cacheable entity. After the field
resolves, the router writes the returned entity to the cache.

```graphql
type Mutation {
  upsertProduct(id: ID!, name: String!): Product @openfed__cachePopulate(maxAge: 60)
}
```

`maxAge` is optional. When omitted, the router uses the TTL from the returned entity type's
`@openfed__entityCache`.

> Do not put both `@openfed__cacheInvalidate` and `@openfed__cachePopulate` on the same field.

## Not Yet Available

The following directives are part of the entity-caching design and will be documented and enabled
in a later release. **They are not available for use yet** — composition does not accept them on
Cosmo Cloud today, so do not add them to production subgraphs. They are described here only so you
know what is coming.

### `@openfed__queryCache` and `@openfed__is` — *not available yet*

`@openfed__queryCache` will cache a root `Query` field that returns a cacheable entity (or list of
entities), and `@openfed__is` will map a query argument to an entity `@key` field when the names
differ. Planned shape:

```graphql
# NOT AVAILABLE YET — for reference only
directive @openfed__queryCache(
  maxAge: Int!
  includeHeaders: Boolean = false
  shadowMode: Boolean = false
) on FIELD_DEFINITION

directive @openfed__is(fields: String!) on ARGUMENT_DEFINITION

type Query {
  product(id: ID!): Product @openfed__queryCache(maxAge: 120)
  productBySku(productSku: String! @openfed__is(fields: "sku")): Product @openfed__queryCache(maxAge: 120)
}
```

Until then, use `@openfed__entityCache` so entities are served from cache when they are fetched
through federation `_entities` resolution.

### `@openfed__requestScoped` — *not available yet*

`@openfed__requestScoped` will deduplicate two or more fields in the same subgraph that resolve to
the same value within a single request (a per-request L1-only cache that does not touch Redis and
does not survive across requests). Planned shape:

```graphql
# NOT AVAILABLE YET — for reference only
directive @openfed__requestScoped(key: String!) on FIELD_DEFINITION

type Query {
  currentViewer: Viewer @openfed__requestScoped(key: "currentViewer")
}
```

## Per-Request Cache Controls

When `dev_mode` is enabled (or via your configured header rules), you can influence caching per
request with these headers — handy for verifying behavior:

```text
X-WG-Disable-Entity-Cache: true      # bypass L1 and L2 for this request
X-WG-Disable-Entity-Cache-L1: true   # bypass L1 only
X-WG-Disable-Entity-Cache-L2: true   # bypass L2 only
X-WG-Cache-Key-Prefix: test-run-1    # isolate cache entries for a test run
```

## Verifying It Works

1. Publish a subgraph with `@openfed__entityCache` on an entity and let Cosmo Cloud compose it.
2. Run a query that resolves that entity twice. The second request should be served from cache and
   should not hit the subgraph again (watch your subgraph logs/metrics).
3. With L2 (Redis) enabled, restart the router and run the query again — the cached entity should
   still be served from Redis after the in-memory L1 is gone, until its TTL expires.
4. Set `shadowMode: true` first if you want to validate cache reads/writes while still serving live
   subgraph results, then turn it off to start serving cached data.
5. Warm an entity, run a mutation annotated with `@openfed__cacheInvalidate`, then read again — the
   post-mutation read should fetch fresh data.

## Troubleshooting

- **No caching happens.** Confirm `entity_caching.enabled: true` on the router, that the entity has
  both a federation `@key` and `@openfed__entityCache`, and that the latest composition (with the
  directives) has been published and picked up by the router.
- **L2 entries are not shared / lost on restart.** Confirm `l2.enabled: true` and that
  `l2.storage.provider_id` matches a `storage_providers.redis[].id`, and that the router can reach
  Redis.
- **Header-specific data leaks across tenants.** Add `includeHeaders: true` to the relevant
  directive and make sure the router forwards the distinguishing header to that subgraph.
- **Composition rejects a directive.** Check `maxAge` is a positive integer and that the directive
  is on a supported location (`@openfed__entityCache` on an object type with `@key`;
  `@openfed__cacheInvalidate` / `@openfed__cachePopulate` on root Mutation/Subscription fields).
