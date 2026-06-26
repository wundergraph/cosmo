---
title: "Abstract-typed field across partial union membership yields an empty selection set"
author: Jens Neuse
---

## Status

Proposed

## Context

A federated graph can declare a union whose members are split across subgraphs.
One subgraph contributes some members, another subgraph contributes others, and the composed supergraph union is the set of all members across the graph.
When a `@shareable` field returns such a union, the same field is resolvable from more than one subgraph, and each subgraph only knows its own local subset of the union's members.

A client query that selects members from several subgraphs at once (one inline fragment per concrete member) exercises this shape.
On Cosmo this query is rejected during query planning and the router returns HTTP 500, even though the supergraph composes cleanly and execution is never reached.

The defect is owned entirely by the query-planning stage inside graphql-go-tools (the planner the router vendors), specifically the datasource-selection pass and the abstract-selection rewriter.
Composition is innocent: the supergraph SDL and the router engine config are correct, and each datasource records its partial union membership accurately.
The execution stage (`pkg/engine/resolve`) is never entered, because planning aborts while building an upstream `_entities` fetch whose selection set has collapsed to empty.

The observed wrong behavior is therefore a plan-time HTTP 500 (a hard failure), not silently-wrong data and not a compose-time rejection.

## Reference behavior

alternative federation implementations both accept the same supergraph and the same query and return HTTP 200.
They plan the union by intersecting the requested members with each subgraph's local union membership, and they dispatch a fetch to a subgraph only for the members that subgraph can actually resolve.
A member is resolved from a subgraph that defines it, and a non-empty member subset is sent to each subgraph, so no empty upstream selection set is ever produced.
A member that no chosen datasource can resolve under the final plan is returned as a `null`/absent entry rather than failing the plan.

The correct result for the reproduction below is a heterogeneous `results` array containing every requested member, each resolved from a subgraph that defines it.
This is the parity target for Cosmo: HTTP 200 with all members present.

## Reproduction (neutral)

### Subgraphs

Subgraph A (`media-a`) — owns the `node` entry point, and locally knows the union members `Article` and `Image`:

```graphql
type Query {
  node(id: ID!): Node
}

type Node @key(fields: "id") {
  id: ID!
  results: [SearchResult!]! @shareable
}

union SearchResult = Article | Image

type Article {
  id: ID! @shareable
  title: String! @shareable
}

type Image {
  id: ID!
  url: String!
}
```

Subgraph B (`media-b`) — has no root entry point of its own, and locally knows the union members `Article` and `Video`:

```graphql
type Query {
  _noop: Boolean
}

type Node @key(fields: "id") {
  id: ID!
  results: [SearchResult!]! @shareable
}

union SearchResult = Article | Video

type Article {
  id: ID! @shareable
  title: String! @shareable
}

type Video {
  id: ID!
  duration: Int!
}
```

In the composed supergraph the union is `SearchResult = Article | Image | Video`.
`Node.results` is `@shareable` in both subgraphs, so the planner may resolve it from either A or B.
`Image` is resolvable only from A, `Video` only from B, and `Article` from either.

### Query

```graphql
query {
  node(id: "1") {
    results {
      __typename
      ... on Article { title }
      ... on Image { url }
      ... on Video { duration }
    }
  }
}
```

### Observed (Cosmo)

HTTP 500, `internal server error`.
The captured planner error is:

```
printOperation planner id: N: validation failed:
internal: astvalidation selection set on path query.node.results is empty
```

### Expected

HTTP 200 with the full result shape (matching alternative federation implementations):

```json
{
  "data": {
    "node": {
      "results": [
        { "__typename": "Article", "title": "Hello" },
        { "__typename": "Image", "url": "https://cdn.example/i1.png" },
        { "__typename": "Video", "duration": 120 }
      ]
    }
  }
}
```

`Article` and `Image` are resolved from subgraph A, `Video` from subgraph B.

## Root cause

The defect lives in the planner (graphql-go-tools, module `v2`), and has no composition component.

The composed config is correct: each datasource truthfully records its local union membership (A: `Article | Image`, B: `Article | Video`), and the supergraph records the full union (`Article | Image | Video`).
There is nothing for composition to fix.

The planner failure has two interacting parts.

1. Per-datasource pruning collapses a member-specific selection to empty.
   `getAllowedUnionMemberTypeNames` in `v2/pkg/engine/plan/abstract_selection_rewriter_helpers.go` computes the allowed members from `r.upstreamDefinition` — the local, per-datasource upstream schema — via `r.upstreamDefinition.UnionTypeDefinitionMemberTypeNames(unionNode.Ref)`.
   For an `_entities` fetch into subgraph B this returns only `{Article, Video}`, the local subset, not the composed supergraph union.
   `rewriteUnionSelection` in `v2/pkg/engine/plan/abstract_selection_rewriter.go` then calls `flattenFragmentOnUnion`, which drops every object inline fragment whose type name is not in that allowed set.
   When a fetch into a datasource carries only member fragments that the datasource does not define locally (for example an `Image`-only selection routed into B), every fragment is pruned and the selection set collapses to a bare `__typename` (see `replaceFieldSelections`, which appends a lone `__typename` when no member selections remain) or to nothing on the nested path.

2. Datasource selection scatters the abstract field's members across datasources that cannot resolve them.
   Because `Node.results` is `@shareable`, the field appears as duplicate candidate nodes (one per datasource) in the planner's datasource-filter graph.
   `selectDuplicateNodes` in `v2/pkg/engine/plan/datasource_filter_visitor.go` (via `checkNodes`, which ranks candidates by their key-jump count using the `nodeJump` scoring) can commit member-specific branches into a datasource whose local union subset does not include those members.
   The planner does not consolidate the abstract field onto a single datasource, nor does it treat a fully-pruned selection as a signal that a datasource cannot resolve the field for the requested members.

When the scattered, fully-pruned fetch reaches serialization, `Planner.printOperation` in `v2/pkg/engine/datasource/graphql_datasource/graphql_datasource.go` runs `astvalidation` with `ValidateEmptySelectionSets()` registered.
That rule (`v2/pkg/astvalidation/operation_rule_validate_empty_selection_set.go`) raises `astvalidation selection set on path %s is empty`, which `printOperation` wraps as `validation failed: ...` and reports via `stopWithError`, aborting the whole plan.
The router surfaces the aborted plan as HTTP 500.

The core defect: per-datasource union-member pruning is correct, but the planner neither consolidates an abstract field onto a datasource that can satisfy it nor recognizes a fully-pruned selection set as "this datasource cannot resolve this field for these members."
Instead it emits an unvalidatable upstream operation and fails the entire operation.

## Decision

The fix is planning-only.
Composition is unchanged: it already records partial union membership correctly, so no composition area is touched.

The planner work has three parts, in the graphql-go-tools `v2` module.

1. Consolidate the abstract field onto its closest datasource (primary fix).
   Add a datasource-selection pass in `v2/pkg/engine/plan/datasource_filter_visitor.go` (a `selectClosestDatasourceForAbstractFields`-style pass that runs alongside `selectDuplicateNodes`): for a field whose return type is abstract and which has more than one selected datasource, keep the datasource that is closest by the existing key-jump score (reuse the `nodeJump.jumpCount` ranking already computed in `checkNodes`) and unselect the losing branch together with any now-empty ancestors.
   This stops member fragments from being scattered into a datasource whose local union subset would prune them all, so no empty `_entities` selection is built.
   By itself this pass is byte-identical on every plan that already resolves today, because for already-working shapes there is a single natural closest datasource.

2. Broaden to recover members only available elsewhere (strict fallback).
   Consolidating onto the closest single datasource can leave out a member that only a sibling datasource defines (in the reproduction, `Video` lives only in B while the closest datasource is A).
   To reach alternative implementations parity, when the consolidated datasource's local union membership does not cover every requested member, gather the missing members from a sibling datasource that does define them.
   This broadening is governed by two hard design constraints:
   - It MUST be gated as a strict fallback that activates only in the genuinely-split case (the primary single-datasource plan cannot cover all requested members), so that celestial plan output is unchanged for every graph and operation that already plans successfully.
   - Gather depth MUST be bounded to a single key-jump hop, to prevent unbounded entity-jump fan-out when recovering the missing members.

3. Treat empty pruning as "unresolvable", and keep the validator as a safety net.
   In the abstract-selection rewriter (`rewriteUnionSelection` / `flattenFragmentOnUnion` in `v2/pkg/engine/plan/abstract_selection_rewriter.go`), a union selection that prunes to empty (zero member fragments, or `__typename`-only) should be surfaced as a typed "this datasource cannot resolve this field for these members" outcome rather than silently producing an empty set.
   The `ValidateEmptySelectionSets()` guard in `printOperation` stays in place as belt-and-suspenders: once parts 1 and 2 land it should never fire on the happy path, and if it ever does it must fail planning of that one fetch (allowing datasource selection to move on) rather than aborting the entire operation.

The intersection that drives all of this is `requestedMembers ∩ localUpstreamUnionMembers`.
If that intersection carries no selected fields for a datasource, the field is unresolvable by that datasource and selection must move on (or broaden under the gated fallback).

This ADR describes the strategy and the code areas only; it deliberately does not prescribe diffs or line-level edits.

## Test & verification plan

Planner unit tests (graphql-go-tools `v2/pkg/engine/plan`).
Add a planner test for the split-union shape above (union members partitioned across two `@shareable` datasources, `node` rooted only in A).
Assert the full produced plan structure — exact fetch list and exact per-fetch selection sets — not a substring: the `Image` member is fetched only from datasource A, the `Video` member only from datasource B, `Article` from the consolidated closest datasource, and no fetch is emitted with an empty selection set.
Add a companion negative test asserting that a datasource whose local subset would prune to empty is never the committed datasource for the member.

End-to-end router test (`router-tests`).
Add a federation test wiring the two subgraphs and the query above.
Assert HTTP 200 and the exact JSON response body with a full-value equality assertion, including the heterogeneous `results` array with the `Article`, `Image`, and `Video` entries in the shape shown under "Expected".

Celestial plan-snapshot no-regression.
Run the celestial plan-snapshot suite and require a plan-diff of zero across all real federated graphs and operations: every already-working plan must be byte-identical.
The strict-fallback gating in Decision part 2 exists precisely to hold this invariant; any non-zero diff must be limited to previously-failing partial-union shapes that now plan successfully.

Federation audit suite.
The federation-gateway-audit suite that exercises a union whose members are partitioned across subgraphs (the `union-intersection` test case) should flip from failing to passing, with no regressions in the rest of the audit suite.

## Consequences / risks

The change is confined to the planner: datasource selection (`datasource_filter_visitor.go`) and the abstract-selection rewriter (`abstract_selection_rewriter.go` plus its helpers), with the existing `ValidateEmptySelectionSets()` guard retained as a backstop.
The regression surface is all abstract-type planning, because the rewriter and datasource-selection code is shared by both unions and interfaces.

The main risk vectors are bounded as follows.
The closest-datasource consolidation in Decision part 1 is shaped to be a no-op on already-working plans, and the broadening in Decision part 2 is gated as a strict fallback and bounded to a single key-jump hop, so the celestial zero-diff requirement caps unintended plan churn.
Over-eager pruning — marking a field unresolvable when a non-empty member subset was in fact valid — is caught by the full-plan unit assertions and by the end-to-end body assertion, both of which fail if any legitimate member fragment is dropped.
The same empty-selection collapse can in principle occur for interfaces partially implemented across subgraphs; the rewriter-side "unresolvable" signal should be shaped to cover the interface path as well, and the audit suite plus the celestial sweep guard against an interface-shaped regression.
