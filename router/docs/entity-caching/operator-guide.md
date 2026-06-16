# Entity Caching Operator Guide

Entity caching is disabled by default.
Enable it explicitly,
configure the cache tiers you want to use,
and map subgraphs and entity types to L2 storage providers.

The router exposes two cache tiers.
L1 is the in-process request cache.
L2 is a named `resolve.LoaderCache` backend backed by Redis or by the router memory storage provider.

## Example

```yaml
version: "1"

storage_providers:
  redis:
    - id: entity-redis
      urls:
        - redis://redis:6379
      cluster_enabled: false
  memory:
    - id: entity-memory
      max_size: 256MB

entity_caching:
  enabled: true
  global_cache_key_prefix: schema-v1
  l1:
    enabled: true
    max_size: 128MB
  l2:
    enabled: true
    storage:
      provider_id: entity-redis
      key_prefix: cosmo_entity_cache
    circuit_breaker:
      failure_threshold: 5
      cooldown_period: 10s
  subgraph_cache_overrides:
    - name: accounts
      storage_provider_id: entity-redis
      entities:
        - type: User
          storage_provider_id: entity-redis
          ttl: 5m
          cache_name: users
          shadow_mode: false
          include_subgraph_header_prefix: false
      mutations:
        - field_name: updateUser
          invalidate_entity_type: User
          enable_l2_population: true
          ttl: 3m
      subscriptions:
        - type_name: User
          field_name: userUpdated
          cache_name: users
          ttl: 7m
          invalidate_on_key_only: true

telemetry:
  metrics:
    otlp:
      entity_caching_stats: true
    prometheus:
      entity_caching_stats: true
```

## Entity Caching Fields

| YAML key | DEFAULT | Notes |
| --- | --- | --- |
| `entity_caching.enabled` | `false` | Master gate for L1 and L2 |
| `entity_caching.global_cache_key_prefix` | empty string | Prefix passed to engine cache-key rendering |
| `entity_caching.l1.enabled` | `false` | Enables the request cache tier |
| `entity_caching.l1.max_size` | `100MB` | Maximum in-process L1 size |
| `entity_caching.l2.enabled` | `false` | Enables L2 reads and writes |
| `entity_caching.l2.storage.provider_id` | empty string | Default L2 storage provider ID |
| `entity_caching.l2.storage.key_prefix` | `cosmo_entity_cache` | Backend key prefix |
| `entity_caching.l2.circuit_breaker.failure_threshold` | `5` | Consecutive backend failures before opening |
| `entity_caching.l2.circuit_breaker.cooldown_period` | `10s` | Open-state cooldown before a half-open probe |
| `entity_caching.subgraph_cache_overrides` | empty list | Per-subgraph cache metadata |
| `entity_caching.subgraph_cache_overrides[].name` | required by schema | Subgraph name |
| `entity_caching.subgraph_cache_overrides[].storage_provider_id` | empty string | Subgraph-level provider fallback |
| `entity_caching.subgraph_cache_overrides[].entities` | empty list | Entity cache rules for this subgraph |
| `entity_caching.subgraph_cache_overrides[].entities[].type` | required by schema | Entity type name |
| `entity_caching.subgraph_cache_overrides[].entities[].storage_provider_id` | empty string | Entity-level provider override |
| `entity_caching.subgraph_cache_overrides[].entities[].ttl` | `0` | Per-entry L2 write TTL |
| `entity_caching.subgraph_cache_overrides[].entities[].cache_name` | empty string | Loaded by config but not used for entity provider selection |
| `entity_caching.subgraph_cache_overrides[].entities[].shadow_mode` | `false` | L2 shadow-read mode |
| `entity_caching.subgraph_cache_overrides[].entities[].include_subgraph_header_prefix` | `false` | Includes the subgraph header hash in entity keys |
| `entity_caching.subgraph_cache_overrides[].mutations` | empty list | Mutation cache invalidation and population rules |
| `entity_caching.subgraph_cache_overrides[].mutations[].field_name` | required by schema | Mutation root field name |
| `entity_caching.subgraph_cache_overrides[].mutations[].invalidate_entity_type` | required by schema | Entity type invalidated by the mutation |
| `entity_caching.subgraph_cache_overrides[].mutations[].enable_l2_population` | `false` | Allows mutation payloads to populate L2 |
| `entity_caching.subgraph_cache_overrides[].mutations[].ttl` | `0` | Mutation population TTL |
| `entity_caching.subgraph_cache_overrides[].subscriptions` | empty list | Subscription population and invalidation rules |
| `entity_caching.subgraph_cache_overrides[].subscriptions[].type_name` | required by schema | Entity type name |
| `entity_caching.subgraph_cache_overrides[].subscriptions[].field_name` | required by schema | Subscription root field name |
| `entity_caching.subgraph_cache_overrides[].subscriptions[].cache_name` | required by schema | Named cache selected for subscription writes |
| `entity_caching.subgraph_cache_overrides[].subscriptions[].ttl` | `0` | Subscription population TTL |
| `entity_caching.subgraph_cache_overrides[].subscriptions[].invalidate_on_key_only` | `false` | Invalidates from event keys only |

For `ttl`,
`0` delegates to backend behavior.
The Redis backend keeps an existing key TTL and stores a new key without expiry.
The memory backend uses a five minute internal TTL for zero-TTL writes.
A negative per-entry TTL is passed through by the engine as an indefinite write.

## Storage Providers

Entity caching uses the existing top-level `storage_providers` block.
Only `redis` and `memory` providers are valid L2 backends for entity caching.

| YAML key | DEFAULT | Notes |
| --- | --- | --- |
| `storage_providers.redis[]` | empty list | Redis storage providers |
| `storage_providers.redis[].id` | required by schema | Provider ID used by entity caching |
| `storage_providers.redis[].urls` | required by schema | Redis URLs or cluster seed URLs |
| `storage_providers.redis[].cluster_enabled` | `false` | Uses the Redis cluster client |
| `storage_providers.memory[]` | empty list | In-process memory storage providers |
| `storage_providers.memory[].id` | required by schema | Provider ID used by entity caching |
| `storage_providers.memory[].max_size` | `100MB` | Maximum provider size |

Use Redis for shared cache state across router replicas,
for restart persistence,
and for production L2 deployments.
Use memory for local development,
single-process tests,
or intentionally process-local L2 behavior.

## Provider Precedence

Entity cache provider selection uses this order.

| Scope | Source |
| --- | --- |
| Entity override | `entity_caching.subgraph_cache_overrides[].entities[].storage_provider_id` |
| Subgraph override | `entity_caching.subgraph_cache_overrides[].storage_provider_id` |
| Default provider | `entity_caching.l2.storage.provider_id` |

The default cache name is `default`.
When the resolved provider is `default`,
the router opens the storage provider from `entity_caching.l2.storage.provider_id`.

Subscriptions use `entity_caching.subgraph_cache_overrides[].subscriptions[].cache_name` as the named cache when it is set.
If it is empty after config loading,
the router falls back to `entity_caching.subgraph_cache_overrides[].storage_provider_id`,
then to `default`.

## Development Headers

The router recognizes three per-request headers when request tracing is enabled for that request.

| Header | Effect |
| --- | --- |
| `X-WG-Disable-Entity-Cache: true` | Disables L1 and L2 for the request |
| `X-WG-Disable-Entity-Cache-L1: true` | Disables only L1 for the request |
| `X-WG-Disable-Entity-Cache-L2: true` | Disables only L2 for the request |

These headers are gated by request tracing.
In development mode,
the request can enable tracing with `X-WG-Trace` or `wg_trace`.
Outside development mode,
the same request options require the router request tracing gate to admit the request,
for example through the control-plane request token path.
If the request trace gate is closed,
the entity cache disable headers are ignored.

## Circuit Breaker

Each concrete L2 backend is wrapped in a circuit breaker.
The breaker opens after `failure_threshold` consecutive backend errors.
While open,
`Get` returns aligned cache misses,
`Set` returns success without writing,
and `Delete` returns success without deleting.
This makes backend outages transparent to GraphQL execution.

After `cooldown_period`,
one half-open call probes the backend.
A successful probe closes the breaker.
A failed probe opens it again.

## Shadow Mode

`shadow_mode` enables L2 reads and writes for an entity,
but the engine still serves fresh subgraph data.
Use it to measure cache correctness before serving cache hits.

Shadow comparison results are emitted through the `router.entity_cache.shadow_comparisons` metric.
The metric has `result=fresh` when cached and fresh payloads match.
It has `result=stale` when they differ.

## Metrics

Entity cache analytics are disabled by default.
Enable one or both metric exporters with these fields.

| YAML key | DEFAULT | Notes |
| --- | --- | --- |
| `telemetry.metrics.otlp.entity_caching_stats` | `false` | Exports entity cache metrics through OTLP |
| `telemetry.metrics.prometheus.entity_caching_stats` | `false` | Exports entity cache metrics through Prometheus |

The router exports these entity cache metrics when analytics are enabled.

| Metric | Type | Main labels |
| --- | --- | --- |
| `router.entity_cache.reads` | counter | `cache_level`, `outcome`, `entity_type` |
| `router.entity_cache.writes` | counter | `cache_level`, `entity_type` |
| `router.entity_cache.cached_bytes_served` | counter | none beyond base attributes |
| `router.entity_cache.fetch.duration_milliseconds` | histogram | `subgraph_name`, `cache_name`, `operation` |
| `router.entity_cache.mutations` | counter | `entity_type`, `operation`, `result` |
| `router.entity_cache.shadow_comparisons` | counter | `entity_type`, `result` |
| `router.entity_cache.operation_errors` | counter | `operation`, `cache_name` |

The request execution options enable engine cache analytics only when router metrics say entity cache analytics are enabled.

## Invalidation

Subgraphs can invalidate entity cache keys by returning `extensions.cacheInvalidation.keys`.
The router wires entity invalidation metadata per subgraph and entity type from `subgraph_cache_overrides[].entities`.

Mutation invalidation is configured with `subgraph_cache_overrides[].mutations`.
`field_name` selects the mutation root field.
`invalidate_entity_type` selects the entity type to invalidate.
`enable_l2_population` allows successful mutation payloads to populate L2.
`ttl` controls the population write TTL.

Subscription cache behavior is configured with `subgraph_cache_overrides[].subscriptions`.
`type_name` selects the entity type.
`field_name` selects the subscription root field and must not be empty.
`cache_name` selects the named L2 cache for subscription writes and invalidations.
`ttl` controls subscription population writes.
`invalidate_on_key_only` enables key-only invalidation behavior for subscription events.
