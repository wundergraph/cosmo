# Full ART Support for `@defer` in Router and Studio Playgrounds Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@defer` stream progressively in the router playground and Studio playground while Advanced Request Tracing (ART), query plans, request/response extensions, operation scripts, and existing security rules remain correct through the terminal incremental payload.

**Architecture:** Keep the HTTP response streaming. The router sends the current partial ART in the initial multipart part and an authoritative, cumulative `extensions` object in the existing terminal part (`hasNext: false`). `graphql-go-tools` owns construction of the complete defer-aware execution tree and request-wide response-extension aggregation. A browser-safe shared TypeScript adapter consumes GraphiQL's parsed async iterable, reconstructs progressive result snapshots, and exposes the same canonical active-tab result to both the response editor and ART view. No layer buffers the raw multipart body or delays initial data.

**Tech Stack:** Go, `graphql-go-tools/v2`, GraphQL incremental delivery `deferSpec=20220824`, `multipart/mixed`, React, TypeScript, GraphiQL 3.3.2, `@graphiql/toolkit` 0.9.1, meros, Vitest, Go tests.

---

## Implementation status — 2026-07-12

This plan has now been implemented and committed locally across Cosmo and a dedicated `graphql-go-tools` branch. The implementation is ready for maintainer review, but intentionally has not been pushed. Publishing the upstream branch/release is the dependency-resolution gate before the Cosmo branch can be opened without local `replace` directives.

The detailed checkbox lists below are retained as the original acceptance/design record rather than mechanically rewritten as a progress tracker. The status table and publish gates in this section are the authoritative current state.

| Workstream | Status | Result |
| --- | --- | --- |
| Upstream composite defer plan and request-local ART | Complete | Static plans contain primary, nested, parallel, and pruned defer branches; terminal traces carry request-local `completed`, `error`, or `skipped` status. |
| Request-wide response extensions | Complete | Initial extensions remain early/partial; the existing terminal frame is authoritative and cumulative for ART, query plan, router extensions, and allowed custom extensions. |
| Plan-only defer requests | Complete | `X-WG-Skip-Loader` produces one JSON response with the complete defer plan and zero origin execution. |
| Router wire/protocol coverage | Complete | Raw MIME-part tests cover partial/terminal ART, nested/parallel/pruned/error defers, request and error extensions, reserved keys, first/last write, and final reconstruction. |
| Shared browser incremental adapter | Complete | Cosmo ID/`subPath` and legacy path payloads stream into progressive snapshots with strict protocol errors, cancellation, terminal callbacks, and shallow extension replacement. |
| Router playground | Complete locally | Raw streaming stays with GraphiQL/meros; the active tab owns response/ART state; stale work is suppressed; query plans and scripts use the selected operation; partial/incomplete ART and defer boundaries are explicit. |
| Studio playground | Complete locally | Default validation accepts router `@defer`; multipart bodies remain unconsumed; tokens/feature flags/targets are safe; tab/request lifecycle, selected-operation plans, ART delivery state, and terminal analytics are stream-aware. |
| Defer Advisor hardening | Complete locally | Router authorization/replay bounds are enforced; both clients use exact query operations, validated variables/effective headers, cancellation, stale guards, and permanent-error stopping. |
| Documentation | Complete | Router incremental delivery, extension semantics, configuration/navigation, ART behavior, query-plan behavior, and proxy requirements are documented. |

### Publish and rollout gates

1. Push/open the upstream `graphql-go-tools` branch ending at `74918f8b8ad22ee2379cbb7a1439fab79feda38b`, or cut a release from it.
2. Make `v2.10.1-0.20260711225056-74918f8b8ad2` resolvable, run `go mod tidy` in `router/` and `router-tests/`, and commit any resulting sums. The temporary local `replace` directives used for development have been removed from both modules.
3. Re-run the full CI matrix in the publish environment. The current checkout's repository-wide shared/Studio lint and typecheck paths report the pre-existing generated `@bufbuild/protobuf`/Connect schema-export mismatch. Upstream's full resolve suite also has a pre-existing JSON object key-order assertion failure under local Go 1.25.3, reproduced on the untouched master clone. All changed-path, focused, race, and vet suites are green against those baselines.
4. Verify the first multipart part through the production ingress/CDN. Local writer and real protocol tests prove router flushing, but only the deployed proxy path can rule out external buffering.

### Verification evidence

The latest scoped verification on the final sources produced:

| Area | Result |
| --- | --- |
| `graphql-go-tools/v2` | All defer/response-accumulator tests passed 20 times, the same focused suite passed under `-race`, and `go vet ./pkg/engine/resolve` passed. The full package run reaches the unrelated `TestInputTemplate_Render/...missing_value_for_context_variable` key-order assertion failure; the exact failure reproduces on the untouched master clone. |
| Router core | Focused defer, advisor, plan-only, and multipart tests passed. |
| Router protocol | Real-wire defer ART/reconstruction/fixture tests, race tests, and `go vet ./protocol` passed after the final engine fixes. They cover early flush, terminal ART, extensions, errors, pruning, and reconstruction. |
| Shared adapter | 33 focused incremental-delivery/schema tests passed. The adapter had also passed its full 63-test suite earlier; the current all-package script stops in unrelated generated Connect-schema import lint before running tests. |
| Router playground | 10 files / 63 tests passed; the production `build:router` completed and regenerated `router/internal/graphiql/graphiql.html`. |
| Studio playground | 10 files / 64 focused tests passed. The full run reaches 80 passing tests and only the pre-existing generated Connect/protobuf lint-page test fails; scoped ESLint passed and filtering TypeScript diagnostics to changed modules produced no errors. |
| Repository hygiene | `git diff --check` and `git diff --cached --check` passed; both local `go.mod` files are free of temporary `replace` directives. |
| Independent review | Dedicated router, Studio, shared UI-contract, and upstream engine reviews found no remaining actionable correctness blocker. |

The repository-wide generated Connect/protobuf mismatch, upstream master key-order assertion, and production-ingress buffering check are recorded as gates rather than silently classified as passing.

### Completed local commit split

Keep changes reviewable with the following Cosmo commits (the existing router advisor, shared adapter, protocol, docs-site, and dependency commits are already split in history):

1. `91ac4d35d feat(playground): add defer advisor client`
2. `79041832d feat(playground): stream incremental executions`
3. `d536013eb feat(playground): render defer-aware ART`
4. `7026613dc feat(playground): integrate defer streaming tools`
5. `d3baedbf3 feat(studio): add defer advisor client`
6. `ded4c654f feat(studio): preserve multipart playground responses`
7. `4370db579 feat(studio): track incremental execution lifecycle`
8. `d4864185d feat(studio): request selected defer query plans`
9. `dca90269e feat(studio): render defer-aware ART`
10. `0b4d66cf4 feat(studio): integrate defer playground support`
11. `bf12d46e8 build(router): regenerate embedded playground`
12. `docs(router): plan defer ART rollout` (this document, RFC, and both draft-PR bodies)

The upstream repository is split into seven local commits ending at `74918f8b`; the Cosmo dependency commit `4995f3cc5` targets its exact pseudo-version. The slices above keep transport, execution lifecycle, presentation, surface integration, and generated output independently reviewable.

### Deliberate follow-up, not a support blocker

Both playgrounds still mirror their large legacy ART parser and view-model types. The new wire fixtures cover nullable/root `fetches`, root `Single`, nested composite wrappers, skipped descendants, and no-timing plan traces, but the next maintainability step should move the v1 ART wire contract and pure normalizer into `@wundergraph/cosmo-shared`, leaving thin surface-specific rendering tests. A GraphiQL major upgrade and CI-hosted Playwright coverage remain independent follow-ups; neither is required for the implemented streaming contract.

---

## Executive decision

The recommended protocol is:

1. Keep emitting the initial data and primary-only trace immediately. When requested, emit the complete static query plan immediately because it does not depend on execution.
2. Execute deferred groups exactly as today, without buffering the stream.
3. Put a complete cumulative trace, the complete query plan when requested, and request-wide merged response extensions on the **same last incremental part** that already carries `hasNext: false`.
4. Let clients shallow-merge top-level `extensions`; the terminal `trace` replaces the partial initial trace, while the terminal `queryPlan` reasserts the already-complete planned value.
5. Feed every reconstructed result snapshot into GraphiQL. Use the active GraphiQL tab response as the ART source of truth, rather than maintaining an unrelated response side channel.

This gives ART complete information without sacrificing time to first result, adding a metadata-only part, or inventing client-side trace-delta semantics. The only intentional duplication is that ART/query-plan metadata can appear once partially and once completely. Both are opt-in debugging features, so that is the right latency/complexity trade-off.

## Evaluation baseline

- The worktree was synchronized before evaluation, as requested.
- `origin/main` was fetched at `935b7925b88a2d8a76970b0989a5e2a0a111d2a1`.
- The current branch now contains merge commit `ebd3f8315dbc5caf6f6e1931c56ae0922d0fb37d`, whose parents are the previous branch head and that `origin/main` commit.
- All pre-existing staged, unstaged, and untracked ART/defer work was preserved across the merge.
- Router and router-tests now target `github.com/wundergraph/graphql-go-tools/v2 v2.10.1-0.20260711225056-74918f8b8ad2`; that pseudo-version deliberately remains unresolvable until the upstream branch is published.
- Latest `graphql-go-tools` master was cloned to `/tmp` at `b0d54be40c3d6388503a395ead140ae46f0a4f58` (2026-07-09, release 2.10.0) before evaluation. The required engine fixes were absent, so they were implemented on the dedicated local branch `feat/defer-art-extensions` at `/Users/jens/.superset/worktrees/graphql-go-tools/defer-art-extensions` and mirrored in a writable temporary clone for validation. Both upstream working copies are clean; nothing was pushed.
- Latest GraphiQL was also inspected. GraphiQL 5.2.4 / `@graphiql/react` 0.37.7 understands the newer `pending`/`id`/`subPath` protocol, while Cosmo's installed GraphiQL 3.3.2 / React 0.22.4 only understands the older path-based form. A major GraphiQL upgrade would not by itself connect the merged response to ART, fix Studio's body consumption, fix scripts/analytics, or add the missing server trace.

## Pre-implementation gap analysis

This section records the state found during evaluation and explains why each implemented workstream was necessary. Current status is authoritative in the table at the top of this document.

### End-to-end flow

```text
Browser request
  X-WG-Trace + optional signed X-WG-Token
  Accept: application/json, multipart/mixed
                |
                v
Router prehandler -> DeferResponsePlan
                |
                v
graphql-go-tools
  initial loader -> initial data + partial extensions -> flush
  defer loaders  -> incremental/completed/hasNext    -> flush each
                |
                v
HttpDeferWriter
  buffers one JSON envelope only
  writes boundary + envelope + next boundary
  http.Flusher.Flush()
                |
                v
@graphiql/toolkit + meros -> async iterable of parsed part batches
                |
                +--> router playground prototype merges response data
                |      but ART state is set to null
                |
                +--> Studio calls response.json(), throws, and loses stream
```

### Router transport

The staged `router/core/defer_response_writer.go` is on the correct path:

- It holds only the current JSON envelope in memory, not the full response.
- It writes `multipart/mixed; deferSpec=20220824; boundary="graphql"`.
- It disables proxy buffering and flushes each part.
- It eagerly writes the next boundary before flushing so meros can release the current part immediately.
- It does not inspect, remove, or rewrite `extensions`; it will transport terminal extensions correctly once the engine renders them.

The response writer is therefore **not** the place to synthesize ART or merge extensions. It has opaque bytes and no fetch-tree state.

### ART and built-in top-level extensions

`graphql-go-tools` currently calls `Resolvable.printExtensions` for normal responses and the initial defer response. It can render:

1. `authorization`
2. `rateLimit`
3. `queryPlan`
4. `trace`
5. `valueCompletion`
6. allowed custom subgraph extension keys

For defer, the initial call receives only `response.Response.Fetches`, so `trace` and `queryPlan` currently describe only the primary fetch tree. Deferred fetches subsequently populate their own trace objects in memory, but `ResolveDeferBatch` never calls `hasExtensions` or `printExtensions`. The terminal frame therefore has no complete trace or query plan. The implementation should split those inputs: query-plan rendering always receives the complete planned tree, while trace rendering receives the primary tree during an active stream and the request-local execution tree on the terminal frame.

### The three meanings of `extensions`

They need separate acceptance tests:

| Extension category              | Current defer behavior                                                                                                                                                                                                                                                                                | Required work                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Client request `extensions`     | Already copied into `resolve.Context.Extensions` and inserted into every subgraph request body, including requests made by defer-group loaders.                                                                                                                                                       | Preserve and add a regression test.                               |
| `errors[].extensions`           | Kept as part of initial errors, `incremental[].errors`, or `completed[].errors`, subject to existing error-propagation policy.                                                                                                                                                                        | Preserve and add nested/error-path coverage.                      |
| Top-level response `extensions` | Initial-loader values can appear in the initial part. Deferred-loader custom extensions are captured, assigned to the resolvable, then dropped because defer batches never print extensions. ART/query plan are partial. Later rate-limit/value-completion state is not guaranteed to be represented. | Aggregate request-wide state and emit a complete terminal object. |

Custom subgraph response extensions are shallow, top-level values. The allow list and reserved built-in keys already work. `first_write` and `last_write` currently follow the order in which loader merge phases acquire the shared response lock. That winner can be completion-order dependent for parallel fetches. The defer implementation should preserve that same request-wide write order, rather than merging independent group summaries after they finish; deterministic tests must gate merge order with channels.

### Router playground

The staged prototype already:

- returns `multipart/mixed` responses to GraphiQL without calling `response.json()`;
- reconstructs `pending[id].path` plus `incremental[id].subPath` snapshots;
- shallow-merges top-level extensions;
- measures first-result and total duration.

It is not complete:

- The multipart branch calls `onFetch(null, ...)`, so `TraceContext.response` becomes the string `"null"`.
- Reconstructed snapshots update GraphiQL's response editor, but never update ART.
- Multipart post-operation scripts never run.
- The configured `input.fetch` is not used for normal operation execution.
- The merger has no tests, treats `data: null` as absent, silently applies unknown IDs at the root, and has incomplete `items`, legacy-format, array, cancellation, and subscription behavior.
- The active GraphiQL tab already owns the canonical response, but ART reads a duplicate response state; tab switching can make the two disagree.

The same React source builds the published standalone playground and the router's embedded playground. `router/internal/graphiql/graphiql.html` is generated by `pnpm --filter @wundergraph/playground build:router` and must not be hand-edited.

### Studio playground

Studio has four sequential blockers:

1. Its default client-side schema validation rejects `@defer` because the control-plane client schema does not contain the executable directive.
2. If validation is disabled, `graphiQLFetch` unconditionally calls `await response.clone().json()`. A multipart response waits for completion and then throws; the catch path returns a synthetic JSON network error instead of the stream.
3. Studio has no merger for the router's 20220824 `pending`/`id`/`subPath` format. The installed GraphiQL merger applies these patches at the wrong location because it expects an entry-level `path`.
4. ART reads the same kind of duplicate response state as the router playground, so merely porting the transport prototype would still leave ART disconnected.

Studio must also attach the signed graph token for every non-empty, case-insensitive `X-WG-Trace` option, not only the exact value `"true"`. It must never attach that token or run the defer advisor when the selected target is a subgraph.

### Deferred query-plan requests

Both playgrounds request a plan with:

```http
X-WG-Include-Query-Plan: true
X-WG-Skip-Loader: true
```

For a `DeferResponsePlan`, current behavior is broken in two places:

- `ResolveGraphQLDeferResponse` wraps all rendering inside `if !SkipLoader`, so it emits no useful body.
- `PlanWrapper.Marshal` returns `defer marshal unsupported yet`.

Plan-only requests should not be streams because they execute no origins. They should return one ordinary JSON GraphQL response with `data: null` and a complete composite `extensions.queryPlan`. Multipart `Accept` must not be required on that path.

## Required wire contract

For an ART-enabled request with at least one live defer, the raw parts should have this shape:

```json
// Initial part: sent immediately
{
  "data": { "fast": "value" },
  "extensions": {
    "trace": { "version": "1", "fetches": "primary tree only" },
    "queryPlan": "complete planned primary + deferred tree when requested",
    "initialSubgraphKey": "initial value"
  },
  "pending": [{ "id": "1", "path": ["slow"], "label": "Slow" }],
  "hasNext": true
}
```

```json
// Zero or more intermediate parts
{
  "incremental": [{ "id": "1", "data": { "field": "value" } }],
  "completed": [{ "id": "1" }],
  "pending": [{ "id": "2", "path": ["slow", "nested"] }],
  "hasNext": true
}
```

```json
// Existing last data/error part; no additional metadata-only part
{
  "incremental": [{ "id": "2", "data": { "field": "final" } }],
  "completed": [{ "id": "2" }],
  "extensions": {
    "trace": { "version": "1", "fetches": "complete initial + deferred execution tree" },
    "queryPlan": "complete plan when requested",
    "authorization": "final request-level state when enabled",
    "rateLimit": "final request-level state when enabled",
    "valueCompletion": "all accumulated entries when enabled",
    "initialSubgraphKey": "initial value",
    "deferredSubgraphKey": "deferred value"
  },
  "hasNext": false
}
```

Rules:

- Initial extensions stay for backward compatibility and immediate partial ART.
- Terminal extensions are authoritative and cumulative, not deltas.
- The query plan is complete whenever it is emitted because it is static. The initial trace is partial only while live deferred work remains.
- The complete trace uses request-local defer wrappers with `completed`, `error`, or `skipped` status. It includes planned-but-pruned groups as `skipped` with no load timing; runtime status is never stored on a cached plan.
- The terminal contract applies to both successful and completed-with-error final frames.
- A request with no live deferred work remains a single initial/terminal part with `hasNext: false`; that one frame must contain the authoritative trace, complete query plan when requested, and cumulative extensions.
- Cancellation or a broken connection may prevent a terminal part; clients must mark that trace incomplete rather than claim completeness.
- Request extensions and GraphQL error extensions do not move into this aggregate; they retain their existing locations.

## Why this approach is preferred

| Approach                                                    |                                                        Streaming latency |                   Server complexity |                                                           Client complexity | Decision                      |
| ----------------------------------------------------------- | -----------------------------------------------------------------------: | ----------------------------------: | --------------------------------------------------------------------------: | ----------------------------- |
| Cumulative extensions on existing terminal part             |                                                                Preserved | Moderate, correctly owned by engine |                                                  Simple shallow replacement | **Recommended**               |
| Per-part trace and extension deltas                         |                                                                Preserved |                                High | High; clients must understand trace topology and first/last-write semantics | Reject                        |
| Extra metadata-only terminal part                           | Adds a part and requires changing which data frame says `hasNext: false` |                            Moderate |                                                                    Moderate | Reject                        |
| Buffer all parts, inject complete ART into initial response |                                       Loses the main benefit of `@defer` |                   Superficially low |                                                                         Low | Reject                        |
| Upgrade GraphiQL first                                      |                                                            Still streams |       Major UI/dependency migration |                                Still needs an ART bridge and server changes | Follow-up, not a prerequisite |

The frontend adapter belongs **after** `createGraphiQLFetcher`: the raw fetch function should handle headers, auth, validation, pre-scripts, and HTTP status, then return the body untouched. The toolkit/meros layer should parse MIME framing. The shared adapter should merge parsed results, report progress, and run terminal callbacks. Parsing MIME independently in each playground would duplicate protocol and boundary handling.

## Scope boundaries

- This plan covers multipart HTTP incremental delivery. The router currently uses SSE for a different subscription path; adding SSE support for deferred queries is not required.
- Do not make ART wait for the stream before showing anything. The initial primary trace is useful and should be labeled as partial while deferred work is active.
- Do not implement response-extension aggregation in `HttpDeferWriter` or post-process serialized JSON in the router.
- Do not block this feature on a GraphiQL 5 migration. Track that migration separately after the shared adapter establishes tests and behavior.
- The staged Defer Advisor is distinct from ordinary ART-on-defer. Its production authorization and replay safety issues are included as a release-hardening task because the current Studio branch invokes it automatically.

---

## Task 1: Add a defer-aware composite execution tree upstream

**Files:**

- Create: `graphql-go-tools/v2/pkg/engine/resolve/defer_execution_tree.go`
- Modify: `graphql-go-tools/v2/pkg/engine/resolve/response.go`
- Modify: `graphql-go-tools/v2/pkg/engine/resolve/fetchtree.go`
- Test: `graphql-go-tools/v2/pkg/engine/resolve/defer_execution_tree_test.go`
- Test: `graphql-go-tools/v2/pkg/engine/resolve/defer_tree_test.go`

- [ ] Write failing tests that build primary, nested sequential defer, and sibling parallel defer trees and assert one planned composite tree contains every fetch exactly once in execution topology order.
- [ ] Add a pure converter from `DeferTreeNode` to `FetchTreeNode`. `Sequence` and `Parallel` recursively preserve their kind. Each `Single` becomes a new one-child `Sequence` wrapper that carries defer metadata and points at the original group's fetch tree as its child; do not introduce a new fetch-tree kind.
- [ ] Add `GraphQLDeferResponse.PlannedExecutionTree()` that returns `Sequence(primary, convertedDeferTree)` when deferred work exists and the primary tree unchanged otherwise.
- [ ] Add a request-local `DeferExecutionTraceTree` with `Root`, an `id -> wrapper` index, and status transitions `planned -> running -> completed | error` plus `skipped`. Build fresh wrapper nodes per request; never store runtime status on cached/shared plan nodes.
- [ ] When top-level or nested liveness pruning occurs, mark the rejected wrapper and its descendants `skipped`. At terminal serialization, a skipped wrapper remains visible with no load timing and must never look like an executed fetch.
- [ ] Preserve the original primary/group fetch-node pointers beneath the request-local wrappers so trace objects populated during execution are visible at the end. Do not deep-copy fetches or trace state.
- [ ] Add optional defer metadata (`id`, `label`, response `path`, and trace-only execution `status`) to `FetchTreeTraceNode` and descriptor metadata to `FetchTreeQueryPlanNode`. Existing non-defer JSON must remain byte-for-byte compatible aside from omitted zero-value fields.
- [ ] Update `PlanPrinter` to print a labeled defer wrapper without changing how existing Single/Sequence/Parallel nodes print.
- [ ] Make the composite root carry `NormalizedQuery`, so full query-plan JSON has the same normalized-query behavior as synchronous plans.
- [ ] Make `GraphQLDeferResponse.QueryPlanString()` and a new structured `QueryPlan()` use this canonical tree instead of independently iterating `Defers`.
- [ ] Test nil primary/defer nodes, one defer, nested defer, parallel defer, explicit request-local skipped status, and status isolation between two concurrent requests sharing one cached plan.
- [ ] Run `go test ./pkg/engine/resolve -run 'Test.*Defer.*ExecutionTree|Test.*DeferTree'` from the upstream `v2` module and confirm the new tests pass.

Expected invariant:

```go
planned := response.PlannedExecutionTree()       // immutable query-plan view
runtime := response.NewDeferExecutionTraceTree() // request-local status wrappers
runtime.MarkSkipped(deferID)
// runtime.Root still points at the original fetch objects, but status is never
// written back to the cached plan.
```

## Task 2: Aggregate all top-level response extensions across defer loaders upstream

**Files:**

- Create: `graphql-go-tools/v2/pkg/engine/resolve/response_extensions.go`
- Modify: `graphql-go-tools/v2/pkg/engine/resolve/loader.go`
- Modify: `graphql-go-tools/v2/pkg/engine/resolve/resolve.go`
- Modify: `graphql-go-tools/v2/pkg/engine/resolve/resolvable.go`
- Test: `graphql-go-tools/v2/pkg/engine/resolve/resolve_defer_extensions_test.go`
- Test: `graphql-go-tools/v2/pkg/engine/resolve/resolve_defer_errors_test.go`
- Test: `graphql-go-tools/v2/pkg/engine/resolve/resolve_defer_parallel_test.go`

- [ ] First write raw-envelope tests for: initial primary-only trace plus complete planned query plan, intermediate part without a forced extension object, and terminal cumulative trace containing primary and deferred fetches.
- [ ] Add an all-pruned test in which the initial part is also terminal. Assert `hasNext: false`, a complete query plan, an authoritative trace whose defer wrappers are `skipped`, and cumulative initial-loader extensions; no defer batch should run.
- [ ] Add failing tests for a custom extension returned only by a deferred subgraph; it must appear in terminal top-level `extensions`.
- [ ] Add failing conflict tests spanning the primary loader and parallel defer loaders for `first_write` and `last_write`. Control merge order deterministically with channels, not timing sleeps, and assert the documented lock-acquisition/write-order winner.
- [ ] Add failing tests for allow-listed keys, allow-all, disabled propagation, and attempts by subgraphs to supply reserved keys (`trace`, `queryPlan`, `authorization`, `rateLimit`, `valueCompletion`).
- [ ] Introduce one request-scoped extension accumulator shared by the initial loader and every defer-group loader. Record extension objects during each loader merge phase while the common `DataBuffer` lock is held; do not append whole group summaries later.
- [ ] Keep arena-backed values alive until the stream completes and reset all accumulator state between client requests.
- [ ] Give the initial render an immutable snapshot of extensions collected so far, preserving current early behavior; test that later accumulator writes cannot mutate already flushed bytes.
- [ ] Refactor `hasExtensions`/`printExtensions` to receive separate render inputs, for example `ExtensionRenderTrees{QueryPlan, Trace}`. Initial rendering always gets the complete planned query-plan tree. It gets the primary trace tree while live work remains, or the authoritative request-local trace tree when the initial frame is terminal.
- [ ] Compute top-level liveness before printing initial extensions. If no live defer remains, render cumulative terminal extensions on that initial frame; do not rely solely on `ResolveDeferBatch` for finalization.
- [ ] Change `ResolveDeferBatch` so the frame that decrements `outstanding` to zero renders cumulative top-level extensions before `hasNext: false`, using the complete planned query-plan tree and request-local execution trace tree.
- [ ] Apply the same terminal-extension logic to `ResolveDeferError`; a final deferred fetch/render error must not suppress full trace and previously collected extensions.
- [ ] In `ResolveDeferBatch`, mark the current wrapper `completed` or `error`, then recursively mark every direct-child subtree absent from `liveChildren` as `skipped`, before checking or rendering the terminal frame.
- [ ] In `ResolveDeferError`, mark the current wrapper `error` and recursively mark every unreleased descendant `skipped` before decrementing `outstanding`; this covers hard parent fetch failures that never run ordinary child-liveness pruning.
- [ ] Assert every defer wrapper is terminal (`completed`, `error`, or `skipped`) before serializing an authoritative trace; a `planned`/`running` wrapper on a `hasNext: false` frame is an engine invariant failure.
- [ ] Add raw-envelope status tests for a hard parent fetch error with nested children, parent null/render failure that rejects some children, final parallel-sibling error, and the invariant that a terminal trace contains no `planned`/`running` wrapper.
- [ ] Re-render request-level `authorization`, `rateLimit`, and accumulated `valueCompletion` state terminally. Track `skipValueCompletion` across all loaders with request-wide semantics instead of letting the last group overwrite the decision.
- [ ] Ensure a non-ART request with no configured/collected extension data does not gain an empty `extensions` object.
- [ ] Add an arena/GC stress test for accumulated extension objects and the request-local wrapper tree.
- [ ] Run `go test ./pkg/engine/resolve` and `go test -race ./pkg/engine/resolve`; confirm no races under parallel defer execution.

The accumulator must preserve the current shallow conflict algorithm. It must not deep-merge nested extension values.

## Task 3: Make defer plan-only requests synchronous and complete

**Files:**

- Modify upstream: `graphql-go-tools/v2/pkg/engine/resolve/response.go`
- Modify: `router/core/graphql_handler.go`
- Modify: `router/core/graphql_prehandler.go`
- Modify: `router/core/plan_generator.go`
- Test: `router/core/plan_generator_test.go`
- Test: `router-tests/operations/query_plans_test.go`

- [ ] Add a failing router test for `@defer` plus `X-WG-Include-Query-Plan: true` and `X-WG-Skip-Loader: true`. Assert `Content-Type: application/json`, `data: null`, a full primary-plus-deferred query plan, and zero subgraph requests.
- [ ] Add a trace-plus-query-plan `SkipLoader` test: every planned fetch node is present, no node has load timing, the body is JSON, and no origin runs.
- [ ] Add a test that the same plan-only request succeeds with `Accept: application/json` and does not require multipart.
- [ ] Add a control test that a real deferred execution without multipart acceptance is still rejected with `DEFER_BAD_HEADER`.
- [ ] Implement `PlanWrapper.Marshal` for `DeferResponsePlan` using the structured composite query plan.
- [ ] Fill the defer branches in `graphql_prehandler.go`: attach the normalized query to the composite plan and use the complete pretty plan for plan logging.
- [ ] Exclude `SkipLoader` defer requests from the multipart-acceptance check.
- [ ] In `graphql_handler.go`, branch before `GetDeferResponseWriter`: shallow-copy the base `GraphQLResponse`, replace its fetch tree with `PlannedExecutionTree()`, and resolve it through the ordinary synchronous JSON path. Because `SkipLoader` is true, no origin executes and `Resolvable.Resolve` emits `data: null` plus extensions.
- [ ] Keep actual defer execution on `ResolveGraphQLDeferResponse` and `HttpDeferWriter`; do not make all defer requests synchronous.
- [ ] Run the router core plan tests and `router-tests/operations` query-plan tests.

## Task 4: Release and integrate the upstream engine change

**Files:**

- Modify: `router/go.mod`
- Modify: `router/go.sum`
- Modify: `router-tests/go.mod`
- Modify: `router-tests/go.sum`
- Test: `router-tests/protocol/defer_art_test.go`
- Test: `router-tests/protocol/defer_test.go`
- Test: `router-tests/protocol/extension_forwarding_test.go`

- [ ] Develop Tasks 1-2 against a fresh branch based on `/tmp/graphql-go-tools-art-defer.HZBPYw` or a new clone of latest master; do not vendor ad-hoc engine files into Cosmo.
- [ ] Open the upstream change with raw wire-contract tests and obtain a tagged `graphql-go-tools/v2` release.
- [ ] For local Cosmo integration before release, use an uncommitted Go workspace or temporary `replace` directive; remove it before finalizing.
- [ ] Update both Cosmo Go modules to the released engine version, then run `go mod tidy` once from `router/` and once from `router-tests/`.
- [ ] Add `router-tests/protocol/defer_art_test.go` that parses every MIME part and asserts the initial trace is partial, the terminal trace is complete, and every executed primary/deferred fetch occurs exactly once.
- [ ] Cover nested sequential, sibling parallel, pruned, null-propagated, and completed-with-error defers.
- [ ] Extend `reconstructDeferResponse` in `router-tests/protocol/defer_test.go` to shallow-merge top-level part extensions, while retaining separate assertions on raw part placement.
- [ ] Extend `extension_forwarding_test.go` with initial-only, deferred-only, cross-phase first/last conflict, allow-list, reserved-key, and request-isolation cases.
- [ ] Add a request-extension forwarding assertion that every deferred subgraph call receives the original client `extensions` object.
- [ ] Add error-extension assertions for both `incremental[].errors` and `completed[].errors`.
- [ ] Re-run request-tracing security tests to prove defer does not bypass dev/force/signed-token authorization.

## Task 5: Lock down multipart streaming at the router boundary

**Files:**

- Modify: `router/core/defer_response_writer.go`
- Create: `router/core/defer_response_writer_test.go`
- Test: `router-tests/protocol/defer_test.go`
- Create: `router-tests/protocol/defer_streaming_test.go`

- [x] Move/duplicate the current MIME negotiation coverage into a dedicated writer test file and cover media-range specificity, wildcards, parameters, q-values, `q=0`, casing, and missing `Accept`.
- [x] Test exact bytes for first part, subsequent part, terminal part with extensions, and closing boundary.
- [x] Use a recording `http.Flusher` to assert the first flush already contains the next boundary, allowing meros to release the part.
- [ ] Add a real `httptest.Server`/pipe test that reads and decodes the initial part before a channel releases a slow deferred resolver. Avoid `io.ReadAll` until after the initial assertion.
- [ ] Assert `X-Accel-Buffering: no`, no gzip buffering, cancellation propagation, and exactly one `Complete()` close.
- [x] Keep the writer extension-agnostic; the terminal extension test should prove transparent transport only.

## Task 6: Build one tested browser-side incremental result adapter

**Files:**

- Create: `shared/src/playground/incremental-delivery.ts`
- Create: `shared/src/playground/defer-schema.ts`
- Create: `shared/test/incremental-delivery.test.ts`
- Create: `shared/test/defer-schema.test.ts`
- Modify: `shared/package.json`
- Modify: `playground/package.json`
- Modify: `studio/package.json`
- Modify: `pnpm-lock.yaml`
- Remove after migration: `playground/src/components/playground/incremental-merge.ts`
- Remove after migration: `playground/src/components/playground/fetch-timing.ts`

- [ ] Add browser-safe subpath exports `@wundergraph/cosmo-shared/playground/incremental-delivery` and `@wundergraph/cosmo-shared/playground/defer-schema`. Preserve an explicit `.` export for every existing shared entry so adding the export map cannot break current consumers; do not import the server-heavy shared root from browser bundles.
- [ ] Define typed `InitialIncrementalPayload`, `IncrementalEntry`, `CompletedEntry`, `PendingEntry`, `IncrementalSnapshot`, `IncrementalProgress`, and a local structural `FetcherLikeResult` union. Do not add a GraphiQL runtime dependency to the shared package merely for `FetcherReturnType`.
- [ ] Write failing tests before moving the staged prototype: initial data, nested `pending` IDs, `subPath`, aliases, numeric list paths, root defer, sibling/parallel arrival, and multiple meros parts in one yielded batch.
- [ ] Test both router 20220824 ID-based entries and legacy path-based entries so the published playground remains compatible with other GraphQL servers.
- [ ] Test `data: null` using property presence rather than truthiness; test `items`, insertion indexes, empty arrays, and null list elements.
- [ ] Throw a typed `IncrementalProtocolError` for unknown pending IDs, duplicate live pending IDs, duplicate completion, or patches received after completion. Terminate that adapter iteration, call `onError`/`onIncomplete`, and never merge the invalid patch at the data root.
- [ ] Accumulate initial, incremental, and completed errors without losing each error's `extensions`.
- [ ] Shallow-merge top-level and incremental-entry extension values. A terminal `extensions.trace` must replace the initial trace value, while unrelated earlier keys remain.
- [ ] Only flatten arrays yielded by an incremental async iterable after detecting incremental protocol fields. Pass plain promises, ordinary execution results, batched non-incremental results, Observables, and subscription payloads through unchanged.
- [ ] Preserve backpressure: consume and yield one parsed part at a time. Retain only the assembled result, pending-ID map, errors, and small progress metadata—not raw multipart bytes.
- [ ] Expose callbacks for `onStart`, `onFirstResult`, `onSnapshot`, `onComplete`, `onIncomplete`, `onError`, and `onCancel`, including `hasNext`, part count, first-result time, and total duration.
- [ ] Guarantee `onComplete` runs exactly once for a plain non-incremental JSON result or an incremental stream that explicitly delivers `hasNext: false`. If an incremental iterable exhausts while its last state is `hasNext: true`, raise a premature-EOF `IncrementalProtocolError`, call `onIncomplete`/`onError`, and never run completion scripts or analytics.
- [ ] Yield the terminal assembled snapshot before starting non-blocking `onComplete` side effects, and isolate side-effect rejection so scripts/analytics cannot delay or replace the GraphQL result.
- [ ] Add `withDeferDirective(schema)` using the router-compatible signature (`label: String`, `if: Boolean! = true` on fragment spreads and inline fragments). Make it idempotent and leave subgraph schemas unchanged when the caller opts out.
- [ ] Run shared lint, tests, and build. Inspect the emitted subpath to ensure it has no Node-only imports.

Suggested public shape:

```ts
export type IncrementalObserver = {
  onSnapshot?(result: ExecutionResult, progress: IncrementalProgress): void;
  onComplete?(result: ExecutionResult, progress: IncrementalProgress): void | Promise<void>;
  onIncomplete?(error: IncrementalProtocolError, progress: IncrementalProgress): void;
  onError?(error: unknown, progress: IncrementalProgress): void;
};

export function observeIncrementalResult(result: FetcherLikeResult, observer: IncrementalObserver): FetcherLikeResult;
```

## Task 7: Refactor the router playground around the shared adapter

**Files:**

- Modify: `playground/src/components/playground/index.tsx`
- Modify: `playground/src/components/playground/types.ts`
- Modify: `playground/src/components/playground/trace-view.tsx`
- Create: `playground/src/components/playground/playground-fetcher.ts`
- Create: `playground/src/components/playground/use-playground-execution.ts`
- Create: `playground/src/components/playground/playground-fetcher.test.ts`
- Create: `playground/src/components/playground/use-playground-execution.test.tsx`
- Create: `playground/vitest.config.ts`
- Modify: `playground/package.json`
- Modify generated: `router/internal/graphiql/graphiql.html`

- [ ] Add `vitest`, `jsdom`, and `@testing-library/react` development dependencies, a `test` script, and `playground/vitest.config.ts`; write a delayed `ReadableStream`/multipart fixture before refactoring.
- [ ] Move raw HTTP work to `playground-fetcher.ts`: transform/substitute/validate headers, run pre-operation scripts, call `input.fetch ?? globalThis.fetch`, report status, and immediately return the `Response` without cloning or consuming its body.
- [ ] Put adapter callbacks, generation/fingerprint state, timing, and terminal side effects in `use-playground-execution.ts`, keeping the already-large `index.tsx` as wiring rather than adding another lifecycle implementation inline.
- [ ] Detect media types case-insensitively through parsed `Content-Type`; do not rely on a case-sensitive substring.
- [ ] Wrap `createGraphiQLFetcher` results with the shared adapter. Yield every assembled snapshot to GraphiQL as a normal result so the old built-in merger does not reapply ID-based patches.
- [ ] Run post-operation scripts once after the terminal snapshot is yielded, using the final assembled result. Do not run them on the initial part, every patch, premature EOF, cancellation, or introspection.
- [ ] Remove `onFetch(null)` and the duplicate response state. Populate `TraceContext.response`, `query`, and `headers` from `tabsState.tabs[tabsState.activeTabIndex]`; GraphiQL already clears and updates that response with a query-generation guard.
- [ ] Track stream progress separately from response data, keyed by the operation/query/variables/headers fingerprint so switching tabs cannot show another operation's streaming state.
- [ ] Reset timing/progress at execution start, record first complete incremental part separately from total duration, and ignore callbacks from superseded generations.
- [ ] Make trace-header detection case-insensitive and accept every non-empty router tracing option.
- [ ] Make the schema augmentation idempotent after introspection, so validation and editor diagnostics accept `@defer` even if an older router omits it.
- [ ] Test that initial data reaches GraphiQL before the delayed part, initial trace is visible as partial, terminal trace replaces it, post scripts run once, and the configured custom fetch function handles the operation.
- [ ] Test tab switching and starting a second request before the first finishes; the older stream must not overwrite active status, timing, or ART.
- [ ] Regenerate the embedded HTML with `pnpm --filter @wundergraph/playground build:router`; never patch the generated blob manually.
- [ ] Run the playground source tests/build and the router embedded-playground smoke tests.

## Task 8: Add real defer streaming to Studio

**Files:**

- Modify: `studio/src/pages/[organizationSlug]/[namespace]/graph/[slug]/playground.tsx`
- Modify: `studio/src/components/playground/types.ts`
- Modify: `studio/src/components/playground/trace-view.tsx`
- Create: `studio/src/components/playground/playground-fetcher.ts`
- Create: `studio/src/components/playground/use-playground-execution.ts`
- Create: `studio/src/components/playground/playground-fetcher.test.ts`
- Create: `studio/src/components/playground/use-playground-execution.test.tsx`
- Create: `studio/src/__tests__/playground-incremental-delivery.test.tsx`
- Modify: `studio/package.json`

- [ ] Add tests proving default client validation accepts valid `@defer` on inline fragments and fragment spreads, while invalid directive placement still fails.
- [ ] Apply `withDeferDirective` only for federated graph/router and feature-flag targets. Do not advertise router defer execution while Studio is directly targeting a subgraph.
- [ ] Add the same delayed multipart test used for the router playground and prove Studio never invokes `Response.json()` on a multipart body.
- [ ] Move Studio's raw fetch into `playground-fetcher.ts` and return all bodies untouched; keep header substitution, validation, pre-scripts, feature-flag propagation, and immediate HTTP status reporting.
- [ ] Attach `X-WG-Token` only for federated graph/router targets when a case-insensitive `X-WG-Trace` header has any non-empty value recognized by the router, including exclusion options. Never send the graph token to a subgraph URL.
- [ ] Put shared-adapter wrapping, progressive snapshots, generation/fingerprint state, timing, analytics, and terminal side effects in `use-playground-execution.ts`; keep the 1,300-line page focused on state and component wiring.
- [ ] Run post-operation scripts and the `cosmo_studio_query_executed` PostHog event once at terminal completion. Determine `query_success` from the final assembled errors, not an initial part.
- [ ] Derive ART input from the active GraphiQL tab and remove the duplicate `response` state. This also fixes stale ART when switching tabs.
- [ ] Add operation-generation/cancellation guards so a late old stream cannot update ART, timing, scripts, analytics, or advisor annotations for a newer operation.
- [ ] Keep the existing query-plan effect on JSON; Task 3 makes defer plan-only responses synchronously compatible with its `response.json()` call.
- [ ] Test JSON, multipart, validation error, HTTP error, iterator error, cancellation, tab switch, feature-flag, and direct-subgraph modes.
- [ ] Run Studio tests, lint, type checking, and production build.

## Task 9: Make the ART and query-plan UIs explicitly defer-aware

**Files:**

- Modify: `playground/src/components/playground/trace-view.tsx`
- Modify: `playground/src/components/playground/types.ts`
- Modify: `playground/src/components/playground/fetch-flow.tsx`
- Modify: `playground/src/components/playground/fetch-waterfall.tsx`
- Modify: `playground/src/components/playground/plan-view.tsx`
- Modify: `playground/src/components/playground/prettyPrint.ts`
- Modify: `studio/src/components/playground/trace-view.tsx`
- Modify: `studio/src/components/playground/types.ts`
- Modify: `studio/src/components/playground/fetch-flow.tsx`
- Modify: `studio/src/components/playground/fetch-waterfall.tsx`
- Modify: `studio/src/components/playground/plan-view.tsx`
- Modify: `studio/src/components/playground/prettyPrint.ts`
- Test: playground and Studio component tests from Tasks 7-8

- [ ] Add component tests for these states: no execution, streaming before first part, partial initial trace, complete terminal trace, interrupted stream, tracing unauthorized/no trace, and subscription unsupported.
- [ ] While `hasNext` is true, render the primary ART immediately with a clear “partial trace; deferred fetches are still running” status rather than “No trace found.”
- [ ] On terminal completion, remove the partial status and rebuild the tree/waterfall from the authoritative terminal trace.
- [ ] If the stream errors/cancels before terminal ART, retain the last partial trace but label it incomplete.
- [ ] Parse trace headers case-insensitively and treat the router's non-empty tracing options consistently.
- [ ] Teach the trace parser/types to retain optional defer `id`, `label`, `path`, and request-local execution `status` metadata from Task 1.
- [ ] Show a compact defer badge/boundary in tree and waterfall views so users can distinguish primary and deferred fetch groups; render `skipped` wrappers as planned-but-not-executed, never as successful fetches.
- [ ] Retain defer descriptor metadata in `QueryPlanFetchTypeNode`, and show the same label/path boundary in both query-plan tree and text views; query plans describe all planned branches and do not show runtime status.
- [ ] Verify sequence/parallel composite roots, skipped wrappers with nil fetch timings, nested defers, and completed-with-error groups do not crash either visualization.
- [ ] Keep normal non-defer and older trace version rendering unchanged.

## Task 10: Harden the ART-powered Defer Advisor before release

This task is adjacent to ordinary ART-on-defer but release-critical for the staged branch because Studio currently runs the advisor every three seconds.

**Files:**

- Modify: `router/core/request_tracing.go`
- Modify: `router/core/graphql_prehandler.go`
- Modify: `router/core/graph_server.go`
- Modify: `router/core/defer_advisor.go`
- Modify: `playground/src/components/playground/index.tsx`
- Create: `playground/src/components/playground/use-inline-defer-advisor.ts`
- Create: `playground/src/components/playground/use-inline-defer-advisor.test.tsx`
- Modify: `studio/src/components/playground/use-inline-defer-advisor.ts`
- Create: `studio/src/components/playground/use-inline-defer-advisor.test.tsx`
- Modify: `studio/src/pages/[organizationSlug]/[namespace]/graph/[slug]/playground.tsx`
- Test: `router-tests/protocol/defer_advisor_test.go`

- [ ] Extract/reuse one ART authorization predicate for development mode, forced unauthenticated tracing, or a valid ES256 graph request token. Enable advisor middleware when tracing is configured, then authorize each request with that predicate.
- [ ] Add a production-mode signed-token test and invalid/missing-token rejection tests.
- [ ] Parse the selected operation server-side and reject mutations/subscriptions before any baseline, split, or validation replay. Add a counter assertion proving no resolver ran.
- [ ] Extract the router playground's inline polling logic from `index.tsx` into `use-inline-defer-advisor.ts`, then apply the same query-only guard in both playground hooks for immediate UX while keeping the server authoritative.
- [ ] Pass Studio feature-flag context and substituted user headers to advisor calls.
- [ ] Disable advisor calls entirely for direct-subgraph targets and prove the graph request token never reaches a subgraph.
- [ ] Add `AbortController`, stale-result guards, and visible unsupported/403/error state to both playground hooks; do not silently retry a permanent failure every three seconds.
- [ ] Validate variables and exact operation-name selection. A missing named operation must not fall back to rewriting the first operation.
- [ ] Define the advisor as an analysis response: return `data`/`errors` from the measured baseline and **only** `extensions.deferAdvisor`. Explicitly suppress baseline ART, query-plan, custom subgraph, rate-limit, and authorization extensions because they come from one of several profiling executions and cannot represent a coherent client operation. Test and document this isolation contract.

## Task 11: Document the terminal extension contract and operational behavior

**Files:**

- Modify: `docs-website/router/subgraph-data-propagation/subgraph-extension-propagation.mdx`
- Create: `docs-website/router/incremental-delivery.mdx`
- Modify: `docs-website/router/configuration.mdx`
- Modify: `docs-website/docs.json`
- Modify: `rfc/defer-advisor/RFC.md`

- [ ] Document that client request extensions are forwarded to initial and deferred subgraph calls.
- [ ] Document that GraphQL error extensions stay attached to their individual error objects.
- [ ] Document that top-level response extensions may appear partially in the initial payload and are authoritative/cumulative on the terminal payload.
- [ ] State that extension merging is shallow and the configured first/last-write policy spans the whole request, including deferred loaders.
- [ ] Document ART UX: primary trace is visible during streaming; complete trace appears at terminal completion; interrupted traces remain partial.
- [ ] Explain that the query plan always lists all planned defer branches, while authoritative ART marks request-specific pruned branches `skipped` with no load timing.
- [ ] Document plan-only `@defer` behavior as one JSON response with no origin execution.
- [ ] Explain proxy requirements (`X-Accel-Buffering: no`, streaming ingress/CDN) and that TTFB means first complete multipart part, not first TCP byte.
- [ ] Add `router/incremental-delivery` to `docs-website/docs.json` next to the other router execution features and link it from the `enable_defer` configuration entry.
- [ ] Update the advisor RFC's “ART with defer not supported” section once the complete-trace contract ships.

## Task 12: End-to-end verification, compatibility, and rollout

**Files:**

- Use: `demo/defer-demo/` and its graph/router configuration
- Create: `playground/playwright.config.ts`
- Create: `playground/e2e/defer-fixture-server.ts`
- Create: `playground/e2e/router-defer-art.spec.ts`
- Create: `playground/e2e/studio-defer-art.spec.ts`
- Modify: `playground/package.json`
- Modify: `studio/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.github/workflows/playground-ci.yaml`
- Modify: `.github/workflows/studio-ci.yaml`
- Regenerate: `router/internal/graphiql/graphiql.html`

- [ ] Add `@playwright/test` and a `test:e2e` script to `playground/package.json`, two Playwright projects (`router-playground` and `studio`), and a small Node HTTP fixture that serves introspection plus delayed real multipart boundaries; the fixture must expose controls that release each deferred part independently.
- [ ] Make the router-playground spec run in `playground-ci.yaml`. Make the Studio project target a pre-authenticated test Studio URL/fixture graph in `studio-ci.yaml`, with required URL/token values supplied through CI test fixtures rather than committed secrets.
- [ ] Start the defer demo and execute the same operation without and with `@defer`; assert the final assembled `data` and errors are equivalent.
- [ ] In the router playground, observe initial data before releasing delayed fields, then verify final ART tree/waterfall contains every initial and deferred subgraph fetch.
- [ ] Repeat in Studio using a valid signed graph token and default client validation.
- [ ] Verify query-plan view returns immediately, contains primary and all defer branches, and makes no subgraph requests.
- [ ] Configure subgraph extension forwarding and verify initial-only, deferred-only, duplicate-key first/last, allow-list, and reserved-key behavior in both raw parts and final playground result.
- [ ] Verify pre-operation scripts run before the request and post-operation scripts run once with final data in each playground.
- [ ] Start a second query and switch tabs while a first stream is active; prove stale parts cannot overwrite active response, ART, timing, analytics, or scripts.
- [ ] Abort mid-stream and verify the connection closes, the UI says incomplete, and no terminal callback runs.
- [ ] Test through the production ingress/CDN as well as localhost to detect buffering outside the router.
- [ ] Compare the embedded router playground and published standalone build; both must use the same source behavior.
- [ ] Run the complete verification matrix below and capture command output in the implementation PR.

## Verification matrix

From the upstream `graphql-go-tools/v2` module:

```bash
go test ./pkg/engine/resolve ./pkg/engine/postprocess
go test -race ./pkg/engine/resolve
```

From the Cosmo workspace:

```bash
cd router && go test ./core
cd ../router-tests && go test ./operations ./protocol
cd ..

pnpm --filter @wundergraph/cosmo-shared test
pnpm --filter @wundergraph/cosmo-shared build
pnpm --filter @wundergraph/playground test
pnpm --filter @wundergraph/playground build:router
pnpm --filter @wundergraph/playground test:e2e
pnpm --filter studio test
pnpm --filter studio lint
pnpm --filter studio build

git diff --check
git diff --cached --check
```

Run focused Go tests during development before the full suites:

```bash
cd router-tests
go test ./protocol -run 'TestDefer|TestExtensionForwarding|TestRequestTracing'
go test ./operations -run 'TestQueryPlan|TestRequestTracing'
```

## Rollout order

1. Merge and release the `graphql-go-tools` composite-tree and terminal-extension work.
2. Integrate the engine release and land router protocol/query-plan tests.
3. Land the shared incremental adapter and schema helper.
4. Migrate the router playground and regenerate the embedded HTML.
5. Migrate Studio and enable the stream-aware ART UX.
6. Land advisor hardening before exposing the staged automatic advisor in managed production.
7. Run production-ingress E2E verification, then update docs/release notes.

The server change is backward compatible: existing clients still receive the initial response and data patches; clients that ignore later top-level extensions continue to work. New clients gain an authoritative final view. Frontends can ship the shared merger before the server release; they will show the current partial trace until a router capable of terminal ART is deployed.

## Definition of done

- Both playgrounds render initial data before delayed deferred data arrives.
- Studio accepts `@defer` with client validation enabled.
- Both ART views show a partial primary trace during the stream and a complete primary-plus-deferred trace at completion.
- Tree and waterfall views include nested/parallel defer fetches and do not crash on pruned/error groups.
- Defer query-plan view returns JSON immediately, includes all branches, and makes no origin calls.
- Client request extensions reach every initial/deferred subgraph request.
- Error extensions stay attached to incremental/completed errors.
- Terminal top-level extensions contain the request-wide custom-extension merge and complete requested built-ins.
- First/last-write, allow-list, reserved-key, authentication, and request-isolation behavior are covered by tests.
- Post-operation scripts and Studio analytics run once with the final assembled result.
- Cancellation and stale operations cannot overwrite a newer tab/execution.
- The router never buffers the complete multipart response, and production ingress releases the first part immediately.
- The embedded router playground is regenerated from source and all verification commands pass.
