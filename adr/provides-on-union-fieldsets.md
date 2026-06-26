---
title: "@provides field sets over union-typed fields"
author: Jens Neuse
---

## Status

Proposed.

## Context

`@provides` lets a subgraph declare that, when it resolves a particular field, it can also supply some otherwise-`@external` child fields inline,
so the router can skip a follow-up entity fetch for those children.
The field set passed to `@provides` is a GraphQL selection set rooted at the annotated field's return type.

When that return type is a union, the only legal way to select into it is through inline fragments on the union's members,
for example `... on Book { title }`.
This is the canonical, spec-blessed shape for selecting through an abstract type.

Cosmo composition (`wgc compose`) rejects this construct.
Given a `@provides` whose annotated field returns a union, composition fails at compile time with two errors:

1. an `incompatibleTypeWithProvidesErrorMessage` for the annotated field, because the resolved field-set parent type is a union rather than an object or interface, and
2. a spurious secondary error claiming the member field referenced inside the fragment (e.g. `Book.title`) is invalidly declared `@external`.

The supergraph is never produced, so this is a hard compose-time rejection rather than a runtime fault or silently-wrong data.

The bug spans two stages.
Composition (normalization / field-set validation) rejects the construct at compile time, so no supergraph is produced.
And even once composition accepts it, query planning does not honor the `@provides` for the union member at runtime: it returns correct data but via an entity fetch to the owning subgraph instead of reading the provided value inline.
Execution is not at fault in either case.

## Reference behavior

Both competing federation stacks accept and resolve the identical graph and query,
which establishes that this is a Cosmo composition gap, not a spec ambiguity.

an alternative composer accepts the two subgraphs and produces a supergraph.
an alternative federation router then resolves the query, serving the provided member field inline from the subgraph that declared `@provides`,
with no secondary entity fetch for that field.

an alternative federation gateway, loading the same alternatively-composed supergraph, composes and resolves identically and returns byte-identical response bytes.

Both stacks treat `@provides` on a union-typed field as valid.
The Federation spec places `@provides` on `FIELD_DEFINITION` with no restriction on the annotated field's return type,
and a field set is a selection set whose grammar admits inline fragments,
so a selection set rooted at a union is valid precisely because it is composed of inline fragments over the union's members.

## Reproduction (neutral)

### Subgraph A (owns the union field, provides a member field)

```graphql
type Query {
  media: [Media] @shareable @provides(fields: "... on Book { title }")
}

union Media = Book | Movie

type Book @key(fields: "id") {
  id: ID!
  title: String! @external
}

type Movie @key(fields: "id") {
  id: ID!
}
```

### Subgraph B (owns `Book.title`)

```graphql
type Book @key(fields: "id") {
  id: ID!
  title: String!
}

type Movie @key(fields: "id") {
  id: ID!
}
```

### Query

```graphql
{
  media {
    ... on Book {
      id
      title
    }
    ... on Movie {
      id
    }
  }
}
```

### Observed (Cosmo)

`wgc compose` fails and emits no supergraph.
Two errors are produced:
an `incompatibleTypeWithProvidesErrorMessage` for `Query.media` (its field-set parent resolves to the union `Media`),
and a spurious `Book.title is invalidly declared @external` error.

### Expected

Composition succeeds and a supergraph is produced.
For a dataset where subgraph A returns one `Book` and one `Movie`,
the router plans `media` against subgraph A, resolves `Book.title` directly from A's `@provides` selection,
and issues no follow-up entity fetch to subgraph B for `title`.

For the sample dataset `media = [ Book { id: "book-1", title: "Dune" }, Movie { id: "movie-1" } ]`,
the exact expected response body is:

```json
{"data":{"media":[{"id":"book-1","title":"Dune"},{"id":"movie-1"}]}}
```

## Root cause

The defect lives in `composition/src/v1/normalization/normalization-factory.ts`,
in the method `getFieldSetParent`.

`getFieldSetParent` resolves the parent type of a `@provides`/`@requires`/`@key` field set and then hard-gates on that parent's kind.
After resolving the annotated field's named return type,
it accepts only `Kind.OBJECT_TYPE_DEFINITION` and `Kind.INTERFACE_TYPE_DEFINITION`;
for any other kind it returns `incompatibleTypeWithProvidesErrorMessage` and bails,
directly under the comment `// @TODO handle abstract types and fragments`.
A union return type therefore never passes this gate.

This gate fires before the field set string is ever parsed.
That ordering is what produces the second, spurious error:
because the `@provides` selection is never parsed,
the `@external` declaration on the member field (`Book.title`) never finds the consumer that would justify it,
so it is reported as an orphaned, invalid `@external`.
Fixing the gate removes both errors at once, because the second error is purely a downstream consequence of the first.

The downstream walker `validateConditionalFieldSet` in the same file is already abstract-type capable.
Its internal parent stack is already typed to hold either a composite (object/interface) parent or a union parent,
it already has a union branch in its `Field` handler that rejects a bare field selected directly on a union (which is the correct error for that malformed case),
and its `InlineFragment` handler already has a union case that resolves a fragment's type condition and pushes the concrete member type onto the parent stack.
In other words, every piece of machinery needed to walk a union-rooted `@provides` selection already exists and is exercised by existing key/entity paths;
the only thing standing in the way is the early kind gate in `getFieldSetParent`.

The result type `FieldSetParentResult` in `composition/src/v1/normalization/types/types.ts` currently types its `fieldSetParentData` as a composite (object/interface) parent only,
which is the type-level expression of the same restriction.

There is also a planner root cause.
The engine (`graphql-go-tools`, v2.5.0) *extracts* the `@provides` suggestion for a union-rooted selection — its `providesSuggestions` unit test `TestProvidesSuggestionsWithFragments` covers the extraction — but it does **not honor it end to end**.
During datasource suggestion collection (`datasource_filter_collect_nodes_visitor.go`) the provided field is looked up by its fragment-qualified path, while the provides entry is keyed by the fragment-stripped path, so the union member field is never recognised as provided.
The planner therefore falls back to an `@key` entity fetch to the owning subgraph for that field.
The data is still correct, but the `@provides` optimisation (read the value inline, issue no owner fetch) is lost — unlike alternative federation implementations, which honor it.
So composition rejecting the construct is the first defect and the planner not honoring it is the second; both must be fixed for parity with the reference gateways.

## Decision

Fix this in two stages: composition (so the graph composes) and the query planner (so the `@provides` is honored at runtime).
The composition strategy is to relax a single over-strict parent-kind gate so that the already-union-capable walker is allowed to run,
and to widen the corresponding result and parameter types to match.
The planner strategy is to recognise the provided union-member field during datasource selection so no entity fetch to the owning subgraph is issued.

Composition area:

- Relax the parent-kind gate in `getFieldSetParent` so that a union return type is an accepted field-set parent,
  alongside the existing object and interface kinds.
  When the annotated field's named return type is a union, return that union definition as the field-set parent instead of falling through to `incompatibleTypeWithProvidesErrorMessage`.
- Widen `FieldSetParentResult.fieldSetParentData` (in `types/types.ts`) and the parent parameter of `validateConditionalFieldSet` to admit a union parent in addition to the composite parent it already accepts.
  This is a type-level widening only;
  the walker's runtime logic is unchanged because its union and inline-fragment branches already exist.
- Rely on the existing union / inline-fragment handling for the rest of the walk.
  Once the field set is parsed, the member field's `@external` is matched against the parsed `... on Book { title }` selection,
  so the spurious secondary `@external` error disappears as a side effect with no separate change.

Planner area:

- Honor `@provides` over union members during datasource suggestion collection (`datasource_filter_collect_nodes_visitor.go`).
  When a field sits directly inside an inline fragment on a union and the exact (fragment-qualified) provides-key lookup misses, additionally try the fragment-stripped path against the provides entries.
  The provided union-member field is then recognised as provided, so the planner reads it inline from the providing subgraph and issues no `@key` entity fetch to the owning subgraph.
- Gate this strictly: it activates only for a field on a union inline fragment whose path actually changed by fragment removal and for which a provides entry exists at the fragment-stripped path.
  Every plan that does not involve a union-typed `@provides` is byte-identical, so the celestial plan-snapshot sweep stays at zero drift.

Design constraints:

- The relaxation must be additive and narrowly scoped: it admits union parents, and nothing else.
  Keep the explicit rejection for genuinely incompatible parents (scalars, enums, input objects) intact,
  so the gate is relaxed rather than removed.
- Prefer scoping the relaxation to the `@provides` call path.
  `getFieldSetParent` is shared by `@key` and `@requires`;
  whether a union parent is meaningful for those directives is a separate question,
  so the broadening should be confined to the `@provides` use unless union parents are explicitly intended for the others.
- Because existing object and interface field sets continue to take an identical code path,
  the change must produce no plan differences for any graph that already composed today;
  it strictly admits a larger set of valid inputs.

## Test & verification plan

- Composition unit test (positive).
  Add a case to the normalization `@provides` composition suite that feeds the neutral `Media` / `Book` / `Movie` subgraphs above and asserts the graph composes.
  Assert on the full result: the entire errors array is empty and a supergraph is present.
  Do not assert on a substring of any single error.
- Composition unit test (secondary-error regression).
  Assert that the previously-emitted `Book.title is invalidly declared @external` error is absent,
  confirming it was a downstream artifact of the rejected gate.
- Composition negative test (unchanged behavior).
  Assert that `@provides` on a scalar- or enum-returning field still fails with `incompatibleTypeWithProvidesErrorMessage`,
  proving the gate was relaxed for unions only, not removed.
- Engine planner test (new, RED/GREEN).
  Add a `graphql-go-tools` datasource test asserting the full plan for the union-`@provides` shape reads the provided member field inline from the providing subgraph and issues no `_entities` fetch to the owning subgraph.
  It is RED on stock v2.5.0 and GREEN after the planner fix.
  The existing `TestProvidesSuggestionsWithFragments` (suggestion extraction) stays green.
- Router e2e test (`router-tests`).
  Add a fixture supergraph built from the two neutral subgraphs and run the reproduction query.
  Assert the full response body byte-for-byte equals
  `{"data":{"media":[{"id":"book-1","title":"Dune"},{"id":"movie-1"}]}}`
  for the sample dataset,
  and assert that `title` is served from subgraph A's `@provides` with no entity fetch dispatched to subgraph B.
- Celestial plan-snapshot no-regression.
  Run celestial across the existing supergraph corpus and confirm zero plan-snapshot diffs.
  Graphs that previously composed take an identical code path, so byte-identical plan output is the pass condition.
- Federation audit.
  The federation-gateway-audit `provides-on-union` suite, which Cosmo currently fails on composition, should flip to passing,
  with no regression in the other federation-gateway-audit suites.

## Consequences / risks

The regression surface is small and bounded.
The change admits exactly one additional accepted parent kind (union) on the `@provides` path and reuses already-tested downstream walker branches,
so it adds no new validation logic that could misfire.

The main risk is an overly broad relaxation that would accept malformed field sets.
This is bounded three ways:
the explicit reject for scalar / enum / input-object parents is kept (negative test above),
the relaxation is scoped to the `@provides` call path rather than silently widening `@key` and `@requires`,
and the walker's existing union and inline-fragment branches still reject bare field selections on a union and inline fragments whose type condition is not a member of the union.

There is no runtime or planner change,
so there is no execution-path risk;
the celestial snapshot run is the guard that confirms previously-composing graphs are unaffected.
