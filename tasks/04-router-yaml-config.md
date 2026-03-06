# Task 04: Router YAML Config Structs

## Objective

Add the `EntityCachingConfiguration` struct hierarchy to the router's Go config so that the router can parse entity caching settings from YAML, apply defaults, and allow environment variable overrides.

## Scope

- Add 7 new Go structs to `config.go`
- Add one new field (`EntityCaching`) to the main `Config` struct
- No behavioral changes — this task is config parsing only
- No new files; single file modification

## Dependencies

None. This task has no dependencies on other tasks.

## File to Modify

**File**: `router/pkg/config/config.go`

### Insertion Points

**1. Main `Config` struct** (line 1104)

Add the `EntityCaching` field near the other storage/caching-related fields, after `StorageProviders` (line 1170) and before `ExecutionConfig` (line 1171):

```go
StorageProviders               StorageProviders                `yaml:"storage_providers"`
EntityCaching                  EntityCachingConfiguration      `yaml:"entity_caching,omitempty"`
ExecutionConfig                ExecutionConfig                 `yaml:"execution_config"`
```

**2. Struct definitions**

Add the new struct definitions near the existing storage/caching structs, after the `AutomaticPersistedQueriesConfig` block (around line 960).

## Complete Go Struct Definitions

```go
// EntityCachingConfiguration controls the entity caching system.
// Storage references a named provider from storage_providers.redis
// (like persisted_operations.storage.provider_id).
type EntityCachingConfiguration struct {
	Enabled   bool                          `yaml:"enabled" envDefault:"false" env:"ENTITY_CACHING_ENABLED"`
	L1        EntityCachingL1Configuration  `yaml:"l1"`
	L2        EntityCachingL2Configuration  `yaml:"l2"`
	Analytics EntityCachingAnalyticsConfig  `yaml:"analytics"`
	Subgraphs []EntityCachingSubgraphConfig `yaml:"subgraphs,omitempty"`
}

type EntityCachingL1Configuration struct {
	Enabled bool `yaml:"enabled" envDefault:"true" env:"ENTITY_CACHING_L1_ENABLED"`
}

type EntityCachingL2Configuration struct {
	Enabled bool                         `yaml:"enabled" envDefault:"true" env:"ENTITY_CACHING_L2_ENABLED"`
	Storage EntityCachingL2StorageConfig `yaml:"storage"`
}

type EntityCachingL2StorageConfig struct {
	ProviderID string `yaml:"provider_id,omitempty" env:"ENTITY_CACHING_L2_STORAGE_PROVIDER_ID"`
	KeyPrefix  string `yaml:"key_prefix,omitempty" envDefault:"cosmo_entity_cache" env:"ENTITY_CACHING_L2_STORAGE_KEY_PREFIX"`
}

type EntityCachingAnalyticsConfig struct {
	Enabled        bool `yaml:"enabled" envDefault:"false" env:"ENTITY_CACHING_ANALYTICS_ENABLED"`
	HashEntityKeys bool `yaml:"hash_entity_keys" envDefault:"false" env:"ENTITY_CACHING_ANALYTICS_HASH_ENTITY_KEYS"`
}

type EntityCachingSubgraphConfig struct {
	Name     string                      `yaml:"name"`
	Entities []EntityCachingEntityConfig `yaml:"entities,omitempty"`
}

type EntityCachingEntityConfig struct {
	Type      string `yaml:"type"`
	CacheName string `yaml:"cache_name,omitempty" envDefault:"default"`
}
```

## Field-by-Field Reference

### EntityCachingConfiguration

| Field | YAML Key | Type | Default | Env Var |
|-------|----------|------|---------|---------|
| `Enabled` | `enabled` | bool | `false` | `ENTITY_CACHING_ENABLED` |
| `L1` | `l1` | struct | — | — |
| `L2` | `l2` | struct | — | — |
| `Analytics` | `analytics` | struct | — | — |
| `Subgraphs` | `subgraphs` | []struct | nil | — |

### EntityCachingL1Configuration

| Field | YAML Key | Type | Default | Env Var |
|-------|----------|------|---------|---------|
| `Enabled` | `enabled` | bool | `true` | `ENTITY_CACHING_L1_ENABLED` |

### EntityCachingL2Configuration

| Field | YAML Key | Type | Default | Env Var |
|-------|----------|------|---------|---------|
| `Enabled` | `enabled` | bool | `true` | `ENTITY_CACHING_L2_ENABLED` |
| `Storage` | `storage` | struct | — | — |

### EntityCachingL2StorageConfig

| Field | YAML Key | Type | Default | Env Var |
|-------|----------|------|---------|---------|
| `ProviderID` | `provider_id` | string | `""` | `ENTITY_CACHING_L2_STORAGE_PROVIDER_ID` |
| `KeyPrefix` | `key_prefix` | string | `"cosmo_entity_cache"` | `ENTITY_CACHING_L2_STORAGE_KEY_PREFIX` |

### EntityCachingAnalyticsConfig

| Field | YAML Key | Type | Default | Env Var |
|-------|----------|------|---------|---------|
| `Enabled` | `enabled` | bool | `false` | `ENTITY_CACHING_ANALYTICS_ENABLED` |
| `HashEntityKeys` | `hash_entity_keys` | bool | `false` | `ENTITY_CACHING_ANALYTICS_HASH_ENTITY_KEYS` |

### EntityCachingSubgraphConfig

| Field | YAML Key | Type | Default |
|-------|----------|------|---------|
| `Name` | `name` | string | required |
| `Entities` | `entities` | []struct | nil |

### EntityCachingEntityConfig

| Field | YAML Key | Type | Default |
|-------|----------|------|---------|
| `Type` | `type` | string | required |
| `CacheName` | `cache_name` | string | `"default"` |

## How provider_id References storage_providers.redis

The `ProviderID` field references a `RedisStorageProvider` by its `ID` field (line 887-891), exactly like `PersistedOperationsStorageConfig.ProviderID`:

```yaml
storage_providers:
  redis:
    - id: "default"          # <-- referenced by provider_id
      urls:
        - "redis://localhost:6379"

entity_caching:
  l2:
    storage:
      provider_id: "default" # <-- references storage_providers.redis[].id
```

The per-subgraph `cache_name` follows the same pattern — it also references `storage_providers.redis[].id`. When `"default"`, uses the same backend as `l2.storage.provider_id`.

## Verification

1. **Compilation**: `cd router && go build ./...` succeeds
2. **Default values**: Parse empty `entity_caching:` block — verify `Enabled=false`, `L1.Enabled=true`, `L2.Enabled=true`, `L2.Storage.KeyPrefix="cosmo_entity_cache"`, etc.
3. **Env var overrides**: Set `ENTITY_CACHING_ENABLED=true` and verify it overrides YAML default
4. **Full YAML parsing**: Parse the complete example from `ENTITY_CACHING_CONFIGURATION.md` — all fields populated correctly
5. **Existing tests pass**: `cd router && go test ./pkg/config/...`

## Example YAML

```yaml
entity_caching:
  enabled: true
  l1:
    enabled: true
  l2:
    enabled: true
    storage:
      provider_id: "default"
      key_prefix: "cosmo_entity_cache"
  analytics:
    enabled: true
    hash_entity_keys: false
  subgraphs:
    - name: "products"
      entities:
        - type: "Product"
          cache_name: "fast-cache"
        - type: "Review"
          cache_name: "default"
    - name: "accounts"
      entities:
        - type: "User"
          cache_name: "persistent-cache"
```
