# CLAUDE.md — Cosmo Repository Guide

Top-level notes and gotchas accumulated while working on this repo.
For subsystem-specific details, see the per-package `CLAUDE.md` files and the
`docs/` directory.

## Repository layout

| Path | What it is |
|------|------------|
| `composition/` | TypeScript library that normalizes subgraph SDL and produces `ConfigurationData` consumed by the router. See `composition/CLAUDE.md`. |
| `composition-go/` | Go wrapper around the composition TypeScript bundle. Used by router-tests and demo tooling. Regenerate the bundle with `composition-go/generate.sh`. |
| `shared/` | TypeScript package that serializes `ConfigurationData` into the router config proto (`graphql-configuration.ts`). |
| `proto/wg/cosmo/node/v1/node.proto` | Wire format for router configuration. Regenerate Go + TS bindings via `make generate-go` (TS proto lives in `connect/src/wg/cosmo/node/v1/node_pb.ts`). |
| `router/` | Go router binary. Entity caching + resolver wiring lives in `router/core/factoryresolver.go`. |
| `router-tests/` | Integration tests. The entity caching suite is in `router-tests/entity_caching/` with a `make compose` target to regenerate `testdata/config.json` via `cmd/compose/main.go`. |
| `playground/` | React GraphiQL-based playground. Built with `pnpm build:router` to embed into the router binary via `router/internal/graphiql/graphiql.html`. |
| `demo/` | Standalone demo subgraphs + cache-only runner. See `demo/cmd/cache-demo/main.go`. Recompose demo config with `make compose-cache` from `demo/`. |
| `docs/` | Developer docs. Entity caching + `@requestScoped` live here. |

The graphql-go-tools dependency is typically resolved from the path replacement in
`router/go.mod` and `router-tests/go.mod` — currently pointing at a local sibling
clone. Changes to resolver/planner code happen in that repo, not here.

## Entity caching + `@requestScoped`

- **[@requestScoped directive](./docs/REQUEST_SCOPED.md)** — Per-request coordinate L1
  cache for fields that resolve to the same value within a request. Symmetric design
  with a single mandatory `key` argument. Every participating field is both a reader
  and a writer. See the linked doc for full semantics, architecture, and examples.
- **Acceptance criteria**: `graphql-go-tools/docs/entity-caching/ENTITY_CACHING_ACCEPTANCE_CRITERIA.md`
- **Demo**: `docs/entity-caching/ENTITY_CACHING_DEMO.md` — visual guide with the
  canonical cross-subgraph cached query.

## Cache normalization — unified pipeline

Coordinate L1 (`@requestScoped`), entity L1, and entity L2 caches all share the
same alias-aware normalization pipeline based on the response plan's `*Object` tree:

- **Normalize for write**: `normalizeForCache(value, obj)` renames aliases to schema
  field names and applies arg-hash suffixes. Fast path when `obj.HasAliases` is false.
- **Widening check**: `validateItemHasRequiredData(cached, obj)` verifies all required
  fields are present. Missing field → skip the cache and refetch.
- **Denormalized read**: `shallowCopyProvidedFields(cached, obj)` copies fields from
  schema-named cache into a response-named object (re-applies aliases).

Do not write a parallel normalization path for a new cache. Use `ProvidesData *Object`
references and the existing helpers.

## Pipeline: composition → router

Changes to caching config types (e.g., adding `isBatch`, `key`, etc.) must be wired
through the entire stack, in order:

1. `composition/src/router-configuration/types.ts` — TypeScript type
2. `composition/` — extraction logic in `normalization-factory.ts`
3. `proto/wg/cosmo/node/v1/node.proto` — protobuf message (use `reserved` when
   removing fields to preserve wire compatibility)
4. `make generate-go` — regenerates Go proto (`router/gen/proto/...`, `connect-go/gen/...`)
5. `connect/src/wg/cosmo/node/v1/node_pb.ts` — generated TS proto class (manually
   edit when removing fields if no TS regen script is handy)
6. `shared/src/router-config/graphql-configuration.ts` — proto serialization
7. `router/core/factoryresolver.go` — proto → planner metadata mapping
8. `composition-go/generate.sh` — rebuild JS bundle (pulls in composition + shared
   builds; must rebuild both TS packages first)
9. `router-tests/entity_caching && make compose` — regenerate integration test config

Missing any step causes the field to silently drop from the final config JSON.
When a field is present in composition output but missing in the final config.json,
check the shared package serializer first.

## Debugging silent field drops

If a field you added to `ConfigurationData` (or to a nested config type) doesn't appear
in the final `config.json`:

1. `cd composition && npx vitest run tests/v1/directives/entity-caching.test.ts` —
   does the composition test see the field?
2. Inline inspect the shared serializer with a quick test — does it write the field?
3. Check if the proto generated TS class has the field (`connect/src/.../node_pb.ts`)
4. Check if composition-go bundle is stale — `cd composition-go && bash generate.sh`
5. Check if shared package is stale — `cd shared && pnpm build`

## Per-request cache control headers (dev only)

The router supports these headers, gated on tracing authorization
(dev mode or valid studio request token):

- `X-WG-Disable-Entity-Cache: true` → disable both L1 and L2
- `X-WG-Disable-Entity-Cache-L1: true` → disable L1 only (including coordinate L1)
- `X-WG-Disable-Entity-Cache-L2: true` → disable L2 only

See `router/core/graphql_handler.go:cachingOptions`.

The playground exposes a cache mode dropdown ("Caching enabled / L2 only / L1 only /
disabled") that injects these headers transparently via a ref (not a state dep) to
avoid resetting the cache stats display on mode switch.

## Playground embedding

The playground is embedded into the router binary via `//go:embed graphiql.html`.
Rebuild workflow:

```bash
cd playground && pnpm build:router   # builds + copies to router/internal/graphiql/graphiql.html
# then restart the router — Go re-embeds on next build
```

Just running `npm run build` in the playground builds the library bundle but does
NOT copy to the router. Always use `build:router`.

## Pre-existing bugs found and fixed in this session

For future reference when working on related code:

- **Composition**: `@is(fields:)` directive extraction was reading `"field"` (singular)
  instead of the constant `FIELDS` (plural) that the AST definition actually uses.
  Silently broke all @is extraction.
- **Composition**: Independent `@key` directives (OR semantics) were being merged into
  a single composite mapping (AND semantics) in `buildAutoMappings`. Fixed by removing
  the merge step — each `@key` produces its own `EntityKeyMappingConfig`.
- **Composition**: `REQUEST_SCOPED_DEFINITION_DATA` had an empty `argumentTypeNodeByName`
  map, so any `@requestScoped(...)` argument was rejected as "unexpected". Made the
  directive unusable with arguments.
- **graphql-go-tools**: `SubscriptionEntityPopulationConfiguration.FieldName` was never
  set in `factoryresolver.go`, but a recent change switched the lookup to
  `FindByTypeAndFieldName` — the empty FieldName meant no lookup ever matched,
  silently breaking subscription cache populate/invalidate.
- **graphql-go-tools**: `configureFetchCaching` in visitor.go was dropping
  `RequestScopedHints`/`RequestScopedExports` when the entity fetch path or
  L2-enabled root fetch path returned a fresh `FetchCacheConfiguration`. Fixed by
  preserving them.
- **graphql-go-tools**: `exportRequestScopedFields` stored a pointer into the
  goroutine arena, which was reused within the same request — dangling pointer
  crash on subsequent reads. Fixed by detaching via `normalizeForCache` (allocates
  on the per-request `jsonArena`) or explicit `MarshalTo + MustParseBytes` copy.
- **graphql-go-tools**: entity L1 cache writes had the same lifetime hazard on
  the no-alias fast path. `normalizeForCache` returns the original pointer when no
  alias/arg rewrite is needed, so writing that result directly to `l1Cache`
  stores a value backed by a reusable arena. Fixed by routing all entity L1 writes
  through `detachValueForL1Store` and by adding arena-reuse regressions for both
  entity-fetch and root-field L1 population paths.
- **graphql-go-tools**: `tryRequestScopedInjection` was partially mutating items
  when a later hint failed, leaving inconsistent state. Fixed with collect-then-inject:
  verify all hints can be satisfied, then mutate.
- **Router**: `resolveEntityCacheProviderID` dereferenced a nil `*config.EntityCachingConfiguration`
  in the plan generator path. Added a nil guard.
- **Playground**: cache mode dropdown was in the fetcher's `useMemo` dep array,
  causing re-creation on mode change which triggered introspection re-run and
  reset the response/cache stats. Fixed by using a ref instead.
- **Playground**: `collectCacheSummary` was excluding `load_skipped` fetches from
  the total, producing misleading "5/5 Cached" when 3 skipped fetches were actually
  cache hits. Fixed to count every fetch with a trace.
- **Playground**: Status code badge (200 OK) was shown alongside the red bolt icon
  for skipped fetches. Fixed by hiding the badge when `loadSkipped` is true.

## Per-subsystem CLAUDE.md files

- `composition/CLAUDE.md` — composition library architecture, entity caching mapping rules
- `router-tests/CLAUDE.md` — router integration test patterns, sync helpers
- (graphql-go-tools repo) `CLAUDE.md` and `v2/pkg/engine/resolve/CLAUDE.md` —
  resolver internals, entity caching layers, `@requestScoped` implementation details

## Commands cheatsheet

```bash
# Composition
cd composition && npx vitest run                    # all composition tests
cd composition && npx tsc --noEmit                  # type check
cd composition && pnpm build                        # build

# Shared + composition-go bundle rebuild after composition changes
cd shared && pnpm build
cd composition-go && bash generate.sh

# Proto regeneration
make generate-go

# Router tests
cd router-tests/entity_caching && make compose      # regenerate testdata/config.json
cd router-tests/entity_caching && go test -run "TestEntityCaching" -count=1 .

# graphql-go-tools (in the local sibling clone)
cd v2 && go test ./pkg/engine/resolve/ ./pkg/engine/plan/ ./pkg/engine/datasource/graphql_datasource/ -count=1

# Demo
cd demo && make compose-cache                       # recompose config-cache-only.json
cd demo && go run ./cmd/cache-demo/                 # start subgraphs
cd router && go run ./cmd/router/ --config ../demo/router-cache.yaml

# Playground embed
cd playground && pnpm build:router
```
