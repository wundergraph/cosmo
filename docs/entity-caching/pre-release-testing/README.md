# Entity Caching Pre-Release Testing

Use this kit to test entity caching in your own graph with PR [#2777](https://github.com/wundergraph/cosmo/pull/2777), before the feature is available in the public control plane and the released router.

You will compose locally from this checkout and run a source-built router with Redis. This avoids hosted control-plane composition, which may not yet understand the new cache directives.

## Get The PR Checkout

Use PR [#2777](https://github.com/wundergraph/cosmo/pull/2777)'s source branch:

```text
wundergraph/cosmo:jensneuse/entity-caching-v2
```

From a fresh directory:

```bash
git clone https://github.com/wundergraph/cosmo.git
cd cosmo
git fetch origin jensneuse/entity-caching-v2
git checkout -B entity-caching-pre-release origin/jensneuse/entity-caching-v2
git pull --ff-only origin jensneuse/entity-caching-v2
```

From an existing Cosmo checkout:

```bash
git remote set-url origin https://github.com/wundergraph/cosmo.git
git fetch origin jensneuse/entity-caching-v2
git checkout -B entity-caching-pre-release origin/jensneuse/entity-caching-v2
git pull --ff-only origin jensneuse/entity-caching-v2
```

When you test again later, update the checkout before composing:

```bash
git checkout entity-caching-pre-release
git pull --ff-only origin jensneuse/entity-caching-v2
```

Confirm that you are on the pre-release branch:

```bash
git status --short --branch
```

The output should include:

```text
## entity-caching-pre-release
```

## Quick Start

From this directory:

```bash
cd docs/entity-caching/pre-release-testing
make setup
make test
```

`make test` composes the bundled graph, starts Redis, starts a tiny Bun/TypeScript products subgraph with GraphQL Yoga, builds and starts the router from source, sends the same product query twice, and verifies the second request does not hit the products subgraph root resolver again. It then restarts the router and sends the query once more to verify Redis-backed L2 serves the cached response after the router's in-memory L1 cache is gone.

Then open the router playground and Cache Explorer:

```text
http://localhost:3002/
```

The bundled example is fully runnable. After you try it, replace the example SDL/routing URLs with your own subgraphs.

## Add Your Own Subgraphs

The kit composes subgraph SDL from [example/graph.yaml](example/graph.yaml). Start by replacing or extending the bundled `products` subgraph entry:

```yaml
version: 1
subgraphs:
  - name: products
    routing_url: http://products:4001/graphql
    schema:
      file: ./subgraphs/products/schema.graphqls
```

For each subgraph you want to test:

1. Put the subgraph SDL under `example/subgraphs/<subgraph-name>/schema.graphqls`.
2. Add a matching entry to `example/graph.yaml`.
3. Set `routing_url` to the URL the router container can call.
4. Add cache directives to your SDL.
5. Run `make compose`.
6. Run `make check-config`.
7. Run `make up`.

Use Docker-internal hostnames when your subgraphs run inside this Compose project. The bundled `products` subgraph uses `http://products:4001/graphql` because the Compose service is named `products`.

Use `host.docker.internal` when your subgraphs run on your host and the router runs in Docker:

```yaml
version: 1
subgraphs:
  - name: accounts
    routing_url: http://host.docker.internal:4101/graphql
    schema:
      file: ./subgraphs/accounts/schema.graphqls
  - name: products
    routing_url: http://host.docker.internal:4102/graphql
    schema:
      file: ./subgraphs/products/schema.graphqls
```

On Linux, the Docker Compose file already maps `host.docker.internal` to the host gateway.

Keep the cache directive definitions in each subgraph SDL that uses them. Composition reads the SDL files directly, and your subgraph server must also accept those directives at runtime. If your GraphQL server rejects unknown directives, register the directive definitions or configure the server to ignore them.

The bundled Bun server in [example/subgraphs/products/server.ts](example/subgraphs/products/server.ts) loads the same [example/subgraphs/products/schema.graphqls](example/subgraphs/products/schema.graphqls) file used by local composition. It adds only the minimal federation helper types (`_service`, `_entities`, `_Any`, `_Entity`) around that SDL file.

## Configure Caching In SDL

Add these directive definitions to any subgraph SDL that uses entity caching:

```graphql
directive @openfed__entityCache(
  maxAge: Int!
  negativeCacheTTL: Int = 0
  includeHeaders: Boolean = false
  partialCacheLoad: Boolean = false
  shadowMode: Boolean = false
) on OBJECT

directive @openfed__queryCache(
  maxAge: Int!
  includeHeaders: Boolean = false
  shadowMode: Boolean = false
) on FIELD_DEFINITION

directive @openfed__is(fields: String!) on ARGUMENT_DEFINITION

directive @openfed__cacheInvalidate on FIELD_DEFINITION

directive @openfed__cachePopulate(maxAge: Int) on FIELD_DEFINITION

directive @openfed__requestScoped(key: String!) on FIELD_DEFINITION
```

Available directives:

| Directive                   | Location                                | Purpose                                                                               |
| --------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------- |
| `@openfed__entityCache`     | Object type                             | Marks an entity type as cacheable by `@key`.                                          |
| `@openfed__queryCache`      | Root `Query` field                      | Caches a root query that returns a cacheable entity or list of entities.              |
| `@openfed__is`              | Query argument                          | Maps a query argument to an entity `@key` field when names do not match.              |
| `@openfed__cacheInvalidate` | Root `Mutation` or `Subscription` field | Evicts the returned cacheable entity from L2 after the field resolves.                |
| `@openfed__cachePopulate`   | Root `Mutation` or `Subscription` field | Writes the returned cacheable entity to L2 after the field resolves.                  |
| `@openfed__requestScoped`   | Field definition                        | Deduplicates fields that resolve to the same request-scoped value within one request. |

### `@openfed__entityCache`

Use this on entity object types that have at least one federation `@key`.

```graphql
type Product @key(fields: "id") @openfed__entityCache(maxAge: 120, partialCacheLoad: true) {
  id: ID!
  name: String!
}
```

Arguments:

| Argument           | Required | Default | Use it for                                                                                                       |
| ------------------ | -------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `maxAge`           | yes      | none    | Entity TTL in seconds. Must be greater than zero.                                                                |
| `negativeCacheTTL` | no       | `0`     | Cache null entity results for a short time. Use this to avoid repeated lookups for missing entities.             |
| `includeHeaders`   | no       | `false` | Include forwarded request headers in the cache key. Use this for tenant-, auth-, or locale-specific entity data. |
| `partialCacheLoad` | no       | `false` | For batch entity fetches, fetch only missing entities instead of refetching the full batch after one miss.       |
| `shadowMode`       | no       | `false` | Read and write cache metadata without serving cached data. Use this before turning cache serving on.             |

### `@openfed__queryCache`

Use this on root `Query` fields that return an entity or a list of entities. The returned entity type must also have `@openfed__entityCache`.

```graphql
type Query {
  product(id: ID!): Product @openfed__queryCache(maxAge: 120)
  products(ids: [ID!]! @openfed__is(fields: "id")): [Product!]! @openfed__queryCache(maxAge: 120)
}
```

Arguments:

| Argument         | Required | Default | Use it for                                                               |
| ---------------- | -------- | ------- | ------------------------------------------------------------------------ |
| `maxAge`         | yes      | none    | Root query result TTL in seconds. Must be greater than zero.             |
| `includeHeaders` | no       | `false` | Include forwarded request headers in the cache key for this query field. |
| `shadowMode`     | no       | `false` | Exercise reads and writes without serving cached data.                   |

When a query argument has the same name as a key field, composition maps it automatically:

```graphql
type Product @key(fields: "id") @openfed__entityCache(maxAge: 120) {
  id: ID!
  name: String!
}

type Query {
  product(id: ID!): Product @openfed__queryCache(maxAge: 120)
}
```

When the argument name differs from the key field, add `@openfed__is` to the argument:

```graphql
type Product @key(fields: "sku") @openfed__entityCache(maxAge: 120) {
  sku: String!
  name: String!
}

type Query {
  productBySku(productSku: String! @openfed__is(fields: "sku")): Product @openfed__queryCache(maxAge: 120)
}
```

For composite or nested keys, map the argument to the same field set shape used by `@key`:

```graphql
type Warehouse @key(fields: "location { id }") @openfed__entityCache(maxAge: 120) {
  location: Location!
  name: String!
}

type Query {
  warehouse(input: WarehouseInput! @openfed__is(fields: "location { id }")): Warehouse @openfed__queryCache(maxAge: 120)
}
```

### `@openfed__cacheInvalidate`

Use this on root `Mutation` or `Subscription` fields that return a cacheable entity. After the field resolves, the router evicts the returned entity from L2.

```graphql
type Mutation {
  updateProduct(id: ID!, name: String!): Product @openfed__cacheInvalidate
}

type Subscription {
  productDeleted: Product @openfed__cacheInvalidate
}
```

### `@openfed__cachePopulate`

Use this on root `Mutation` or `Subscription` fields that return a cacheable entity. After the field resolves, the router writes the returned entity to L2.

```graphql
type Mutation {
  upsertProduct(id: ID!, name: String!): Product @openfed__cachePopulate(maxAge: 60)
}

type Subscription {
  productChanged: Product @openfed__cachePopulate
}
```

`maxAge` is optional. When you omit it, the router uses the TTL from the returned entity type's `@openfed__entityCache`.

Do not put both `@openfed__cacheInvalidate` and `@openfed__cachePopulate` on the same field.

### `@openfed__requestScoped`

Use this on two or more fields in the same subgraph that resolve to the same value within a single request. This is a per-request L1 cache only; it does not write to Redis and it does not survive across requests.

```graphql
type Query {
  currentViewer: Viewer @openfed__requestScoped(key: "currentViewer")
}

type Personalized @key(fields: "id") @interfaceObject {
  id: ID!
  currentViewer: Viewer @inaccessible @openfed__requestScoped(key: "currentViewer")
}
```

Fields with the same `key` share one request-local cache entry scoped to the subgraph. The first field that resolves populates the entry, and later fields with the same key can reuse it.

Use it for values like current viewer, current tenant, locale, feature flags, or other data that is identical throughout one request. Do not use it for values that depend on the parent entity; use entity caching for that.

### Minimal Cacheable Entity Example

```graphql
extend schema @link(url: "https://specs.apollo.dev/federation/v2.5", import: ["@key"])

directive @openfed__entityCache(
  maxAge: Int!
  negativeCacheTTL: Int = 0
  includeHeaders: Boolean = false
  partialCacheLoad: Boolean = false
  shadowMode: Boolean = false
) on OBJECT

directive @openfed__queryCache(
  maxAge: Int!
  includeHeaders: Boolean = false
  shadowMode: Boolean = false
) on FIELD_DEFINITION
directive @openfed__is(fields: String!) on ARGUMENT_DEFINITION
directive @openfed__cacheInvalidate on FIELD_DEFINITION
directive @openfed__cachePopulate(maxAge: Int) on FIELD_DEFINITION
directive @openfed__requestScoped(key: String!) on FIELD_DEFINITION

type Query {
  product(id: ID!): Product @openfed__queryCache(maxAge: 120)
  productBySku(productSku: String! @openfed__is(fields: "sku")): Product @openfed__queryCache(maxAge: 120)
}

type Mutation {
  updateProduct(id: ID!, name: String!): Product @openfed__cacheInvalidate
  upsertProduct(id: ID!, sku: String!, name: String!): Product @openfed__cachePopulate(maxAge: 60)
}

type Product @key(fields: "id") @key(fields: "sku") @openfed__entityCache(maxAge: 120) {
  id: ID!
  sku: String!
  name: String!
}
```

## Make Targets

```bash
make help          # show targets
make setup         # enable Corepack and install repo dependencies
make build-cli-deps # build local workspace packages required by wgc router compose
make subgraph-deps # install Bun dependencies for the bundled example subgraph
make compose       # compose example/graph.yaml into generated/config.json
make check-config  # verify the generated router config contains cache metadata
make up            # compose, then build and run router + Redis
make up-detached   # same as up, but in the background
make test          # run the self-contained smoke test
make logs          # follow router logs
make down          # stop router + Redis
make clean         # remove generated config
```

`make compose` uses the local CLI from this checkout:

```bash
cd ../../../cli
pnpm tsx src/index.ts router compose \
  -i docs/entity-caching/pre-release-testing/example/graph.yaml \
  -o docs/entity-caching/pre-release-testing/generated/config.json
```

Do not use a released `wgc` binary for this pre-release test.

## Router + Redis + Bun Subgraph

[docker-compose.yml](docker-compose.yml) builds the router from source and starts Redis plus the bundled products subgraph:

```bash
make up
```

The router uses [config/router.redis.yaml](config/router.redis.yaml):

- `execution_config.file.path` points at `/etc/cosmo/config.json`.
- L1 is enabled.
- L2 is enabled and backed by Redis at `redis://redis:6379/0`.
- The playground is enabled at `/`.
- `dev_mode: true` enables local testing headers and playground workflows.

The router container mounts:

```text
generated/config.json -> /etc/cosmo/config.json
config/router.redis.yaml -> /etc/cosmo/router.yaml
```

The products subgraph is exposed on your host at:

```text
http://localhost:4011/graphql
http://localhost:4011/stats
```

## Try It

With the bundled subgraph:

```bash
make test
```

Open `http://localhost:3002/`, run a query that returns a cacheable entity, then run it again. Use the Cache Explorer to compare cold-cache and warm-cache behavior.

Example query shape:

```graphql
query Product {
  product(id: "p1") {
    id
    sku
    name
  }
}
```

After you replace the bundled subgraph with your own services:

```bash
make compose
make up
```

Useful request headers for comparison:

```text
X-WG-Disable-Entity-Cache: true     # disable L1 and L2
X-WG-Disable-Entity-Cache-L1: true  # disable L1 only
X-WG-Disable-Entity-Cache-L2: true  # disable L2 only
X-WG-Cache-Key-Prefix: test-run-1   # isolate test runs
```

Suggested checks:

- Run the same query twice; the second request should hit cache or skip subgraph loads where the plan allows it.
- Restart the router with `make down && make up`; Redis-backed L2 entries should remain until TTL expiry.
- Add `includeHeaders: true` to a cache directive and forward `Authorization`; two different tokens should use separate cache entries.
- Warm an entity, run a mutation with `@openfed__cacheInvalidate`, then query again; the post-mutation read should fetch fresh data.
- Run a mutation with `@openfed__cachePopulate`, then read the returned entity by key; the read should be cache-served when L2 is enabled.
- Use `shadowMode: true` to exercise cache reads/writes while still serving subgraph results.

GitHub Actions builds pull request workflows from the PR merge ref, and the PR image tag is:

```text
ghcr.io/wundergraph/cosmo/router:pr-2777
```

This kit defaults to building the router from source via Docker Compose because it keeps the test self-contained.

## Why Local Composition

For this pre-release test, avoid this path:

```text
publish SDL with cache directives -> hosted control plane composes -> router polls CDN
```

Until WunderGraph confirms that your control plane has the PR #2777 composition version, that path can fail validation, strip cache metadata, or generate a router config without the cache fields.

Use this path instead:

```text
your SDL files -> local PR #2777 composition -> generated/config.json -> source-built router + Redis
```

## Troubleshooting

### `make check-config` says no cache metadata was found

Check that your SDL includes cache directives and that you ran `make compose` from this PR checkout. The generated config should contain `entityCacheConfigurations`, `rootFieldCacheConfigurations`, `cachePopulateConfigurations`, `cacheInvalidateConfigurations`, or `requestScopedFields`.

### Root query caching does not hit

The return type must be an entity with `@key` and `@openfed__entityCache`. If the query argument name does not match the entity key field, add `@openfed__is(fields: "...")` to the argument.

### The router cannot reach your subgraphs

Use routing URLs that are valid from inside the router container. For host-running subgraphs, use `host.docker.internal`.

### Header-varying cache entries collide

Confirm `includeHeaders: true` is on the relevant directive and the router YAML forwards the header to that subgraph.
