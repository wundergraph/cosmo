# Entity Caching — Prerequisites & Known Gaps

Issues identified during audit that must be resolved before or during implementation.

---

## ~~P0 — Blocker: graphql-go-tools API Availability~~ RESOLVED

**Resolved by**: [Task 00 — Upgrade graphql-go-tools Dependency](./00-upgrade-graphql-go-tools.md)

Task 00 upgrades `router/go.mod` to the `feat/add-caching-support` branch (PR [#1259](https://github.com/wundergraph/graphql-go-tools/pull/1259), commit `683d6909`). All required APIs have been verified to exist in this branch. Tasks 01, 03, 06, 07, 08, 09, and 10 have been updated with corrected API names and Task 00 as a dependency.

**API corrections applied to task docs:**
- `ArgumentKeyMapping` → `EntityKeyMapping` + `FieldMapping` (Tasks 01, 06, 08)
- `ArgumentName` (string) → `FieldMapping.ArgumentPath` ([]string) (Tasks 01, 06, 08)
- `CacheStatsSnapshot` → `CacheAnalyticsSnapshot` with detailed event types (Task 10)
- Added `SubscriptionEntityPopulationConfiguration` to type mapping (Task 08)
- Confirmed `L2CacheKeyInterceptor` is per-key `func(ctx, key, info) string` (Task 09)

~~The tasks reference entity caching APIs from graphql-go-tools PR [#1259](https://github.com/wundergraph/graphql-go-tools/pull/1259). These APIs **do not exist in the current version** (v2.0.0-rc.261) used by the router.~~

### APIs Required

| API | Package | Used By |
|-----|---------|---------|
| `LoaderCache` interface | `resolve` | Task 03 (interface guard), Task 07 (map type), Task 08 (ResolverOptions) |
| `CacheEntry` struct | `resolve` | Task 03 (Get/Set return type) |
| `CachingOptions` struct | `resolve` | Task 09 (per-request context) |
| `ResolverOptions.Caches` field | `resolve` | Task 08 (executor wiring) |
| `ResolverOptions.EntityCacheConfigs` field | `resolve` | Task 08 (extension invalidation) |
| `Context.GetCacheStats()` method | `resolve` | Task 10 (metrics snapshot) |
| `EntityCacheConfiguration` | `plan` | Task 08 (subgraph config building) |
| `RootFieldCacheConfiguration` | `plan` | Task 08 |
| `MutationFieldCacheConfiguration` | `plan` | Task 08 |
| `MutationCacheInvalidationConfiguration` | `plan` | Task 08 |
| `ArgumentKeyMapping` | `plan` | Task 08 |
| `SubgraphCachingConfig` struct | `engine` | Task 08 (factory resolver) |
| `WithSubgraphEntityCachingConfigs` option | `engine` | Task 08 (engine factory) |
| `L2CacheKeyInterceptorInfo` struct | `resolve` | Task 09 (interceptor closure) |

### ~~Action Required~~ DONE

~~Before starting Tasks 03, 08, 09, or 10:~~
1. ~~Verify PR #1259 is merged into graphql-go-tools~~ → Using PR branch commit directly
2. ~~Upgrade `router/go.mod`~~ → Task 00 handles this
3. ~~Run `go build ./...`~~ → Task 00 verification step
4. ~~Update the task docs~~ → Done (API corrections applied above)

---

## P1 — Spec Items Not Assigned to Any Task

### ~~Field-Level Argument Hashing~~ RESOLVED

Engine internals (graphql-go-tools handles xxhash of field arguments). Router integration tests should cover that different argument values produce different cache entries. No task changes needed — just add a test case to Task 11.

### ~~Shadow Mode Staleness Detection~~ RESOLVED

Comparison happens in graphql-go-tools (reported via `CacheAnalyticsSnapshot.ShadowComparisons`). Evaluation/alerting happens in an external analytics solution. The router's role is limited to: exposing the `router.entity_cache.shadow.staleness` metric (Task 10) and passing `EnableCacheAnalytics` per-request (Task 09). No additional task needed.

### ~~`includeHeaders` Hashing Implementation~~ RESOLVED

The router already knows which headers are forwarded to each subgraph and they are pre-hashed. The router just gets the pre-hashed headers from the context for the subgraph and forwards them. The engine uses `IncludeSubgraphHeaderPrefix` flag to include this hash in the cache key. No additional task needed — just pass the flag through (already covered by Tasks 08/09).

---

## P2 — Ambiguities Requiring Design Decisions

### ~~Extension Invalidation: Multi-Subgraph Entity Resolution~~ RESOLVED

**Decision**: Delete only from the subgraph that returned the response (Option 2). The `cacheLookup` in Task 12's `processExtensionInvalidation` should use the responding subgraph's name to look up the cache config, not scan all subgraphs. The `L2CacheKeyInterceptorInfo.SubgraphName` field provides the subgraph context.

### ~~`L2CacheKeyInterceptor` — Batch vs. Per-Key~~ RESOLVED

**Resolution**: Verified in PR #1259 — the engine's `L2CacheKeyInterceptor` is per-key: `func(ctx context.Context, key string, info L2CacheKeyInterceptorInfo) string`. Task 09 has been updated to use per-key wrapping (Option 1). The `EntityCacheKeyInterceptor` module interface remains batch-oriented per the CONFIGURATION.md spec; the handler wraps each per-key call into a single-element batch.

### ~~Validation Rule 8: List Return Key Mapping~~ RESOLVED

**Decision**: Argument-to-key mapping only applies to **non-list entity returns**. For list returns, the mapping is not needed — entity keys are extracted per-entity from the response data.

Additionally, we need to distinguish **read** vs **write**:
- **Read** (cache lookup on queries): Requires complete argument→key mapping to construct cache keys from query arguments. If any `@key` field cannot be mapped to an argument, cache **reads are disabled** for this field.
- **Write** (cache population): Can always populate because entity keys are extracted from the response data. Incomplete mapping does NOT prevent cache writes.

If the mapping is incomplete for a non-list field, composition should emit a **warning** (not an error) informing the user that cache reads are disabled for that field but cache population still works. This is a valid use case.

**Action applied**: Task 05 updated — Rule 7 requires complete mapping only for cache reads on non-list fields. Rule 8 removed for list returns. Incomplete mapping results in write-only mode with a user-facing warning.

---

## P3 — Missing Implementation Details

### Test Cache Injection Mechanism

**Problem**: Task 11 assumes `core.WithEntityCacheInstances()` exists to inject `MemoryEntityCache` in tests. No task defines this option.

**Action**: Task 07 should define a `core.WithEntityCacheInstances(map[string]resolve.LoaderCache)` router option that overrides the Redis-based cache instances built from storage providers. This allows tests to inject `MemoryEntityCache`.

### Extension Parsing Insertion Point

**Problem**: Task 12 says "look for the response handling pipeline" without specifying the exact file/function.

**Action**: Investigate the actual subgraph response processing path. Likely in `resolve.Loader` or via `LoaderHooks` (which already exists in the router — `EngineLoaderHooks` on `graphql_handler.go`). The `EnginePostOriginHandler` module interface is another candidate. Task 12 should be updated with the specific insertion point after checking the engine code.

### `RequestContext` Type

**Problem**: Task 07 references `RequestContext` in the module interface signature, but doesn't specify its package or API.

**Action**: `RequestContext` is already defined in `router/core` (used by other module interfaces). Verify the type has `.Request()` method for header access. No change needed if it matches existing usage.

---

## P4 — Acceptance Criteria Additions

Items to add to `ENTITY_CACHING_ACCEPTANCE_CRITERIA.md`:

### Cache Key Format

- [ ] Entity fields with arguments produce different cache entries (xxhash suffix) — covered by Task 11 scenario 19
- [ ] Cache key format prevents collisions between entity keys and root field keys (different `__typename` and structure)

### Key Transformation Pipeline Order

- [ ] Integration test with both `includeHeaders: true` AND an `EntityCacheKeyInterceptor` module verifies transformations applied in correct order: base key → header hash → interceptor → Redis prefix

### `operation_type` Proto Field

- [ ] `CachePopulateConfiguration.operation_type` correctly set to "Mutation" or "Subscription" in composition output
- [ ] `CacheInvalidateConfiguration.operation_type` correctly set to "Mutation" or "Subscription"
- [ ] Router handles both values correctly (or ignores the field if the plan types don't need it)

### ~~graphql-go-tools Version~~ RESOLVED (Task 00)

- [x] `router/go.mod` references a graphql-go-tools version that includes entity caching APIs (PR #1259 or later)
- [x] `go build ./...` compiles with the updated dependency
