---
title: "Multi-hop compound @key satisfaction (gather a missing key member from a third subgraph)"
author: Jens Neuse
---

## Status

Proposed

## Context

This concerns federated graphs where a field is only reachable through a *multi-hop entity route*:
the target subgraph that owns the field is entered through a compound `@key`,
but one member of that compound key is not present at the entry point and must first be gathered from a third subgraph.

Concretely, an entry subgraph returns an object keyed by a small key (e.g. `id`),
the subgraph that owns the requested fields requires a larger compound key (e.g. `id` plus `pid`),
and the missing member (`pid`) is only resolvable by making an intermediate entity call into yet another subgraph.
The correct plan is therefore a two-stage entity hop:
a per-member entity fetch that gathers the missing member,
feeding a compound-key entity fetch that finally reads the requested fields.

The observed wrong behavior is that Cosmo rejects this graph at compose time.
Composition declares the requested fields *unresolvable* and the supergraph never composes,
so the query can never run.
When the graph is forced past composition (or when the analogous limitation is exercised directly in the planner),
the planner cannot select a datasource for the requested fields and the operation fails with
`could not select the datasource to resolve <Type>.<field>`.

The bug spans two pipeline stages and both stages own a piece of it:
the *composition* resolvability analysis never synthesizes the multi-hop route,
and the *query planner* entity route-finder cannot build the corresponding multi-hop entity fetch.
Either gap alone is sufficient to break the query;
both must be fixed for it to work end to end.

## Reference behavior

The same subgraphs and the same query are accepted and resolved by other federation implementations,
which establishes that the graph is valid and the query is answerable.

- an alternative composer composes the supergraph successfully.
- an alternative federation router resolves the query at runtime and returns the expected data.
- an alternative federation gateway resolves the query at runtime and returns data byte-identical to the an alternative federation router response.

Both reference gateways plan exactly the multi-hop route described above:
they enter the third subgraph per member to gather the missing key member,
fold that gathered member back into the entity representation,
then enter the owning subgraph through the now-complete compound key and read the requested fields.

The correct behavior for Cosmo is therefore:
compose the graph (the requested fields are resolvable),
plan the multi-stage entity-fetch sequence,
and return the same result shape the reference gateways return.

## Reproduction (neutral)

Four subgraphs.
The entity is `Product`, exposed inside a `ProductList` wrapper.
`ProductList` carries a compound `@key` over its members.

**`catalog` subgraph** (entry point)

```graphql
type Query {
  topProducts: ProductList!
}

type ProductList @key(fields: "products { id }") {
  products: [Product!]!
}

type Product @key(fields: "id") {
  id: ID!
}
```

**`collection` subgraph** (owns the requested fields)

```graphql
type ProductList @key(fields: "products { id pid }") {
  products: [Product!]!
  first: Product @shareable
  selected: Product @shareable
}

type Product @key(fields: "id pid") {
  id: ID!
  pid: ID!
}
```

**`link` subgraph** (supplies the missing key member `pid`)

```graphql
type Product @key(fields: "id") @key(fields: "id pid") {
  id: ID!
  pid: ID!
}
```

**`pricing` subgraph** (additional resolver that widens the key surface)

```graphql
type ProductList
  @key(fields: "products { id pid category { id tag } } selected { id }") {
  products: [Product!]!
  selected: Product @shareable
}

type Product @key(fields: "id pid") {
  id: ID!
  pid: ID!
  category: Category
}

type Category @key(fields: "id tag") {
  id: ID!
  tag: String!
}
```

**Query**

```graphql
query {
  topProducts {
    first { id }
    selected { id }
  }
}
```

**The intended route**

1. `catalog.topProducts` returns a `ProductList` keyed by `products { id }`.
2. `ProductList.first` / `ProductList.selected` live only on `collection`, which requires `@key(fields: "products { id pid }")`.
3. The entry only carries `products { id }`; the missing member is `products[].pid`.
4. `pid` is gatherable: `Product @key(fields: "id")` resolves on `link`, which exposes `pid`.
   So: enter `link` per product via `id`, read `pid`, satisfy `collection`'s compound `ProductList @key(fields: "products { id pid }")`, then read `first` / `selected`.

**Observed (current Cosmo)**

Composition fails: `ProductList.first` and `ProductList.selected` are reported unresolvable from `Query.topProducts`, and the supergraph never composes.
Exercised at the planner level, datasource selection fails with `could not select the datasource to resolve ProductList.selected`.

**Expected**

Composition succeeds, the planner builds the multi-stage entity fetch, and the response is the full shape below (no `null`s, no errors):

```json
{
  "data": {
    "topProducts": {
      "first": { "id": "1" },
      "selected": { "id": "2" }
    }
  }
}
```

The `id` values are seed-data dependent;
the load-bearing assertion is the complete response shape and the absence of errors,
matched byte-for-byte against the alternative federation implementations response for the same data.

## Root cause

The defect is the same idea expressed in the two halves of the pipeline:
neither half can satisfy a compound `@key` whose missing member must be gathered through a nested entity hop.

### Composition

File: `composition/src/resolvability-graph/graph.ts`, method `Graph.initializeNode`.

When `initializeNode` wires up the resolvability graph for an entity node,
it iterates `node.satisfiedFieldSets` and creates entity-jump edges (`node.entityEdges`)
only to sibling subgraphs whose `@key` field set is *already directly satisfiable* at that node
(looked up via `entityDataNode.targetSubgraphNamesByFieldSet`).
For `ProductList` arriving from `catalog`, the only satisfied field set is `products { id }`,
so the only edges built are the ones that key on `products { id }`.
The compound key required to enter `collection` (`products { id pid }`) is never in `satisfiedFieldSets`,
because `pid` is not present at the node.

The routine never asks the inverse question:
can the missing member (`products[].pid`) itself be gathered through another entity jump,
and if so, can that gathered field then complete the compound key?
There is no synthesis step that detects a compound `@key` unsatisfiable only because of a missing member,
checks whether that member is reachable through a nested entity hop (`Product @key(fields: "id")` on `link` exposing `pid`),
and adds the corresponding multi-hop edge.
Because that edge is never synthesized, `ProductList.first` / `ProductList.selected` have no inbound resolvable path and are declared unresolvable, and the graph fails to compose.

### Planner

File: `v2/pkg/engine/plan/source_connection_graph.go`, constructor `NewDataSourceJumpsGraph`.

The planner builds a data-source jump graph where a jump from a source datasource to a target datasource is recorded
only when the source key's selection set is *exactly equal* to the target key's selection set
(`keyInfo.SelectionSet != targetKeyInfo.SelectionSet` short-circuits the candidate).
A source key whose field set is a strict *subset* of the target's compound `@key` is rejected,
so there is no jump that gathers the missing member first and then enters the compound key.

The downstream consumers inherit the gap:
`node_selection_visitor.go` (`handleFieldsRequiredByKey`, `addPendingKeyRequirements`) build entity fetches from the `SourceConnection` paths returned by the jump graph's `GetPaths`,
and `datasource_filter_node_suggestions.go` / `node_selection_builder.go` place datasources from those suggestions.
With no subset-to-compound jump available, no multi-hop path exists,
so no datasource can be placed for `ProductList.first` / `selected`,
and `datasource_filter_resolvable_visitor.go` raises `could not select the datasource to resolve ProductList.selected`.

## Decision

Fix both stages so a compound `@key` can be satisfied by first gathering a missing member through a single nested entity hop.
Describe the strategy and the code areas only; no line-by-line edits.

### Composition area

In `composition/src/resolvability-graph/graph.ts`, extend the node-initialization and entity-edge construction so that key satisfaction is evaluated as a recursive selection-tree resolvability check rather than a flat membership test against `satisfiedFieldSets`.
A compound `@key` is satisfiable when each of its members is supplied by one of:
an already-satisfied field set,
a local non-external field,
or an entity sibling reachable through an already-satisfiable sub-key (a single nested gather hop).
When the only obstacle to a compound key is a member that is itself gatherable through such a hop,
synthesize the multi-hop entity edge so the dependent fields become resolvable and the graph composes.
The synthesis must be bounded to a single gather hop feeding one compound key, and routes must be de-duplicated.

### Planner area

In the `graphql-go-tools` jump-graph route-finder and fetch builder
(`source_connection_graph.go`, `node_selection_visitor.go`, `node_selection_builder.go`, `datasource_filter_node_suggestions.go`),
allow a jump to be recorded when the source key's field set is a *subset* of the target's compound `@key`,
using the target key's selection set for the jump so the missing member is gathered first.
Prune stale key/field dependencies for datasources that were de-selected, so that path creation for the gather-then-jump route is not blocked.
The planner re-synthesizes the route from the key sets;
no new supergraph metadata is required to carry it.

### Key design constraints

- **Strict-fallback gating (load-bearing).**
  The planner broadening (the subset-to-compound jump and the stale-dependency pruning) MUST be reachable *only after* normal, exact-key datasource selection has already failed for the field.
  This is the load-bearing safety property:
  the change cannot alter any plan the stock planner already produces, so the plan-snapshot sweep must show zero drift.
  An ungated version broadens edge creation for every compound-key graph and drifts unrelated plans;
  gating it as a strict fallback collapses that drift to nothing while still planning the target multi-hop case.
- **Single-hop depth bound.**
  Support exactly one nested gather hop (one gather feeding one compound key).
  Deeper chains (gathering a member that itself needs a gather) are out of scope and must not be synthesized.
- **No false positives.**
  The composition broadening only adds resolvable paths where a genuine gather route exists;
  a missing member that is genuinely not gatherable must still be reported unresolvable.
- **Determinism.**
  When more than one gather route exists for the same missing member, route selection must be deterministic across composition and planning runs.

## Test & verification plan

- **Composition unit test** (`composition/`):
  a fixture built from the four neutral subgraphs above asserting that the supergraph composes
  and that `ProductList.first` / `ProductList.selected` are resolvable.
  Assert the full emitted resolvability outcome / synthesized route as an exact value (full-value equality, not substring).
  Add a negative fixture where the missing member is not gatherable and assert it still reports unresolvable.
- **Planner unit test** (`graphql-go-tools`, `v2/pkg/engine/plan`):
  a `TestPlannerMultiHopCompoundKey`-style case asserting the generated plan for the reproduction query equals the expected multi-stage entity-fetch sequence as a full plan snapshot
  (root fetch on `catalog`, gather fetch on `link` keyed by `Product` `id` that adds `pid`, compound-key fetch on `collection` keyed by `products { id pid }` reading `first` / `selected`, plus the `pricing` fetch the reference route takes).
  Add `TestSourceConnectionGraph` coverage for the subset-key jump.
  The whole `pkg/engine/plan` package must stay green.
- **Router e2e test** (`router-tests`, via the `testenv` harness):
  run the four neutral subgraphs and the query against the router and assert the full response equals the reference JSON byte-for-byte (the exact shape shown in Reproduction).
- **Celestial plan-snapshot no-regression:**
  run the celestial plan-snapshot sweep over all real federated graphs and operations and require **0 plan diffs** versus the stock planner.
  This sweep is the gate that proves the strict-fallback gating holds:
  the target multi-hop operation must newly plan (the multi-stage route) while every previously-planned operation is byte-identical.
- **federation-gateway-audit:**
  the `complex-entity-call` scenario in the federation-gateway-audit (federation-compatibility) suite should flip from failing to passing,
  with no regressions in the remaining audit scenarios.

## Consequences / risks

The regression surface is broad because both changes touch core algorithms shared by every federated graph.
Synthesizing new resolvability edges changes the resolvability graph for every graph that has compound keys,
and broadening jump-edge creation changes planner route selection.

The risk is bounded by three properties:

- The planner change is gated as a strict fallback (only reachable after normal datasource selection fails),
  so it cannot change any plan the stock planner already produces;
  the celestial sweep enforces this at 0 diffs.
- The gather depth is bounded to a single nested hop, capping the combinatorial cost of route synthesis.
- The composition change only adds resolvable paths where a real gather route exists,
  and the negative fixture guards against turning genuinely-unresolvable graphs into false-positive "resolvable" claims.

The residual risks to watch are determinism when multiple gather routes exist for the same missing member,
and the interaction of the synthesized compound-key fetch with `@requires` / `@provides` and with list-typed key members,
both of which the unit and audit suites must cover before this is considered done.
