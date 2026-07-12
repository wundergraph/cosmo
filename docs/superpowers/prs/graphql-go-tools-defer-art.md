# Draft PR: graphql-go-tools

## Title

`feat(resolve): finalize ART and response extensions for @defer`

## Dependency link

Enables the dependent local Cosmo branch `auto-improve-queries-with-defer`, whose two Go modules target this branch's exact pseudo-version. Replace this paragraph with the Cosmo draft-PR URL once both branches are pushed.

## Summary

This change makes deferred execution observable as one request without delaying incremental data delivery.

- Builds one complete static primary-plus-deferred execution tree for query plans.
- Builds a request-local trace tree whose defer groups transition through `planned`, `running`, and terminal `completed`, `error`, or `skipped` states.
- Keeps the initial trace primary-only so the first multipart result can flush immediately.
- Emits an authoritative complete trace and query plan on the existing `hasNext: false` result.
- Accumulates allowed custom response extensions across primary and deferred loaders using the configured request-wide first/last-write policy.
- Re-renders final authorization, rate-limit, and value-completion extension state.
- Preserves deferred GraphQL errors when an origin error produces no deliverable incremental item by reporting them on `completed[].errors`.
- Prevents stale cached load traces from appearing on request-specific skipped branches.

No raw multipart response is buffered, and no metadata-only result is added.

## Wire contract

- Initial result: primary data, primary-only ART, complete static query plan when requested, extensions known so far, and `hasNext: true` when work remains.
- Intermediate results: incremental data/errors and pending/completed bookkeeping; no forced empty `extensions` object.
- Terminal result: cumulative top-level extensions, complete request-local ART, complete query plan when requested, and `hasNext: false`.
- All-pruned execution: one authoritative initial/terminal result with skipped defer descriptors.
- Error with no deliverable patch: no empty `incremental` array; the deferred error and its extensions are retained in `completed[].errors`.

## Review notes

- Runtime defer status is never stored on the cached plan.
- Planned fetch pointers are retained so execution trace data is visible without deep-copying fetches.
- A skipped request-local branch suppresses load trace data, including stale data left on shared fetch objects.
- Reserved response extension keys cannot be supplied by subgraphs.
- Custom extension merging remains shallow and follows loader merge order while holding the shared response lock.

## Verification

Verified from `v2/` on the final branch:

```bash
go test ./pkg/engine/resolve -count=1
go test -race ./pkg/engine/resolve -count=1
go vet ./pkg/engine/resolve
```

Formatting and repeated focused defer runs also passed. Coverage includes composite/nested/parallel plans, request isolation, liveness pruning, live nested-root release, terminal success and error frames, deferred-only custom extensions, first/last-write conflicts, reserved keys, authorization/rate-limit/value-completion finalization, GC/arena behavior, stale trace suppression, and error-without-incremental-data.

## Release/integration

The seven-commit branch is based on `v2.10.0` plus current master and ends at `74918f8b8ad22ee2379cbb7a1439fab79feda38b`. After it is published, the dependent Cosmo branch can resolve the pseudo-version:

`v2.10.1-0.20260711225056-74918f8b8ad2`

Replace that with the tagged release before merging Cosmo if a release is cut first.
