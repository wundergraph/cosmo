# Draft PR: Cosmo

## Title

`feat(router): add defer-aware ART and progressive playground execution`

## Dependency link

Depends on local `graphql-go-tools` commit `74918f8b8ad22ee2379cbb7a1439fab79feda38b` on branch `feat/defer-art-extensions`, represented in both Cosmo Go modules as `v2.10.1-0.20260711225056-74918f8b8ad2`. Replace this paragraph with the upstream draft-PR URL once the branch is pushed.

## Summary

This change completes `@defer` debugging and consumption across the router playground and Cosmo Studio while preserving time to first result.

- Keeps multipart delivery streaming through the router and flushes each complete MIME part.
- Returns defer plan-only requests synchronously as JSON with `data: null`, a complete composite query plan, and no origin execution.
- Adds real-wire coverage for primary and terminal ART, query plans, custom extensions, request extensions, error extensions, pruned groups, and first/last-write policy.
- Adds one browser-safe shared incremental-result adapter supporting Cosmo ID/subPath payloads and legacy path-based payloads.
- Reconstructs and yields progressive snapshots without buffering the raw multipart body.
- Makes the active GraphiQL tab the response/ART source of truth in both playgrounds.
- Runs post-operation scripts and Studio analytics once, only after an explicit terminal result.
- Prevents superseded executions and tab switches from overwriting active results or lifecycle state.
- Accepts `@defer` in client validation for router/federated-graph targets while leaving direct subgraph schemas unchanged.
- Attaches the Studio graph request token for every non-empty, case-insensitive `X-WG-Trace` option and never sends it to a direct subgraph.
- Adds defer-aware ART status and defer boundaries to trace, waterfall, and query-plan views.
- Adds a bounded, tracing-authorized Defer Advisor that measures, rewrites, validates, and publishes conservative `@defer` suggestions.

## Streaming architecture

```text
router multipart Response
  -> @graphiql/toolkit / meros parses MIME incrementally
  -> shared adapter resolves pending IDs and applies patches
  -> assembled snapshot is yielded to GraphiQL
  -> active-tab response feeds response editor and ART
  -> terminal callback runs scripts/analytics exactly once
```

The initial ART is displayed as partial while `hasNext` is true. The terminal response shallow-replaces `extensions.trace` with the authoritative complete trace. Cancellation or premature EOF retains the last snapshot but marks ART incomplete.

## Response extensions

- Client request `extensions` are forwarded to initial and deferred subgraph calls.
- `errors[].extensions` remain attached to initial, incremental, or completed errors.
- Top-level response extensions are cumulative and authoritative on the `hasNext: false` part.
- First/last-write policy spans the whole request, and reserved router extension keys remain protected.

## Security and operational behavior

- ART and Defer Advisor use the same development/forced/signed-token authorization rules.
- Advisor requests are query-only, bounded by request size, concurrency, replay count, response size, segment count, and total/replay deadlines.
- Loopback requests isolate routing context and preserve allowed user headers.
- Direct-subgraph Studio execution neither receives the graph token nor invokes the advisor.
- `X-Accel-Buffering: no` is emitted; production ingress/CDN buffering must still be tested independently.

## Verification

Verified locally on the final sources:

```bash
pnpm --dir shared exec vitest run test/incremental-delivery.test.ts test/defer-schema.test.ts # 33 passed
pnpm --filter @wundergraph/playground test -- --run                         # 63 passed
pnpm --filter @wundergraph/playground build:router
pnpm --dir studio test -- --run <10 changed playground test files>          # 64 passed

cd router && go test ./core -run 'Test.*(Defer|Advisor|Plan|Multipart)' -count=1
cd ../router-tests && go test ./protocol -run '^(TestDeferART|TestReconstructDeferART|TestDeferTestDataQueries)' -count=1
go test -race ./protocol -run '^(TestDeferART|TestReconstructDeferART)' -count=1
go vet ./protocol

git diff --check
git diff --cached --check
```

The wire suite verifies final assembled-data equivalence, first-part arrival before the slow resolver is released, terminal ART topology, plan-only zero origin calls, error and extension preservation, pruning, and reconstruction. Browser suites verify cancellation, stale execution/tab suppression, selected operation/variables/headers, one-shot terminal scripts and analytics, and the embedded bundle build.

Known checkout baseline: repository-wide shared/Studio lint and typecheck paths currently fail on generated `@bufbuild/protobuf`/Connect schema exports outside this diff. Studio's full Vitest run otherwise reports 80 passing tests with only the corresponding lint-page check failing. Re-run the complete matrix after generated dependencies are synchronized in CI.

## Rollout

1. Publish the graphql-go-tools PR branch or release.
2. Make the committed pseudo-version resolve (or update both Go modules to the tagged release); temporary development `replace` entries have already been removed.
3. Synchronize generated Connect/protobuf dependencies and run the complete CI matrix.
4. Test first-part delivery through the production ingress/CDN.
5. Merge this PR only after both Go modules resolve the same upstream version and the full verification matrix is green.
