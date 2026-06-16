# Entity Caching Integration Notes

These notes describe the router side of entity caching as implemented in this branch.
The router integration is intentionally thin.
The engine owns key rendering,
cache orchestration,
shadow comparisons,
mutation handling,
subscription handling,
and trace payload generation.

## Router Responsibilities

The router has four responsibilities.

1. It loads the `entity_caching` and `storage_providers` YAML surface from config.
2. It builds named L2 `resolve.LoaderCache` backends from Redis or memory providers.
3. It passes request-level `resolve.CachingOptions` into execution.
4. It maps router config into `plan.FederationMetaData` cache configuration for each data source.

The seam is narrow by design.
The router wires `resolve.LoaderCache` backends,
`resolve.CachingOptions`,
and `plan.FederationMetaData` caching configs.
The engine does the rest.

## Loader Cache Contract

The L2 backend interface is the engine `resolve.LoaderCache` contract.

```go
type LoaderCache interface {
	Get(ctx context.Context, keys []string) ([]*resolve.CacheEntry, error)
	Set(ctx context.Context, entries []*resolve.CacheEntry) error
	Delete(ctx context.Context, keys []string) error
}
```

`Set` receives per-entry TTL values on `resolve.CacheEntry.TTL`.
There is no call-level TTL parameter.
Backends must return `Get` results aligned one-to-one with the requested key slice,
using `nil` entries for misses.

## Subscription Callbacks

The router installs two resolver callbacks when entity caching is enabled and metrics are available.

```go
OnSubscriptionCacheWrite func(resolve.CacheWriteEvent)
OnSubscriptionCacheInvalidate func(entityType string, keys []string)
```

`OnSubscriptionCacheWrite` records one L2 write analytics event.
`OnSubscriptionCacheInvalidate` records one invalidation analytics event per key,
with source `subscription`.

`plan.SubscriptionEntityPopulationConfiguration.FieldName` is mandatory.
An empty `FieldName` makes `FindByTypeAndFieldName` return no match,
so subscription population silently becomes a no-op for that entry.
The router config validator rejects empty `subscriptions[].field_name`.

## Federation Metadata Contracts

`plan.EntityCacheConfiguration` includes these cache-related fields.

```go
TypeName string
CacheName string
TTL time.Duration
IncludeSubgraphHeaderPrefix bool
EnablePartialCacheLoad bool
HashAnalyticsKeys bool
ShadowMode bool
NegativeCacheTTL time.Duration
```

The router currently fills `TypeName`,
`CacheName`,
`TTL`,
`IncludeSubgraphHeaderPrefix`,
and `ShadowMode` from config.
`NegativeCacheTTL` and `HashAnalyticsKeys` are part of the engine contract,
but are not exposed in the router YAML added by R1-R10.

`plan.SubscriptionEntityPopulationConfiguration` includes `TypeName`,
`FieldName`,
`CacheName`,
`TTL`,
`IncludeSubgraphHeaderPrefix`,
and `EnableInvalidationOnKeyOnly`.
The router fills `TypeName`,
`FieldName`,
`CacheName`,
`TTL`,
and `EnableInvalidationOnKeyOnly` from config.

## Request Options And Trace Gate

The pre-handler builds `resolve.CachingOptions` from router config.
`EnableL1Cache` requires both `entity_caching.enabled` and `entity_caching.l1.enabled`.
`EnableL2Cache` requires both `entity_caching.enabled` and `entity_caching.l2.enabled`.
`GlobalCacheKeyPrefix` is copied from `entity_caching.global_cache_key_prefix`.
`EnableCacheAnalytics` is set only when router metrics enable entity cache analytics.

The development cache-control headers are only honored when request trace options are enabled for that request.
The router passes `traceOptions.Enable` into `parseRequestExecutionOptions`.
There is no `WithRequestTraceOptions` helper in this integration.

Cache trace output is gated in the engine on `ctx.TracingOptions`.
The effective gate is `ctx.TracingOptions.Enable` and not `ctx.TracingOptions.ExcludeCacheStats`.

## Backend Wiring

`buildEntityCacheInstances` creates a map from cache name to `resolve.LoaderCache`.
It first discovers cache names from configured entities and subscriptions.
When L2 is disabled,
or when there is no provider registry,
the map can contain cache names with nil backends.
The engine treats missing backend behavior as cache misses.

For the default cache name,
the router uses `entity_caching.l2.storage.provider_id`.
For entity overrides,
the router uses entity provider ID,
then subgraph provider ID,
then the default cache name.
For subscription overrides,
the router uses subscription cache name,
then subgraph provider ID,
then the default cache name.

Redis backends use `storage_providers.redis`.
Memory backends use `storage_providers.memory`.
Both use `entity_caching.l2.storage.key_prefix`,
with `cosmo_entity_cache` as the fallback.
Both are wrapped in the circuit breaker before being passed to the engine.

## Composition Prerequisite

Directive-driven cache configuration for request-scoped fields,
root fields,
mutations,
and subscriptions requires Cosmo composition support and protobuf support.
Today,
R1-R10 source the entity caching metadata from router `config.yaml`.

The composition-side directive inventory is in [composition/src/v1/constants/directive-definitions.ts](../../../composition/src/v1/constants/directive-definitions.ts).
The upstream engine contracts live in [graphql-go-tools](https://github.com/wundergraph/graphql-go-tools).
When composition starts producing the cache metadata,
the router should keep the same thin seam and pass the generated protobuf fields into `plan.FederationMetaData`.

## Invalidation Path

The router passes `EntityCacheConfigs` to the resolver from `buildEntityCacheInvalidationConfigs`.
Those configs map subgraph name and entity type to a cache name and header-prefix behavior.
The engine uses that metadata to process subgraph `extensions.cacheInvalidation.keys`.

Mutation config is translated in `mutationCacheConfigurationsForDataSource`.
It creates mutation field population config from `field_name`,
`enable_l2_population`,
and `ttl`.
It creates invalidation config from `field_name` and `invalidate_entity_type`.

Subscription config is translated in `subscriptionEntityPopulationConfigurationsForDataSource`.
It creates population config from `type_name`,
`field_name`,
`cache_name`,
`ttl`,
and `invalidate_on_key_only`.
