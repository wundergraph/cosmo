# Entity Caching Pre-Release Testing

Use this kit to test entity caching in your own graph with PR [#2777](https://github.com/wundergraph/cosmo/pull/2777), before the feature is available in the public control plane and the released router.

You will compose locally from this checkout and run a source-built router with Redis. This avoids hosted control-plane composition, which may not yet understand the new cache directives.

## Quick Start

From this directory:

```bash
cd docs/entity-caching/pre-release-testing
make setup
make compose
make up
```

Then open the router playground:

```text
http://localhost:3002/
```

The default example includes SDL only. It proves local composition and starts the router, but GraphQL operations need real subgraphs behind the `routing_url` values. Replace the example SDL/routing URLs with your subgraphs before using the playground or Cache Explorer for end-to-end validation.

## What To Edit

Edit [example/graph.yaml](example/graph.yaml) first:

```yaml
version: 1
subgraphs:
  - name: products
    routing_url: http://host.docker.internal:4011/graphql
    schema:
      file: ./subgraphs/products/schema.graphqls
```

Then edit or replace the SDL files under [example/subgraphs](example/subgraphs). Keep the cache directive definitions in any subgraph SDL that uses them.

Use `host.docker.internal` when your subgraphs run on your host and the router runs in Docker. On Linux, the Docker Compose file already adds `host.docker.internal:host-gateway`.

## Make Targets

```bash
make help          # show targets
make setup         # enable Corepack and install repo dependencies
make compose       # compose example/graph.yaml into generated/config.json
make check-config  # verify the generated router config contains cache metadata
make up            # compose, then build and run router + Redis
make up-detached   # same as up, but in the background
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

## Router + Redis

[docker-compose.yml](docker-compose.yml) builds the router from source and starts Redis:

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

## Try It

After your subgraphs are running and `example/graph.yaml` points at them:

```bash
make compose
make up
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

## Optional: Check Out PR #2777 Explicitly

If you are not already in a PR #2777 checkout, run:

```bash
./scripts/setup-pr.sh
```

That script clones Cosmo, fetches `pull/2777/merge`, checks it out, enables Corepack, and runs `pnpm install`.

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

## Files

```text
README.md
Makefile
docker-compose.yml
config/router.redis.yaml
example/graph.yaml
example/subgraphs/products/schema.graphqls
scripts/setup-pr.sh
scripts/compose.sh
scripts/check-config.sh
generated/.gitignore
```

## Source References

- PR image tags are produced by the router PR workflow and build-push action: `../../../.github/workflows/router-ci.yaml:450`, `../../../.github/actions/build-push-image/action.yaml:55`, `../../../.github/actions/build-push-image/action.yaml:61`.
- Local composition command: `../../../cli/src/commands/router/commands/compose.ts:167`, `../../../cli/src/commands/router/commands/compose.ts:190`, `../../../cli/src/commands/router/commands/compose.ts:200`, `../../../cli/src/commands/router/commands/compose.ts:271`.
- Router YAML schema for entity caching: `../../../router/pkg/config/config.go:1046`.
- Per-request cache-control headers: `../../../router/core/graphql_handler.go:588`, `../../../router/core/graphql_handler.go:594`.
