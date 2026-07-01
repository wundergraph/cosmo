# Create a Graph on Cosmo Cloud and Publish the Demo Subgraphs

Steps to create a federated graph on Cosmo Cloud and push the demo subgraph
schemas (employees, availability, etc.) in order. Follows the publish flow in
[`README.md`](./README.md).

The commands below use **absolute** schema paths, so they work from any
directory. Set the demo root once:

```bash
export DEMO=/Users/milindadias/Work/cosmo/demo
```

## 0. Prerequisites (once)

```bash
# Authenticate wgc against your Cosmo Cloud org (opens browser)
wgc auth login
```

## 1. Create and select a namespace

A namespace isolates this graph and its subgraphs from everything else in the
org. Create a dedicated one and use it for every command below.

```bash
# Name of the namespace to use throughout these steps
export NS=entity-caching

# Create it (skip if it already exists)
wgc namespace create $NS
```

Useful namespace commands:

```bash
wgc namespace list            # see existing namespaces
wgc namespace delete $NS      # remove it (also removes graphs/subgraphs in it)
```

Because every command below passes `--namespace $NS`, all resources land in this
namespace.

## 2. Create the federated graph

`--routing-url` is where **your router** will serve (adjust to your router's
address). The label matcher binds subgraphs to this graph.

```bash
wgc federated-graph create entitycachegraph \
  --namespace $NS \
  --routing-url http://localhost:3002/graphql \
  --label-matcher "team=demo"
```

## 3. Publish the demo subgraphs in order

`wgc subgraph publish` creates the subgraph on first publish when you pass
`--routing-url` and `--label` — so this both registers and pushes the schema.
`employees` is the base entity graph, so publish it first; the rest extend the
`Employee` entity.

Note: You will get errors when running the commands 1 by 1 below as the earlier publish command subgraphs have dependencies on later subgraphs

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

## 4. Verify composition

```bash
# Show the graph and its composition status
wgc federated-graph list --namespace $NS

# Pull the composed schema — fails if composition is broken
wgc federated-graph fetch entitycachegraph --namespace $NS

# List the published subgraphs
wgc subgraph list --namespace $NS
```

## 5. Connect the router

The router authenticates to Cosmo Cloud with a **graph API token** and pulls the
composed config automatically — no local execution config needed.

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

Create `config.yaml`. There is **no** `execution_config.file` block — with
`GRAPH_API_TOKEN` set, the router polls Cosmo Cloud for the composed config.

```yaml
version: "1"

listen_addr: "localhost:3002"   # matches the graph's --routing-url

# Entity caching (README Step 3). L1-only here; add the Redis L2 block for
# multi-replica deployments.
storage_providers:
  memory:
    - id: "default"
      max_size: "100MB"

entity_caching:
  enabled: true
  l1:
    enabled: true
  l2:
    enabled: false
```

### 5c. Run the router

The router authenticates with the token, pulls the composed config for
`entitycachegraph`, and serves it at `http://localhost:3002/graphql`.

- **Subgraphs must be reachable** from wherever the router runs. The graph points
  at `localhost:4001–4009`, so run the router on the same host (or `--network
  host` on Linux) and start the demo subgraphs (`demo/run_subgraphs.sh`).
- For the shared **L2/Redis** cache, replace the memory provider with the `l2` +
  `storage_providers.redis` block from README Step 3.

## Notes

- **Labels must match.** The `--label "team=demo"` on each subgraph must satisfy
  the graph's `--label-matcher "team=demo"`, or the subgraph won't be included in
  composition.
- **Routing URLs** are taken from `demo/graph.yaml`. If your subgraphs run
  elsewhere, swap in the reachable URLs.
- Not included: `test1`, `cachegraph`, `employeeupdated`, `employee-events`, and
  the `products_fg` feature graph (`myff` feature flag). Add them the same way if
  needed.
- Entity-caching directives (README Step 1) only take effect once you add them to
  the SDL and republish. Publishing the schemas as-is composes them without
  caching — a good baseline to confirm the graph works first.
