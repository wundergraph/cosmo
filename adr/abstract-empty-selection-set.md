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

Alternative federation implementations both accept the same supergraph and the same query and return HTTP 200.
They resolve a union field from the subgraph or subgraphs that own the current path.
For value-type union members, a sibling subgraph's member is absent; it is not gathered from that sibling.
Gather-all behavior for value-type members is a separate, unimplemented federation feature request.
Entity-member unions remain different: if a member has a usable `@key`, it can still be gathered through `_entities`.

When a `@shareable` path is resolvable from multiple candidate subgraphs, only the intersection of their union members is guaranteed.
The selected hop-free subgraph's own non-shared members are kept structurally, but their leaf fields are response-only nulls because those leaves are not safe to request under the multi-candidate path.
Foreign members that belong only to a sibling subgraph are dropped from the result.

This is the parity target for Cosmo: HTTP 200, no empty upstream selection set, and source-subgraph/intersection semantics rather than sibling gathering for value-type members.

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

```text
printOperation planner id: N: validation failed:
internal: astvalidation selection set on path query.node.results is empty
```

### Expected

HTTP 200 with the intersection result shape:

```json
{
  "data": {
    "node": {
      "results": [
        { "__typename": "Article", "title": "Hello" },
        { "__typename": "Image", "url": null }
      ]
    }
  }
}
```

`Video` is absent because it is a foreign value-type member that only subgraph B can produce and is not gathered from the sibling subgraph.
`Image.url` is a response-only null because `Image` is subgraph A's own non-shared member under a multi-candidate `@shareable` path.

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

The implemented strategy is the canonical source-subgraph/intersection pass in `v2/pkg/engine/plan/abstract_selection_partial_union.go`.
For a multi-candidate non-entity union field, the planner resolves the field from the source subgraph that owns the current path and keeps only the member set that is guaranteed by the candidate intersection.
Foreign value-type members that only a sibling subgraph can produce are dropped instead of gathered.
The resolving subgraph's own non-shared members are kept structurally so the response shape remains coherent, but their leaf fields become response-only nulls.
Those leaf fields are excluded from the upstream fetch through a datasource `allowField` guard, preventing the planner from emitting an empty or invalid upstream selection set.

The pass is gated to non-entity unions.
Entity-member unions are not changed, because members with usable `@key` fields can still be gathered through `_entities`.

An earlier gather approach was implemented and then replaced after review because it returned foreign subgraph members for value-type unions, which could produce silently wrong data.
The corrected behavior is source-subgraph/intersection semantics: absent foreign value-type members are not gathered.

This ADR describes the strategy and the code areas only; it deliberately does not prescribe diffs or line-level edits.

## Test & verification plan

Planner unit tests (graphql-go-tools `v2/pkg/engine/plan`).
Add planner coverage for the split-union shape above (union members partitioned across two `@shareable` datasources, `node` rooted only in A).
Assert the source-subgraph/intersection behavior: `Article` is selected from the guaranteed intersection, `Image` is kept structurally from subgraph A with response-only null leaves where required, `Video` is absent as a foreign value-type member, and no fetch is emitted with an empty selection set.

End-to-end router test (`router-tests`).
`TestPartialUnionIntersectionOnShareableField` wires the two subgraphs and the query above.
Assert HTTP 200, one upstream fetch, no sibling gather, and the exact JSON response body shown under "Expected".

Celestial plan-snapshot no-regression.
Run the celestial plan-snapshot suite and require a plan-diff of zero across all real federated graphs and operations.
The verified result for this change is 0-diff.

Federation audit suite.
The discriminating gate is the federation-gateway-audit `partial-union-complex` suite.
It now passes 5/5, after the earlier gather approach only passed 1/5.

## Consequences / risks

The change is confined to the planner: datasource selection (`datasource_filter_visitor.go`) and the abstract-selection rewriter (`abstract_selection_rewriter.go` plus its helpers), with the existing `ValidateEmptySelectionSets()` guard retained as a backstop.
The regression surface is all abstract-type planning, because the rewriter and datasource-selection code is shared by both unions and interfaces.

The main risk vectors are bounded as follows.
The source-subgraph/intersection pass is gated to non-entity unions, so entity-member union gathering remains unchanged.
Over-eager pruning — dropping a member that belongs to the resolving source subgraph or to the guaranteed candidate intersection — is caught by the full-plan unit assertions and by the end-to-end body assertion.
The same empty-selection collapse can in principle occur for interfaces partially implemented across subgraphs; the rewriter-side "unresolvable" signal should be shaped to cover the interface path as well, and the audit suite plus the celestial sweep guard against an interface-shaped regression.
