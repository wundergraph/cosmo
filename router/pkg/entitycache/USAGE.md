# Entity Caching Configuration

## Complete Example

```yaml
version: "1"

# Storage providers define the backing stores available for entity caching.
# Each provider has a unique ID referenced by entity caching configuration.
storage_providers:
  redis:
    - id: "main-redis"
      urls:
        - "redis://redis:6379"
      cluster_enabled: false
    - id: "fast-redis"
      urls:
        - "redis://fast-redis:6379"
      cluster_enabled: false
  memory:
    - id: "hot-cache"
      max_size: "100MB"            # Human-readable via BytesString
    - id: "small-cache"
      max_size: "10MB"

entity_caching:
  enabled: true
  global_cache_key_prefix: "v1"    # Separate cache entries when schema changes
  l1:
    enabled: true                  # Per-request in-memory dedup (always recommended)
  l2:
    enabled: true
    storage:
      provider_id: "hot-cache"     # Default L2 backend — in-memory, no Redis needed!
      key_prefix: "cosmo_entity_cache"
    circuit_breaker:
      enabled: true                # Protects against cache backend failures
      failure_threshold: 5
      cooldown_period: "10s"
  analytics:
    enabled: true
    hash_entity_keys: false
  # Optional: route specific subgraphs/entities to different backends.
  # 3-tier precedence: entity override > subgraph override > global default.
  subgraph_cache_overrides:
    - name: "products"
      storage_provider_id: "fast-redis"     # All products entities → fast Redis by default
      entities:
        - type: "Category"
          storage_provider_id: "hot-cache"  # Override: static data → in-memory
        # Product uses "fast-redis" (inherited from subgraph level)
        # Review uses "fast-redis" (inherited from subgraph level)
    - name: "accounts"
      storage_provider_id: "main-redis"     # All accounts entities → main Redis
      # No per-entity overrides needed — all use main-redis
    # Pre-configuring for a subgraph being deployed soon — router logs a
    # warning but starts normally:
    - name: "recommendations"
      storage_provider_id: "fast-redis"
```

## Precedence Resolution

```
Entity "Category" in subgraph "products":
  1. Entity-level: storage_provider_id = "hot-cache"  → uses "hot-cache"

Entity "Product" in subgraph "products":
  1. Entity-level: not configured
  2. Subgraph-level: storage_provider_id = "fast-redis"  → uses "fast-redis"

Entity "Order" (not in any override):
  1. Entity-level: not configured
  2. Subgraph-level: not configured
  3. Global default: l2.storage.provider_id = "hot-cache" → uses "hot-cache"
```

## Behavior Summary

| Scenario | Behavior |
|----------|----------|
| Entity not in overrides, subgraph not in overrides | Uses global `l2.storage.provider_id` |
| Entity not in overrides, subgraph has `storage_provider_id` | Uses subgraph-level provider |
| Entity has `storage_provider_id` | Uses entity-level provider (highest priority) |
| Override references unknown subgraph | Warning log, router starts normally |
| Override references unknown entity type | Warning log, router starts normally |
| `storage_provider_id` references unknown provider | **Error** — router fails to start |
| Memory provider as default, Redis for overrides | Supported — mix freely |
| Redis provider as default, memory for overrides | Supported — mix freely |
