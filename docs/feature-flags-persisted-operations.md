# Feature Flags + Persisted Operations

## Summary

Previously, persisted operations were validated only against the base federated graph schema at upload time, making feature flags and persisted operations incompatible for FF-specific queries. Operations using fields introduced by a feature flag subgraph would be rejected during upload.

This PR makes them work together end-to-end: the controlplane validates against all enabled FF schemas, tracks which schemas each operation is valid on, and dynamically filters the PQL manifest based on feature flag state. The router already handles per-mux schema validation gracefully, and now correctly re-warms all feature flag muxes when the manifest is updated.

## Changes

### Controlplane

**Validation against feature flag schemas** — when publishing persisted operations, the controlplane now validates each operation against the base graph schema first, then falls back to all enabled FF composition schemas. An operation is accepted if valid on at least one. If all operations pass base validation, FF schemas are never fetched (short-circuit).

**Validity tracking** — each operation is stored with a `validOnBaseGraph` boolean and links in a new `persistedOperationToFeatureFlags` junction table recording which FFs validated it.

**Manifest filtering** — the PQL manifest now only includes servable operations: those valid on the base graph, or linked to at least one enabled FF. This is non-destructive — operations stay in the DB and blob storage regardless of FF state.

**Manifest regeneration on FF state changes** — toggling or deleting a feature flag now regenerates the PQL manifest for all affected federated graphs. FF-only operations appear/disappear automatically based on FF state.

**Error messages** — when an operation is rejected, the error lists which schemas were checked (base graph + FF names) and shows the base graph's validation error.

### Router

**Per-mux manifest re-warm** — previously, `SetOnUpdate` only supported a single callback, so only the last-built mux (random feature flag) got its plan cache re-warmed on manifest update. Now each mux registers its own warmup function, and the graph server composes them into a single `SetOnUpdate` callback that runs all warmups sequentially. This provides natural backpressure — at most one warmup runs at a time.

**Per-mux schema validation** — the manifest is shared across all muxes. Operations valid on a FF schema but invalid on the base schema are resolved from the manifest on both muxes, but per-mux schema validation rejects them on the base mux. Warmup skips invalid operations with a warning.

**Config reload** — on config reload, the new graph server registers a new composed callback via `SetOnUpdate`, atomically replacing the old one. No listener lists or cleanup needed.

### Database

New column on `federated_graph_persisted_operations`:
- `valid_on_base_graph` (`boolean NOT NULL DEFAULT true`) — backward compatible, existing operations default to base-valid

New junction table `persisted_operation_to_feature_flags`:
- `persisted_operation_id` → FK cascade to operations
- `feature_flag_id` → FK cascade to feature flags
- All cascade deletes are handled: operation deleted, FF deleted, graph deleted, org deleted

### Migration

Generated via `pnpm db:generate` — adds the column and junction table.

## Behavior Matrix

| Scenario | Manifest includes operation? |
|----------|-----|
| Operation valid on base graph | Always |
| Operation valid on enabled FF only | Yes |
| Operation valid on disabled FF only | No |
| FF disabled | FF-only ops removed from manifest |
| FF re-enabled | FF-only ops restored in manifest |
| FF deleted | FF-only ops removed, junction rows cascade-deleted |
| Base-valid ops when FF changes | Unaffected |
