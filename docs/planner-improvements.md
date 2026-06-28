# Federation planner-improvements — reviewer guide

Five federation **correctness and parity** fixes, each spanning the Cosmo
composition library (TypeScript) and/or the `graphql-go-tools` query planner (Go).
Every fix is grounded in a decision record under [`adr/`](./adr), validated against the
public federation-gateway-audit compatibility suite,
and gated for zero plan-snapshot regression.

This branch (`planner-improvements`) pairs with the `planner-improvements` branch in
`graphql-go-tools`. During development the two are linked with a local `go.work`; the
final commit pins the published `graphql-go-tools` commit in `router/go.mod`.

## What each fix does

| # | ADR | Stage | What it fixes | Reference gateways |
|---|-----|-------|---------------|--------------------|
| A1 | [provides-on-union-fieldsets](./adr/provides-on-union-fieldsets.md) | composition + planner | `@provides` over a **union**-typed field was rejected at compose time; even composed, the planner did not honor it (it entity-fetched the owner instead of reading the provided value inline). | alternative federation implementations honor it |
| A2 | [provides-on-interface-fieldsets](./adr/provides-on-interface-fieldsets.md) | composition + planner | `@provides` over an **interface**-typed field with implementation-level `@external` was rejected by `wgc` (alternative federation implementations accept it), and the planner did not honor it after abstract→concrete rewriting. | alternative federation implementations accept + honor |
| A3 | [multi-hop-compound-key-resolvability](./adr/multi-hop-compound-key-resolvability.md) | composition + planner | A field reachable only by gathering a missing **compound-`@key`** member from a third subgraph was declared unresolvable; the planner could not build the two-stage (gather → compound-key) entity fetch. | alternative federation implementations resolve it |
| B1 | [abstract-empty-selection-set](./adr/abstract-empty-selection-set.md) | planner | An abstract/union field whose members are **split across subgraphs** returned 500 via an empty selection set; fixed via source-subgraph intersection: members are resolved from the owning subgraph, foreign value-type members are absent, and the resolving subgraph's own non-shared members are response-only nulls, not gathered. | alternative federation implementations return 200 |
| B2 | [requires-field-argument-conflict](./adr/requires-field-argument-conflict.md) | planner | Two `@requires` consumers requiring the **same field with different arguments** collapsed to one value → silently wrong data. | alternative federation implementations disagree: one is spec-correct, another also collapses to a single argument |

## Where the code lives (navigation)

Composition changes are in `composition/`; planner changes are in `graphql-go-tools`
(`v2/pkg/engine/...`). Each cluster has unit tests next to the code and an end-to-end
test under `router-tests/protocol/`.

**A1 — provides-on-union**
- Composition: `composition/src/v1/normalization/normalization-factory.ts` (relax the
  field-set parent gate to admit a union parent) + `types/types.ts`.
- Planner: `v2/pkg/engine/plan/datasource_filter_collect_nodes_visitor.go`
  (`isProvidedField` falls back to the fragment-stripped provides key, gated to union
  inline fragments).
- e2e: `router-tests/protocol/provides_union_test.go`.

**A2 — provides-on-interface**
- Composition: `normalization-factory.ts`
  (`#getImplementationExternalFieldDataForProvidesInterfaceLeaf` — resolve `@external`
  at the implementation level; accepts only what alternative federation implementations accept).
- Planner: `datasource_filter_collect_nodes_visitor.go`, `datasource_filter_visitor.go`,
  `path_builder.go` (match interface-keyed provides against rewritten concrete fragment
  paths; the `isOnAbstractFragment` mechanism generalizes A1's).
- e2e: `router-tests/protocol/provides_interface_test.go`.

**A3 — multi-hop compound `@key`**
- Composition: `composition/src/resolvability-graph/graph.ts` (selection-tree multi-hop
  resolvability) + `composition/src/v1/federation/federation-factory.ts`.
- Planner: `source_connection_graph.go`, `node_selection_visitor.go`,
  `node_selection_builder.go`, `datasource_filter_node_suggestions.go`,
  `datasource_filter_visitor.go`, `datasource_filter_resolvable_visitor.go`
  (subset-source-key → compound-target-key jump, **gated as a strict fallback**).
- e2e: `router-tests/protocol/multihop_compound_key_test.go`.

**B1 — abstract empty-selection-set**
- Planner: `abstract_selection_partial_union.go` (source-subgraph/intersection pass for
  split non-entity union fields) + the datasource `allowField` guard that keeps the
  resolving subgraph's response-only null leaves out of upstream fetches.
- e2e: `TestPartialUnionIntersectionOnShareableField` in
  `router-tests/protocol/split_union_test.go`.

**B2 — @requires argument conflict**
- Planner: `graphql_datasource/representation_variable.go` &
  `graphql_datasource.go` (argument-fingerprint conflict detection + fetch split),
  `plan/federation_metadata.go`, `plan/path_builder_visitor.go`.
- e2e: `router-tests/protocol/requires_argument_conflict_test.go`.

## The load-bearing safety property

Every planner change is **strictly gated** so it can only affect the specific broken
shape; any plan that already succeeds is byte-identical. This is enforced by the
**celestial plan-snapshot sweep**: each cluster's planner change produced **0 diffs
across 220 real federated graphs / 13,143 operations** versus the prior state. (For A3
this gate is essential — the un-gated synthesis drifts ~114 operations; gating it as a
strict fallback brings it to zero.)

## Verification summary

- **federation-gateway-audit:** the five affected suites flip from failing
  to passing — `provides-on-union` (2/2), `provides-on-interface` (2/2),
  `complex-entity-call` (1/1), `partial-union-complex` (5/5),
  `requires-with-argument-conflict` (1/1) — each verified by a clean single-suite run
  against the router built from all five fixes.
  (Note: the audit's all-suites bash runner has a router-startup-timing flake that
  yields false `fetch failed` results when suites are cycled rapidly; it is not used as
  evidence — every suite that flakes there passes in a clean single run, e.g.
  `abstract-types`, `enum-intersection`, and `complex-entity-call` itself.)
- **No regression — the authoritative evidence is celestial:** each planner change
  produced **0 plan diffs across 220 graphs / 13,143 operations**, so the planner emits
  byte-identical plans to stock and no other audit suite's runtime behavior can change.
  Composition changes are additive / parity with alternative federation implementations and guarded by negative tests.
- **Composition test suite (incl. private composition tests):** green
  (1189 tests / 76 files; private tests run from a gitignored copy, never committed).
- **`graphql-go-tools` `plan` + `graphql_datasource` packages:** green.
- **Router e2e (`router-tests/protocol`):** all five new tests pass (combined router).
- **Customer-reported scenarios:** all five reproduce-and-resolve (composition now
  accepts A1/A2/A3; B1 HTTP 500 → 200; B2 now returns spec-correct values matching the
  spec-correct alternative federation behavior, where stock Cosmo and some alternative federation implementations return wrong data).

## Notes for reviewers

- **B2 (highest-severity correctness):** this is the highest-severity fix (silently wrong data).
  Among alternative federation implementations only one gets it right; with this fix Cosmo matches the spec-correct behavior
  and avoids the single-argument collapse.
- **A2 is a deliberate parity stance, not over-permissiveness:** Cosmo's composer was
  *stricter* than alternative federation implementations here. The composition relaxation accepts only what those implementations
  accept (resolve interface-`@provides` `@external` at the implementation level); a
  genuinely-invalid `@provides` (no implementation marks the leaf `@external`) is still
  rejected — covered by a negative test.
