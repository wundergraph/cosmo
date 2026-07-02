---
title: "@requires field sets that select the same field with different arguments drop data"
author: Jens Neuse
---

## Status

Proposed.

## Context

Federation lets a field declare `@requires(fields: "...")` to pull external fields from the providing subgraph before the consuming subgraph resolves it.
A single entity can carry several `@requires` consumers, and two of them may require the *same* providing-subgraph field with *different* arguments.

A representative pattern: an entity has two computed fields, one that requires a priced field in one currency and one that requires the same priced field in another currency.
Both consumers depend on the identical canonical field (`price`), differing only in the field argument (`currency`).

The observed wrong behavior is **silently wrong data**, the highest-severity failure mode.
Composition succeeds, the query is accepted, the router returns HTTP 200, and the response is structurally valid.
But the two consumers receive the **same** value — the value computed for the *first* argument — so the second consumer's data is silently incorrect.

The bug is owned entirely by the **query-planning** stage, specifically representation-variable construction.
The wrong value only *surfaces* at execution time, but the planner has already baked a lossy template: the per-consumer representation field trees are folded into one entity representation object that has a single slot for the conflicting field, so the second argument's value is discarded before any fetch is issued.
Composition is **not** at fault here — it composes the graph correctly and emits both `@requires` entries with their distinct argumented selection sets.

## Reference behavior

This is a hard federation edge case.
Both major gateways were checked on the identical graph and query, and they disagree:

- **One alternative implementation** is **spec-correct**.
  It issues the providing-subgraph fetch such that each consumer carries its own correctly-argumented value in its own representation, so each `@requires` consumer reads the value computed for *its* argument.
- **Another alternative implementation** is **also wrong**, in the mirror-image direction.
  It collapses both consumers onto the *second* argument's value.
- **Cosmo Router** collapses both consumers onto the *first* argument's value.

So the correct reference is an alternative federation gateway and the federation-spec intent, not "match the alternative implementation" — the alternative implementation fails this case too, just by picking the opposite end of the conflict.
The correct, full response shape for the reproduction below is:

```json
{"data":{"topProduct":{"estimateA":100,"estimateB":200}}}
```

## Reproduction (neutral)

### Subgraphs

Subgraph `inventory` declares the two computed fields and requires `price` with two different currency arguments:

```graphql
type Product @key(fields: "upc") {
  upc: String!
  price(currency: String!): Int @external
  weight: Int @external
  estimateA: Int @requires(fields: "price(currency: \"USD\") weight")
  estimateB: Int @requires(fields: "price(currency: \"EUR\") weight")
}
```

Subgraph `catalog` owns and provides `price` and `weight`:

```graphql
type Product @key(fields: "upc") {
  upc: String!
  price(currency: String!): Int @shareable
  weight: Int @shareable
}

type Query {
  topProduct: Product
}
```

For the example, `catalog` returns `price(currency: "USD") = 100` and `price(currency: "EUR") = 200`.
`estimateA` echoes back the USD price it was given, `estimateB` echoes back the EUR price it was given.

### Query

```graphql
query {
  topProduct {
    estimateA   # must reflect price(currency: "USD") = 100
    estimateB   # must reflect price(currency: "EUR") = 200
  }
}
```

### Observed vs expected

Observed today (Cosmo collapses to the first / USD value):

```json
{"data":{"topProduct":{"estimateA":100,"estimateB":100}}}
```

Expected (spec-correct, as the spec-correct alternative resolves it):

```json
{"data":{"topProduct":{"estimateA":100,"estimateB":200}}}
```

For reference, the other alternative implementation collapses to the second / EUR value, which is also wrong:

```json
{"data":{"topProduct":{"estimateA":200,"estimateB":200}}}
```

## Root cause

The defect lives in the planner, in `graphql-go-tools` at `v2/pkg/engine/datasource/graphql_datasource/representation_variable.go`, together with its caller in `v2/pkg/engine/datasource/graphql_datasource/graphql_datasource.go`.

There is no composition root cause.
Composition correctly records two `@requires` consumers on the same entity as two `FederationFieldConfiguration` entries (`v2/pkg/engine/plan/federation_metadata.go`), each with its own `SelectionSet` string (`price(currency: "USD") weight` and `price(currency: "EUR") weight`).
The planner also correctly determines it must obtain both argumented values of `price` from the providing subgraph.
Everything upstream of representation merging is correct.

The planner root cause is how the per-consumer representation field trees are merged into the single entity representation variable sent to the providing subgraph:

1. `buildRepresentationsVariable` (in `graphql_datasource.go`) iterates `p.dataSourcePlannerConfig.RequiredFields`, builds one `*resolve.Object` per consumer via `buildRepresentationVariableNode`, and folds them together with `mergeRepresentationVariableNodes(objects)`.
2. `mergeRepresentationVariableNodes` (in `representation_variable.go`) walks each incoming field and, for each one, calls `fieldsHasField` to decide merge-vs-append.
3. `fieldsHasField` treats two fields as equal when only their response/field `Name` and their `OnTypeNames` set match.
   It is **name-only**: it is neither argument-aware nor path-aware.
   So `price(currency: "USD")` from the first consumer and `price(currency: "EUR")` from the second consumer are judged the *same* field and collapse into one slot.
4. `mergeFields` then descends only for object and array nodes; for a scalar leaf such as `price: Int` it falls through to the default branch and returns the left (first) field unchanged, discarding the right (second) value.
   The same collapse occurs in `mergeObjects` for nested cases.

Net effect: the two distinct argumented `price` values become one `price` representation slot holding only the first consumer's value, and the second consumer's value is dropped before the fetch is built.
The file's existing `// TODO: add support for remapping path` marker flags that this merge stage is already known to be path-unaware.

Why a one-line dedup tweak is insufficient: a single entity representation is one JSON object with one `price` response key, so it structurally cannot carry two different values under that key, and the providing subgraph reads the canonical field name `price` (not an alias) when resolving `@requires`.
The fix must change the **shape of the fetch**, not just the equality predicate.

## Decision

Adopt the **fetch-splitting** approach, which is the shape an alternative federation gateway produces and the spec-correct behavior.
When multiple `@requires` consumers on the same entity require the same providing-subgraph field with conflicting arguments, partition them into separate `_entities` fetches, each carrying its own correctly-argumented value under the canonical key, and merge the responses back per-consumer.

Composition area: no change.
The composition output already distinguishes the two consumers by their selection sets; the implementer should add a guard test (below) to keep it that way, but no composition logic changes.

Planner area (all in `graphql-go-tools`):

1. **Detect the conflict during representation building.**
   Extend the equality decision used by `mergeRepresentationVariableNodes` / `fieldsHasField` so that two fields with the same `Name` and `OnTypeNames` but a different argument fingerprint are recognized as *conflicting* rather than *mergeable*.
   This requires carrying the field-argument fingerprint into the representation field nodes, since it is discarded by the time the merge runs today.
   A dedicated conflict predicate (conceptually, a "has argument conflict with" check) keeps this isolated from the common merge path.
2. **Partition the consumers into fetch buckets.**
   In the entity-fetch assembly path that feeds `buildRepresentationsVariable` (and the `@requires` dependency wiring in `v2/pkg/engine/plan/path_builder_visitor.go`, e.g. `addFieldDependencies` and the `RequiredFields()` accumulation), group consumers so that no two fields sharing a canonical key but differing in arguments land in the same bucket.
   Emit one `_entities` fetch per bucket and import each field's original arguments through to the upstream operation.
   Within a bucket the existing merge logic stays correct and unchanged.
3. **Merge results per-consumer.**
   Wire each bucket's response back to the consumers it served, so the USD consumer reads the USD fetch and the EUR consumer reads the EUR fetch.

Key design constraints:

- The split MUST be gated as a **strict fallback**, triggered only on genuine same-canonical-key / different-argument collisions.
  For every entity representation that has no such collision — the overwhelming majority, including ordinary `@key` and non-conflicting `@requires` — the emitted plan must be **byte-identical** to today.
  This preserves the celestial plan-snapshot output unchanged.
- Bound the conflict detection to a **single entity representation / single providing-subgraph hop**.
  Detect the conflict at the point where per-consumer representation trees are merged for one entity fetch; do not broaden detection or gathering across additional hops.

The loud-planning-error variant (fail planning with a clear "conflicting `@requires` arguments" message instead of returning wrong data) is a strictly-smaller fallback if the split is deemed too large for one change; it is correctness-safe but does not actually resolve the query, so the split is the chosen decision.

## Test & verification plan

- **Planner unit test** (`graphql-go-tools`, `graphql_datasource` package, alongside `representation_variable_test.go`):
  build the plan for the two-consumer / conflicting-argument case above and assert the resulting fetch shape — two separate `_entities` representations, one carrying the USD-argumented `price` and one the EUR-argumented `price` — with a full-value `assert.Equal` on the serialized plan.
  No substring or `Contains` assertions; assert the entire plan string.
- **Composition guard test** (composition package): compose the `inventory` + `catalog` subgraphs and assert the full set of emitted `@requires` `FederationFieldConfiguration` entries, confirming both consumers survive composition with their distinct selection sets `price(currency: "USD") weight` and `price(currency: "EUR") weight`.
  This protects the input the planner fix relies on.
- **e2e router test** (`router-tests`, federated testenv with the two subgraphs above):
  run the reproduction query and assert the **full** response body:
  ```json
  {"data":{"topProduct":{"estimateA":100,"estimateB":200}}}
  ```
- **Celestial plan-snapshot no-regression:**
  run the celestial plan-diff across the full corpus and require **zero** plan changes.
  Because the touched predicate (`fieldsHasField` / `mergeRepresentationVariableNodes`) is on the hot path for *all* entity representations, byte-identical plans for every non-conflicting graph and operation are the gate — the split must fire only on genuine argument conflicts, none of which are present in the snapshot corpus.
- **federation-gateway-audit:**
  the `requires-with-argument-conflict` suite must flip from failing to passing, with no regressions in the rest of the audit (notably the other `@requires`, `@key`, and `@provides` suites).

## Consequences / risks

The regression surface is every entity representation build, since the conflict predicate sits on the shared merge path.
An over-broad predicate would either needlessly split fetches — adding extra providing-subgraph round-trips — or change plans for correct, non-conflicting cases.

Both risks are bounded the same way: the split is scoped strictly to same-canonical-key / different-argument collisions on a single entity hop, and the celestial plan-diff gate (zero changes) plus the audit-no-regression requirement together prove that nothing outside the genuine-conflict path moved.
For conflicting cases, the cost is the intended one — one additional `_entities` fetch per extra conflicting argument bucket — which is the minimum required to return correct data and matches the spec-correct gateway's behavior.
