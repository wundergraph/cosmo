# Entity Caching with Cosmo Cloud — Tutorial

Entity caching lets the router serve resolved federation entities from a cache, instead of re-fetching them from your subgraphs on every
request. You declare what is cacheable with directives in your subgraph SDL, publish your
subgraphs to Cosmo Cloud, and Cosmo Cloud composition turns those directives into router
configuration automatically.

This guide is a **hands-on walkthrough** using the demo subgraphs in this repo
(`demo/pkg/subgraphs`). It uses the **hosted Cosmo Cloud control plane** for composition — you do
**not** need to compose locally. Along the way it explains each cache directive so you know what
you are annotating and why.

By the end you will have:

- a namespace and a federated graph on Cosmo Cloud,
- the demo subgraphs published and composing,
- a router connected to the graph with entity caching enabled.

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

- A Cosmo Cloud account with access to an organization.
- The [`wgc`](https://cosmo-docs.wundergraph.com/cli) CLI installed.
- Docker (to run the router), or a router binary.
- This repo checked out — the demo subgraph schemas live under `demo/pkg/subgraphs`.
- A Redis instance reachable from the router **if** you want the shared L2 cache (recommended for
  multi-replica deployments). You can also use the in-memory adapter for testing.

The commands below use **absolute** schema paths, so they work from any directory. Set the demo
root once, and authenticate `wgc`:

```bash
export DEMO=/Users/username/Work/cosmo/demo

# Authenticate wgc against your Cosmo Cloud org (opens browser)
wgc auth login
```

## Step 1 — Create and Select a Namespace

A namespace isolates this graph and its subgraphs from everything else in the org. Create a
dedicated one and use it for every command below.

```bash
# Name of the namespace to use throughout this tutorial
export NS=entity-caching

# Create it (skip if it already exists)
wgc namespace create $NS
```

Useful namespace commands:

```bash
wgc namespace list            # see existing namespaces
wgc namespace delete $NS      # remove it (also removes graphs/subgraphs in it)
```

Because every command below passes `--namespace $NS`, all resources land in this namespace.

## Step 2 — Create the Federated Graph

`--routing-url` is where **your router** will serve (adjust to your router's address). The label
matcher binds subgraphs to this graph: any subgraph whose labels satisfy it is included in
composition.

```bash
wgc federated-graph create entitycachegraph \
  --namespace $NS \
  --routing-url http://localhost:3002/graphql \
  --label-matcher "team=demo"
```

To delete it later (composition/config only — the subgraphs stay):

```bash
wgc federated-graph delete entitycachegraph --namespace $NS
```

## Step 3 — Publish The Demo Subgraphs (Baseline, No Caching)

First get a plain, working graph. Publish the demo schemas **as-is** — no cache directives yet —
so you have a baseline that composes and serves before layering caching on top.

`wgc subgraph publish` creates the subgraph on first publish when you pass `--routing-url` and
`--label` — so this both registers and pushes the schema. Composition runs on Cosmo Cloud; there
is no local composition step and no source-built router required — the hosted control plane does
the work.

`employees` is the base entity graph, so publish it first; the rest extend the `Employee` entity.

> The subgraphs reference each other's entities, so individual publishes may report a transient
> composition error until every subgraph is present. Once all of them are published, composition
> succeeds — verify in Step 4.

```bash
# 1) employees — base entity
wgc subgraph publish employees \
  --schema $DEMO/pkg/subgraphs/employees/subgraph/schema.graphqls \
  --routing-url http://localhost:4001/graphql \
  --label "team=demo" --namespace $NS

# 2) family
wgc subgraph publish family \
  --schema $DEMO/pkg/subgraphs/family/subgraph/schema.graphqls \
  --routing-url http://localhost:4002/graphql \
  --label "team=demo" --namespace $NS

# 3) hobbies
wgc subgraph publish hobbies \
  --schema $DEMO/pkg/subgraphs/hobbies/subgraph/schema.graphqls \
  --routing-url http://localhost:4003/graphql \
  --label "team=demo" --namespace $NS

# 4) products
wgc subgraph publish products \
  --schema $DEMO/pkg/subgraphs/products/subgraph/schema.graphqls \
  --routing-url http://localhost:4004/graphql \
  --label "team=demo" --namespace $NS

# 5) availability
wgc subgraph publish availability \
  --schema $DEMO/pkg/subgraphs/availability/subgraph/schema.graphqls \
  --routing-url http://localhost:4007/graphql \
  --label "team=demo" --namespace $NS

# 6) mood
wgc subgraph publish mood \
  --schema $DEMO/pkg/subgraphs/mood/subgraph/schema.graphqls \
  --routing-url http://localhost:4008/graphql \
  --label "team=demo" --namespace $NS

# 7) countries
wgc subgraph publish countries \
  --schema $DEMO/pkg/subgraphs/countries/subgraph/schema.graphqls \
  --routing-url http://localhost:4009/graphql \
  --label "team=demo" --namespace $NS
```

> **Not included:** `test1`, `cachegraph`, `employeeupdated`, `employee-events`, and the
> `products_fg` feature graph (`myff` feature flag). Add them the same way if you need them. The
> routing URLs above come from `demo/graph.yaml`; swap in reachable URLs if your subgraphs run
> elsewhere.

## Step 4 — Verify Composition

```bash
# Show the graph and its composition status
wgc federated-graph list --namespace $NS

# Pull the composed schema — fails if composition is broken
wgc federated-graph fetch entitycachegraph --namespace $NS

# List the published subgraphs
wgc subgraph list --namespace $NS
```

Add `-o/--out <dir>` to `fetch` to download the full set of files (all subgraph SDLs, the composed
supergraph + client schema, the router execution config, and a composition manifest) into a
folder instead of printing to stdout:

```bash
wgc federated-graph fetch entitycachegraph --namespace $NS --out entitycachegraph-export
```

## Step 5 — Connect The Router

The router authenticates to Cosmo Cloud with a **graph API token** and pulls the composed config
automatically — no local execution config needed. You'll turn entity caching on in the router
config here; it stays inert until you annotate entities in Step 6.

### 5a. Create a router token

```bash
wgc router token create entity-cache-router \
  --graph-name entitycachegraph \
  --namespace $NS
```

This prints the token **once**. Copy it and export it:

```bash
export GRAPH_API_TOKEN=<the-token-it-printed>
```

### 5b. Router config

Create `config.yaml`. There is **no** `execution_config.file` block — with `GRAPH_API_TOKEN` set,
the router polls Cosmo Cloud for the composed config. Turn entity caching on and (optionally)
point L2 at a Redis storage provider:

```yaml
version: "1"

listen_addr: "localhost:3002"   # matches the graph's --routing-url

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
  l2:
    # Shared cache across router instances, backed by Redis.
    enabled: true
    storage:
      provider_id: "entity-cache-redis"
      key_prefix: "cosmo_entity_cache"
```

### 5c. Run the router **from this branch**

> **Do not use the published `ghcr.io/wundergraph/cosmo/router:latest` image.** Entity caching is
> not in a released router yet — it lives only on this branch. You must run the router built from
> the local source, otherwise the cache directives and `entity_caching` config are ignored.

Start the demo subgraphs first, then run the source router:

```bash
# In one terminal — start the demo subgraphs (ports 4001–4009)
cd $DEMO && ./run_subgraphs.sh

# In another terminal — run the router from source (this branch)
cd /Users/milindadias/Work/cosmo/router
GRAPH_API_TOKEN=$GRAPH_API_TOKEN \
LISTEN_ADDR=localhost:3002 \
CONFIG_PATH="$PWD/config.yaml" \
go run cmd/router/main.go
```

Put the `config.yaml` from Step 5b next to the router (`router/config.yaml`) or point `CONFIG_PATH`
at wherever you saved it. The router authenticates with the token, pulls the composed config for
`entitycachegraph`, and serves it at `http://localhost:3002/graphql`.

- **Subgraphs must be reachable** — the graph points at `localhost:4001–4009`, so run the router on
  the same host as the demo subgraphs.
- If you set `l2.enabled: true`, make sure Redis is reachable at the configured URL.

> **Building a local image instead.** If you want a container, build one from this branch rather
> than pulling `:latest`. The router Dockerfile's build context is the `router/` directory:
>
> ```bash
> docker build -t cosmo-router:local router/
> docker run --rm \
>   -e GRAPH_API_TOKEN=$GRAPH_API_TOKEN \
>   -e LISTEN_ADDR=0.0.0.0:3002 \
>   -p 3002:3002 \
>   -v "$PWD/config.yaml:/config.yaml" -e CONFIG_PATH=/config.yaml \
>   cosmo-router:local
> ```
>
> Run the container with `--network host` (Linux) or point routing URLs at `host.docker.internal`
> so it can reach the demo subgraphs on the host.

At this point you have a **working baseline**: run a query at `http://localhost:3002/graphql` and
confirm it resolves across the subgraphs. Entity caching is enabled on the router but does nothing
yet because no entity is annotated — that's Step 6.

## Step 6 — Add Cache Directives To The Demo SDLs

Now layer caching on. Pick an entity, register the directive definitions in that subgraph's SDL,
annotate the type, and republish. Composition regenerates the execution config with cache metadata
and the running router picks it up.

### 6a. Register the directive definitions

Add these definitions to every subgraph SDL you annotate, so the subgraph server itself accepts
the directives at runtime (Cosmo Cloud composition understands them, but your subgraph parses its
own schema too):

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

> If your GraphQL server rejects unknown directives, register these definitions (as above) or
> configure the server to ignore unknown directives.

### 6b. Annotate an entity

Start with caching alone — just mark an entity cacheable. The `availability` subgraph is a good
target: its `Employee` entity has `@key(fields: "id")`, and the demo adds artificial latency
there, which makes the cache hit easy to observe. Entity caching applies per subgraph, so
annotating `Employee` here caches the `availability` subgraph's entity resolution specifically.

In `demo/pkg/subgraphs/availability/subgraph/schema.graphqls`, add `@openfed__entityCache` to the
`Employee` type:

```graphql
type Employee @key(fields: "id") @openfed__entityCache(maxAge: 120, partialCacheLoad: true) {
  id: Int!
  isAvailable: Boolean
}
```

See [Available Directives](#available-directives) below for every argument and the other
directives.

### 6c. Republish and let the router pick it up

Republish only the subgraph you changed:

```bash
# availability — now carries @openfed__entityCache on Employee
wgc subgraph publish availability \
  --schema $DEMO/pkg/subgraphs/availability/subgraph/schema.graphqls \
  --namespace $NS
```

If composition rejects a directive (for example, a non-positive `maxAge`), `wgc` reports the error
— fix the SDL and republish. Composition emits the cache metadata into the execution config, and
the running router polls and applies it automatically. Confirm the entity is now served from cache
(second read shouldn't hit the subgraph) using the steps in [Verifying It Works](#verifying-it-works).

### 6d. Add invalidation (optional)

Once the plain cache works, layer on invalidation so writes don't serve stale data. The
`availability` subgraph owns the `updateAvailability` mutation, which returns an `Employee` — add
`@openfed__cacheInvalidate` so the router evicts that entity from the cache after the mutation
resolves:

```graphql
type Mutation {
  """This mutation updates the availability status of an employee in the system."""
  updateAvailability(employeeID: Int!, isAvailable: Boolean!): Employee! @openfed__cacheInvalidate
}
```

Republish `availability` again. Now a warm read → `updateAvailability` → read again fetches fresh
availability instead of the cached value.

## Available Directives

| Directive                   | Location                                | Purpose                                                               |
| --------------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| `@openfed__entityCache`     | Object type                             | Marks an entity type (with `@key`) as cacheable.                     |
| `@openfed__cacheInvalidate` | Root `Mutation` / `Subscription` field  | Evicts the returned entity from the cache after the field resolves.  |
| `@openfed__cachePopulate`   | Root `Mutation` / `Subscription` field  | Writes the returned entity to the cache after the field resolves.    |

### `@openfed__entityCache`

Use it on entity object types that have at least one federation `@key`.

```graphql
type Product @key(fields: "id") @openfed__entityCache(maxAge: 120) {
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

Use it on root `Mutation` fields that return a cacheable entity. After the field
resolves, the router evicts the returned entity from the cache.

```graphql
type Mutation {
  updateProduct(id: ID!, name: String!): Product @openfed__cacheInvalidate
}
```

### `@openfed__cachePopulate`

Use it on root `Mutation` fields that return a cacheable entity. After the field
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

## Verifying It Works

1. Add `@openfed__entityCache` to an entity and republish that subgraph (Step 6), then let Cosmo
   Cloud compose it.
2. Run a query that resolves that entity twice. The second request should be served from cache and
   should not hit the subgraph again (watch your subgraph logs/metrics).
3. With L2 (Redis) enabled, restart the router and run the query again — the cached entity should
   still be served from Redis, until its TTL expires.
4. Warm an entity, run a mutation annotated with `@openfed__cacheInvalidate`, then read again — the
   post-mutation read should fetch fresh data.

## Troubleshooting

- **No caching happens.** Confirm `entity_caching.enabled: true` on the router, that the entity has
  both a federation `@key` and `@openfed__entityCache`, and that the latest composition (with the
  directives) has been published and picked up by the router.
- **Subgraph not in the graph.** The `--label "team=demo"` on each subgraph must satisfy the
  graph's `--label-matcher "team=demo"`, or the subgraph is excluded from composition.
- **L2 entries are not shared / lost on restart.** Confirm `l2.enabled: true` and that
  `l2.storage.provider_id` matches a `storage_providers.redis[].id`, and that the router can reach
  Redis.
- **Header-specific data leaks across tenants.** Add `includeHeaders: true` to the relevant
  directive and make sure the router forwards the distinguishing header to that subgraph.
- **Composition rejects a directive.** Check `maxAge` is a positive integer and that the directive
  is on a supported location (`@openfed__entityCache` on an object type with `@key`;
  `@openfed__cacheInvalidate` / `@openfed__cachePopulate` on root Mutation/Subscription fields).
