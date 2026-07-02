---
title: "@provides field sets over interface-typed fields"
author: Jens Neuse
---

## Status

Proposed.

## Context

`@provides` lets a subgraph declare that, when it resolves a particular field, it can also supply some otherwise-`@external` child fields inline,
so the router can skip a follow-up entity fetch for those children.
The field set passed to `@provides` is a GraphQL selection set rooted at the annotated field's return type.

This ADR covers the case where the provided field set traverses an **interface-typed** field,
and `@external` is declared on the **concrete implementations** of that interface rather than on the interface itself.

A concrete shape: a root field returns the interface `Media`, `Media` exposes an interface-typed list `animals: [Animal]`,
and the implementations `Cat` / `Dog` declare `name` (and `id`) `@external` in the providing subgraph while another subgraph owns the real `name`.
The root field carries `@provides(fields: "animals { id name }")`, selecting the leaves through the `Animal` interface.

Cosmo fails this case at **two distinct pipeline stages**, and both must be fixed for parity with the reference gateways:

- **Compose-time rejection.**
  `wgc compose` rejects the providing subgraph before any plan is produced,
  with a non-external-conditional-field error of the form
  `... neither the field "Animal.name" nor any of its field set ancestors are declared "@external" ... already provided by subgraph "b" ...`.
  The `@provides` is rejected even though `@external` is correctly declared on `Cat.name` / `Dog.name`,
  because Cosmo resolves `@external` at the **interface** level (`Animal.name`) rather than the **implementation** level.

- **Planner non-honoring.**
  Even once composition is relaxed to accept the `@provides`, the query planner still does not honor it for the concrete members.
  After the planner rewrites the abstract selection into per-implementation inline fragments,
  the provided leaf is looked up by the rewritten **concrete** path and misses the **interface**-keyed provides entry,
  so the member field is treated as not-provided and the planner does not read it from the providing subgraph.

So this is a **composition + planning** defect, not a planner-only one:
composition rejects the construct first, and the planner would also need to honor it once composition accepts.
Execution is not at fault.

This is the same keying-mismatch class the already-shipped union-`@provides` fix addressed on the planner side,
now manifesting through interface inline fragments,
paired with a composition relaxation analogous in spirit to the union case.

## Reference behavior

alternative implementations accept this graph and honor the `@provides` at runtime,
which establishes that this is a Cosmo gap on both stages, not a spec ambiguity.

- **an alternative composer accepts the graph.**
  Live-verified: `an alternative composer` on the three neutral subgraphs below produces a clean supergraph (exit 0, only benign field-coverage hints),
  whereas `wgc compose` on the identical subgraphs rejects subgraph `b`'s `@provides`.
  `@external` is validated at the **implementation** level:
  because `Cat.name` / `Dog.name` are `@external`, a provides field set that selects `name` through `Animal` is treated as selecting `name` on each concrete implementation.
  This means Cosmo is currently **stricter** than the alternative implementation here — it rejects a graph the alternative implementation accepts — so reaching parity requires *relaxing* Cosmo's composer, not tightening it.

- **alternative federation implementations resolve the provided fields locally.**
  The federation-gateway-audit records this directly in its `provides-on-interface` suite (two test cases):
  an alternative federation router `..` (both pass), an alternative federation gateway `..` (both pass), Cosmo Router `XX` (both fail).
  `id` and `name` for each `Cat` / `Dog` come from the providing subgraph's `@provides` response,
  and **no** `_entities` round-trip is issued to the subgraph that owns `name` for the leaves covered by the provides.

This establishes the correct behavior:
accept the graph at compose time (matching the alternative implementation), and resolve the interface-typed provided leaves from the providing subgraph without an entity fetch.

## Reproduction (neutral)

Three v2 subgraphs, taken from the public audit's `provides-on-interface` suite.
The three-subgraph shape matters: it is the shape the alternative implementation accepts and Cosmo rejects.
A naive two-subgraph shape that selects a non-`@external` leaf (for example the `@key` `id`) in the provides field set is **genuinely invalid federation** and is rejected **identically by both `wgc` and an alternative composer** (live-verified, both emit `PROVIDES_FIELDS_MISSING_EXTERNAL`-class errors), so it is not a valid reproduction of this bug.

Subgraph `a` exposes `media` and a concrete-fragment `@provides`, with implementation fields `@external`:

```graphql
type Query {
  media: Media @shareable
  book: Book @provides(fields: "animals { ... on Dog { name } }")
}

interface Media {
  id: ID!
}

interface Animal {
  id: ID!
}

type Book implements Media @key(fields: "id") {
  id: ID!
  animals: [Animal] @shareable
}

type Dog implements Animal @key(fields: "id") {
  id: ID! @external
  name: String @external
}

type Cat implements Animal @key(fields: "id") {
  id: ID! @external
}
```

Subgraph `b` declares the interface-typed `@provides` exercised by the query, with the implementation leaves `@external`:

```graphql
type Query {
  media: Media @shareable @provides(fields: "animals { id name }")
}

interface Media {
  id: ID!
  animals: [Animal]
}

interface Animal {
  id: ID!
  name: String
}

type Book implements Media {
  id: ID! @shareable
  animals: [Animal] @external
}

type Dog implements Animal {
  id: ID! @external
  name: String @external
}

type Cat implements Animal {
  id: ID! @external
  name: String @external
}
```

Subgraph `c` owns `name` (`@shareable`) and `age` on the concrete types:

```graphql
interface Media {
  id: ID!
  animals: [Animal]
}

interface Animal {
  id: ID!
  name: String
}

type Book implements Media @key(fields: "id") {
  id: ID!
  animals: [Animal] @shareable
}

type Dog implements Animal @key(fields: "id") {
  id: ID!
  name: String @shareable
  age: Int
}

type Cat implements Animal @key(fields: "id") {
  id: ID!
  name: String @shareable
  age: Int
}
```

`@external` lives on `Cat.name` / `Dog.name` in the providing subgraph, never on `Animal.name`.
The interface `Animal` declares `name` as a normal field, which is the only legal place to declare it on the interface.

First query:

```graphql
{
  media {
    id
    animals {
      id
      name
    }
  }
}
```

Second query (adds a concrete fragment for an owned field):

```graphql
{
  media {
    id
    animals {
      id
      name
      ... on Cat {
        age
      }
    }
  }
}
```

For the sample dataset (`media.id = "m1"`, `animals = [ Dog { id: "a1", name: "Fido" }, Cat { id: "a2", name: "Whiskers", age: 6 } ]`):

Observed (Cosmo):
`wgc compose` fails and emits no supergraph,
rejecting subgraph `b`'s `@provides(fields: "animals { id name }")` with
`... neither the field "Animal.name" nor any of its field set ancestors are declared "@external" ... already provided by subgraph "b" ...`
(and the same for `Animal.id`),
so no plan is ever produced.
If composition is forced through, the planner still does not honor the provides for the concrete members,
so `animals.name` is not served from the providing subgraph and the response diverges from expected.
Both audit cases fail (`XX`).

Expected (matches alternative federation implementations), exact response body for the first query:

```json
{"data":{"media":{"id":"m1","animals":[{"id":"a1","name":"Fido"},{"id":"a2","name":"Whiskers"}]}}}
```

Exact response body for the second query:

```json
{"data":{"media":{"id":"m1","animals":[{"id":"a1","name":"Fido"},{"id":"a2","name":"Whiskers","age":6}]}}}
```

In both cases `id` and `name` for each `Cat` / `Dog` are read from the providing subgraph's `@provides` response,
and the only owner fetch is for the genuinely-owned `Cat.age` in the second query.

## Root cause

### Composition root cause

File: `composition/src/v1/normalization/normalization-factory.ts`, method `validateConditionalFieldSet`.

The validator walks the provides field set with a `visit` over the selection set, maintaining a `parentDatas` stack.
When it descends into `animals`, it resolves the named type to the **interface** `Animal` and pushes the interface's type data.
For the leaves `id` / `name`, it reads the external flag from the **interface** field rather than from the concrete implementations.

Because `@external` is declared on `Cat.name` / `Dog.name` and not on `Animal.name`,
the interface field is seen as non-external,
the walk enters the non-external-conditional-field branch,
and `#handleNonExternalConditionalField` pushes the rejection error.

The defect is precise:
the validator resolves `@external` against the **static type of the field** (the interface),
but for an interface-typed selection `@external` is meaningful at the **implementation** level (`Cat.name`, `Dog.name`).
The concrete implementations are never consulted for the leaf external check,
even though the factory already tracks the abstract-to-concrete mapping in `concreteTypeNamesByAbstractTypeName`.

### Planner root cause

Files (graphql-go-tools):
`v2/pkg/engine/plan/provides_fields_visitor.go`,
`v2/pkg/engine/plan/abstract_selection_rewriter.go`,
`v2/pkg/engine/plan/datasource_filter_collect_nodes_visitor.go`,
`v2/pkg/engine/plan/datasource_filter_visitor.go`.

Even if composition emits a provides config for this shape, the planner does not honor it for the concrete members,
because of an interaction between abstract-to-concrete rewriting and the key used to look up provided fields.

1. **Provides entries are keyed by the interface type.**
   `providesVisitor.EnterField` (`provides_fields_visitor.go`) keys each provided field with
   `providedFieldKey(typeName, fieldName, path)`,
   where `typeName` is `walker.EnclosingTypeDefinition.NameString(...)`.
   For `animals { id name }` the enclosing type is the interface, so the entries are stored under `Animal|id|...` and `Animal|name|...`.

2. **The interface selection is rewritten to concrete fragments.**
   Because the leaves are `@external` only on the implementations, the planner rewrites the interface selection into per-implementation inline fragments
   (`... on Cat { id name }`, `... on Dog { id name }`)
   via `fieldSelectionRewriter.interfaceFieldSelectionNeedsRewrite` / `processInterfaceSelection` (`abstract_selection_rewriter.go`).

3. **The provides lookup uses the post-rewrite concrete type.**
   In `datasource_filter_collect_nodes_visitor.go` the suggestion collector probes
   `f.providesEntries[providedFieldKey(info.typeName, info.fieldName, info.currentPath)]`,
   where `info.typeName` is now the concrete type `Cat` / `Dog`.
   The lookup `Cat|name|...` misses the entry stored under `Animal|name|...`, so `isProvided` is `false`.

4. **The field is then treated as not resolvable on the providing subgraph.**
   With `isProvided = false` and the field external, the suggestion matches the `IsExternal && !IsProvided` gate enforced throughout `datasource_filter_visitor.go`,
   so the planner does not read the value from the providing subgraph
   and instead forces an `_entities` fetch to the owning subgraph (or drops the leaf), unlike alternative federation implementations, which honor it.

In short: provides entries are keyed by the **interface** path/type but looked up by the **rewritten concrete** fragment paths/types,
so the provided concrete fields are never recognized.
There is currently no engine test coverage for interface-typed provides (unlike the union-typed provides shape, which is covered),
which is why this half must be locked down with a RED/GREEN planner test.

## Decision

Align Cosmo with alternative federation implementations:
accept implementation-level `@external` reached through an interface-typed provides, and honor it at plan time.
Ship the composition and planner changes together, because they must agree on how provides entries are keyed.

This is **not** a planner-only fix:
with stock composition there is no router config for this shape, so the planner never runs;
and an alternative composer (the alternative implementation) accepts the graph that `wgc` rejects, so parity requires relaxing the composer, not leaving it as is.

### Composition area

In `validateConditionalFieldSet` (`composition/src/v1/normalization/normalization-factory.ts`),
when the `parentData` for a provides leaf is an interface,
resolve the external flag at the **implementation** level instead of reading it from the interface field.
Use the existing `concreteTypeNamesByAbstractTypeName` mapping to reach the same field on each concrete implementation,
and treat the leaf as external/conditional when the implementations declare it `@external`.
Preserve the existing interface-level behavior when the interface field itself is external,
so the already-supported interface-external case does not regress.
Scope the broadening to `@provides` leaves only, leaving `@key` / `@requires` validation unchanged.
Emit the resulting conditional-field configuration so the planner receives entries for the provided concrete fields.

Critically, the relaxation must accept **only** what the alternative implementation accepts, not more:
a provides leaf that is not `@external` on any concrete implementation (the genuinely-invalid naive shape) must still be rejected,
so Cosmo does not become more permissive than the alternative implementation.

### Planner area

In graphql-go-tools, make the provides lookup recognize the post-rewrite concrete fragment paths.
Reuse the fragment-stripped-path matching mechanism already shipped for the union-`@provides` case,
extended from union inline fragments to interface inline fragments.
Match provides entries (keyed by the interface) against the concrete fragment paths produced by the abstract-to-concrete rewrite,
honoring the providing subgraph,
so the `IsExternal && !IsProvided` gate in `datasource_filter_visitor.go` no longer drops the provided leaf
(the relevant sites are the suggestion collector in `datasource_filter_collect_nodes_visitor.go`,
the rewrite in `abstract_selection_rewriter.go`,
and the gate in `datasource_filter_visitor.go`).

Key design constraints:

- The broadening from interface-keyed to concrete-keyed provides MUST be gated as a **strict fallback**:
  it activates only on provided abstract fragment paths whose path actually changed by fragment removal and for which an interface-keyed provides entry exists,
  so plans that do not involve an interface-typed (or union-typed) provides are byte-for-byte unchanged (celestial output must not move).
- Bound the gather to a **single hop**:
  only resolve across the immediate abstract-to-concrete rewrite of the provided interface field,
  do not recursively chase nested abstracts,
  to keep the blast radius minimal and the hot node-suggestion path cheap.

This ADR describes the strategy and the code areas only.
The exact keying choice (register concrete-keyed entries at entry-build time vs. probe the interface-keyed entry at lookup time)
is settled by whichever option the RED/GREEN planner test validates with the smaller blast radius.

## Test & verification plan

1. **Composition unit test** (`composition/`).
   A v2 fixture matching the reproduction.
   Assert composition succeeds and assert the **full** emitted federation/provides configuration object for `Query.media` (exact value, inline),
   confirming the conditional-field entries are present for `Cat.name` / `Dog.name`.

2. **Composition negative test** (`composition/`).
   Assert that the naive shape (a non-`@external` leaf, e.g. the `@key` `id`, inside the provides field set) still fails,
   matching an alternative composer's `PROVIDES_FIELDS_MISSING_EXTERNAL` rejection,
   proving the relaxation reaches the alternative implementation parity and does not exceed it.

3. **Planner unit test** (`v2/pkg/engine/plan`, graphql-go-tools), RED/GREEN.
   A test for interface-typed provides that asserts the **full** resolved plan structurally:
   `id` / `name` for each `Cat` / `Dog` are read from the providing subgraph and there is **no** `_entities` fetch to the owning subgraph for the provided leaves.
   This is the gating test: RED on the current engine, GREEN after the planner fix, before the composition change is finalized.
   Add a sibling plain interface + union test with no `@provides` to lock the blast radius of the suggestion/path changes,
   asserting the full plan is unchanged.

4. **Router e2e test** (`router-tests`).
   Wire the three neutral subgraphs and run both reproduction queries.
   Assert the **full** response body byte-for-byte for the first query equals
   `{"data":{"media":{"id":"m1","animals":[{"id":"a1","name":"Fido"},{"id":"a2","name":"Whiskers"}]}}}`,
   and for the second query equals
   `{"data":{"media":{"id":"m1","animals":[{"id":"a1","name":"Fido"},{"id":"a2","name":"Whiskers","age":6}]}}}`.
   Capture subgraph requests and assert `name` is served from the providing subgraph's `@provides`
   with no `_entities` request issued to the owning subgraph for the provided leaves
   (the only owner fetch permitted is for the genuinely-owned `Cat.age` in the second query).

5. **Celestial plan-snapshot no-regression.**
   Run celestial over the full planner snapshot corpus and require **zero** plan diffs,
   since the planner change is gated to provided-abstract-fragment paths.

6. **Federation gateway audit.**
   The federation-gateway-audit `provides-on-interface` suite must flip from `XX` to `..`,
   asserting the exact expected data with no 500, and with no regressions across the rest of the audit
   (including the already-passing `provides-on-union` suite).

## Consequences / risks

- **Composition over-generalization.**
  The change touches the abstract-to-concrete resolution that is easy to over-broaden.
  It is bounded by scoping to `@provides` leaves under an interface parent, by preserving the interface-external path,
  by the parity with the alternative composer negative test (naive non-external leaf still rejected),
  and by asserting the full conditional-field configuration in the positive unit test.

- **Planner regression surface.**
  The lookup change sits in the hot node-suggestion path.
  It is bounded by the strict fallback gate (provided abstract fragment paths only), the single-hop gather, and the mandatory celestial 0-diff requirement.

- **Coupling.**
  Composition and planner must agree on provides-entry keying; landing only one side risks composition-accepted-but-planner-unaware,
  which would silently force an entity fetch (perf regression, not wrong data).
  The e2e subgraph-request assertion and the audit suite guard against shipping the halves out of sync.

- **Interface-object interplay.**
  Implementation-level resolution must not collide with the `@interfaceObject` typename handling in `datasource_filter_collect_nodes_visitor.go`;
  the single-hop bound and the plain interface/union no-`@provides` test cover this.
