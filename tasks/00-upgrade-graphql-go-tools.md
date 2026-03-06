# Task 00: Upgrade graphql-go-tools Dependency

## Objective

Upgrade the `graphql-go-tools/v2` dependency from `v2.0.0-rc.261` to the latest commit on the `feat/add-caching-support` branch (PR [#1259](https://github.com/wundergraph/graphql-go-tools/pull/1259)). This PR adds the entity caching engine APIs that Tasks 03, 07, 08, 09, and 10 depend on.

## Why This Is First

The entity caching APIs (`LoaderCache`, `CacheEntry`, `CachingOptions`, `SubgraphCachingConfig`, plan types, etc.) **do not exist** in the current version (`v2.0.0-rc.261`). All router-side entity caching tasks compile against these APIs and will fail without this upgrade.

## Scope

- Update `router/go.mod` to point to the PR branch commit
- Run `go mod tidy` to update `go.sum`
- Verify compilation and existing tests pass

## Dependencies

**None.** This is the first task. All other tasks depend on this.

## PR Branch Details

| Field | Value |
|-------|-------|
| Repository | `wundergraph/graphql-go-tools` |
| PR | [#1259 — feat: add caching to loader](https://github.com/wundergraph/graphql-go-tools/pull/1259) |
| Branch | `feat/add-caching-support` |
| Latest commit | `683d69093819fbe51cdae3be95c4ef0bfa8b5887` |

## Implementation Steps

### Step 1: Update go.mod

```bash
cd router
go get github.com/wundergraph/graphql-go-tools/v2@683d69093819fbe51cdae3be95c4ef0bfa8b5887
go mod tidy
```

This will change the `require` line from:
```
github.com/wundergraph/graphql-go-tools/v2 v2.0.0-rc.261
```
to a pseudo-version referencing the PR commit:
```
github.com/wundergraph/graphql-go-tools/v2 v2.0.0-rc.262-0.YYYYMMDDHHMMSS-683d69093819
```

### Step 2: Verify Compilation

```bash
cd router && go build ./...
```

### Step 3: Run Existing Tests

```bash
cd router && go test ./...
```

No test changes should be needed — the PR only adds new APIs, it doesn't change existing behavior.

### Step 4: Verify Entity Caching APIs Are Available

Quick compile check — create a temporary file or just verify the import compiles:

```bash
cd router && go doc github.com/wundergraph/graphql-go-tools/v2/v2/pkg/engine/resolve LoaderCache
```

## APIs Provided by This Upgrade

### Package `resolve` (`v2/pkg/engine/resolve`)

| Type | Kind | Description |
|------|------|-------------|
| `LoaderCache` | interface | `Get(ctx, keys []string)`, `Set(ctx, entries, ttl)`, `Delete(ctx, keys []string)` |
| `CacheEntry` | struct | `Key string`, `Value []byte`, `RemainingTTL time.Duration` |
| `CachingOptions` | struct | `EnableL1Cache`, `EnableL2Cache`, `EnableCacheAnalytics`, `L2CacheKeyInterceptor` |
| `L2CacheKeyInterceptor` | func type | `func(ctx context.Context, key string, info L2CacheKeyInterceptorInfo) string` |
| `L2CacheKeyInterceptorInfo` | struct | `SubgraphName string`, `CacheName string` |
| `EntityCacheInvalidationConfig` | struct | `CacheName string`, `IncludeSubgraphHeaderPrefix bool` |
| `CacheAnalyticsSnapshot` | struct | Detailed per-request cache stats (L1/L2 reads/writes, shadow comparisons, etc.) |
| `Context.GetCacheStats()` | method | Returns `CacheAnalyticsSnapshot` after execution |
| `FetchCacheConfiguration` | struct | Per-fetch cache config (used internally by engine) |
| `KeyField` | struct | `Name string`, `Children []KeyField` |

### Package `plan` (`v2/pkg/engine/plan`)

| Type | Kind | Description |
|------|------|-------------|
| `EntityCacheConfiguration` | struct | `TypeName`, `CacheName`, `TTL`, `IncludeSubgraphHeaderPrefix`, `EnablePartialCacheLoad`, `HashAnalyticsKeys`, `ShadowMode` |
| `RootFieldCacheConfiguration` | struct | `TypeName`, `FieldName`, `CacheName`, `TTL`, `IncludeSubgraphHeaderPrefix`, `EntityKeyMappings`, `ShadowMode` |
| `EntityKeyMapping` | struct | `EntityTypeName string`, `FieldMappings []FieldMapping` |
| `FieldMapping` | struct | `EntityKeyField string`, `ArgumentPath []string` |
| `MutationFieldCacheConfiguration` | struct | `FieldName`, `EnableEntityL2CachePopulation` |
| `MutationCacheInvalidationConfiguration` | struct | `FieldName`, `EntityTypeName` |
| `SubscriptionEntityPopulationConfiguration` | struct | `TypeName`, `CacheName`, `TTL`, `IncludeSubgraphHeaderPrefix`, `EnableInvalidationOnKeyOnly` |
| `FederationMetaData` (extended) | struct | New fields: `EntityCaching`, `RootFieldCaching`, `MutationFieldCaching`, `SubscriptionEntityPopulation`, `MutationCacheInvalidation` |

### Package `engine` (`execution/engine`)

| Type | Kind | Description |
|------|------|-------------|
| `SubgraphCachingConfig` | struct | `SubgraphName`, `EntityCaching`, `RootFieldCaching`, `MutationFieldCaching`, `SubscriptionEntityPopulation`, `MutationCacheInvalidation` |
| `SubgraphCachingConfigs` | type | `[]SubgraphCachingConfig` with `FindBySubgraphName()` |
| `WithSubgraphEntityCachingConfigs()` | func | Engine factory option |
| `WithCachingOptions()` | func | Execution option for per-request caching |
| `WithCacheStatsOutput()` | func | Execution option for collecting cache stats |

## Key API Differences from Original Task Docs

The following discrepancies between the original task descriptions and the actual PR APIs must be addressed when implementing:

| Task Doc Assumption | Actual PR API | Affected Tasks |
|---|---|---|
| `plan.ArgumentKeyMapping` | `plan.EntityKeyMapping` + `plan.FieldMapping` | 01 (proto), 06 (serialization), 08 (mapping) |
| `ArgumentKeyMapping.ArgumentName` (string) | `FieldMapping.ArgumentPath` ([]string) | 01, 06, 08 |
| `RootFieldCacheConfiguration.EntityTypeName` | `RootFieldCacheConfiguration.TypeName` | 06, 08 |
| `CacheStatsSnapshot` | `CacheAnalyticsSnapshot` (with detailed event types) | 10 (metrics) |
| No subscription population type | `plan.SubscriptionEntityPopulationConfiguration` exists | 08, 12 |
| `SubgraphCachingConfig` has 4 fields | Has 5 fields (includes `SubscriptionEntityPopulation`) | 08 |
| `ResolverOptions.EntityCacheConfigs` type unclear | `map[string]map[string]*EntityCacheInvalidationConfig` | 08 |

## Verification

| Criterion | Command |
|---|---|
| go.mod updated | `grep graphql-go-tools router/go.mod` shows new version |
| Compilation | `cd router && go build ./...` |
| Existing tests | `cd router && go test ./...` |
| LoaderCache accessible | `cd router && go doc github.com/wundergraph/graphql-go-tools/v2/v2/pkg/engine/resolve LoaderCache` |
| CachingOptions accessible | `cd router && go doc github.com/wundergraph/graphql-go-tools/v2/v2/pkg/engine/resolve CachingOptions` |
| SubgraphCachingConfig accessible | Type compiles when referenced |

## Risk

- The PR branch is not yet merged to main. If the branch is rebased or force-pushed, the commit hash may become unavailable. In that case, use the new head commit.
- Once the PR is merged, switch to the tagged release version.
