# Task 08: Router FactoryResolver + Executor Integration

## Objective

Transform proto-based entity caching configuration from `DataSourceConfiguration` into engine-level `SubgraphCachingConfig` structures in the FactoryResolver, and wire `LoaderCache` instances into `ResolverOptions` in the Executor. This connects the composition output (proto) to the graphql-go-tools engine.

## Scope

- Add `buildSubgraphCachingConfigs()` to the FactoryResolver Loader
- Add `resolveEntityCacheName()` for per-subgraph cache name resolution
- Extend `ExecutorBuildOptions` with cache fields
- Wire caches into `ResolverOptions` in `Executor.Build()`
- Pass `SubgraphCachingConfig` to the engine factory

## Dependencies

| Task | What it provides |
|------|-----------------|
| Task 00 | **Upgraded graphql-go-tools with `engine.SubgraphCachingConfig`, plan types, `resolve.ResolverOptions.Caches`** |
| Task 01 | Proto messages on `DataSourceConfiguration` (fields 16-19) |
| Task 03 | `LoaderCache` implementations (`RedisEntityCache`, `MemoryEntityCache`) |
| Task 07 | `map[string]resolve.LoaderCache` instances, entity caching config on `graphServer` |

## Files to Modify

### File 1: `router/core/factoryresolver.go`

**Current state**: The `Loader.Load()` function (line 303) builds `plan.Configuration` from engine config and datasources. It iterates through `engineConfig.DatasourceConfigurations` (line 341).

**Add `buildSubgraphCachingConfigs()` method**:

```go
func (l *Loader) buildSubgraphCachingConfigs(
    engineConfig *nodev1.EngineConfiguration,
    subgraphs []*nodev1.Subgraph,
    entityCachingCfg *config.EntityCachingConfiguration,
) []engine.SubgraphCachingConfig {
    var configs []engine.SubgraphCachingConfig
    for _, ds := range engineConfig.DatasourceConfigurations {
        if len(ds.EntityCacheConfigurations) == 0 &&
           len(ds.RootFieldCacheConfigurations) == 0 &&
           len(ds.CachePopulateConfigurations) == 0 &&
           len(ds.CacheInvalidateConfigurations) == 0 {
            continue
        }

        subgraphName := l.subgraphName(subgraphs, ds.Id)
        cfg := engine.SubgraphCachingConfig{
            SubgraphName: subgraphName,
        }

        // Entity cache configurations
        for _, ec := range ds.EntityCacheConfigurations {
            cacheName := l.resolveEntityCacheName(entityCachingCfg, subgraphName, ec.TypeName)
            cfg.EntityCaching = append(cfg.EntityCaching, plan.EntityCacheConfiguration{
                TypeName:                    ec.TypeName,
                CacheName:                   cacheName,
                TTL:                         time.Duration(ec.MaxAgeSeconds) * time.Second,
                IncludeSubgraphHeaderPrefix: ec.IncludeHeaders,
                EnablePartialCacheLoad:      ec.PartialCacheLoad,
                ShadowMode:                  ec.ShadowMode,
                HashAnalyticsKeys:           entityCachingCfg.Analytics.HashEntityKeys,
            })
        }

        // Root field cache configurations
        for _, rfc := range ds.RootFieldCacheConfigurations {
            cacheName := l.resolveEntityCacheName(entityCachingCfg, subgraphName, rfc.EntityTypeName)
            var mappings []plan.EntityKeyMapping
            for _, m := range rfc.EntityKeyMappings {
                var fieldMappings []plan.FieldMapping
                for _, fm := range m.FieldMappings {
                    fieldMappings = append(fieldMappings, plan.FieldMapping{
                        EntityKeyField: fm.EntityKeyField,
                        ArgumentPath:   fm.ArgumentPath,
                    })
                }
                mappings = append(mappings, plan.EntityKeyMapping{
                    EntityTypeName: m.EntityTypeName,
                    FieldMappings:  fieldMappings,
                })
            }
            cfg.RootFieldCaching = append(cfg.RootFieldCaching, plan.RootFieldCacheConfiguration{
                TypeName:                    rfc.EntityTypeName,
                FieldName:                   rfc.FieldName,
                CacheName:                   cacheName,
                TTL:                         time.Duration(rfc.MaxAgeSeconds) * time.Second,
                IncludeSubgraphHeaderPrefix: rfc.IncludeHeaders,
                ShadowMode:                  rfc.ShadowMode,
                EntityKeyMappings:           mappings,
            })
        }

        // Mutation/subscription cache populate
        for _, cp := range ds.CachePopulateConfigurations {
            cfg.MutationFieldCaching = append(cfg.MutationFieldCaching, plan.MutationFieldCacheConfiguration{
                FieldName:                       cp.FieldName,
                EnableEntityL2CachePopulation:   true,
            })
        }

        // Mutation/subscription cache invalidation
        for _, ci := range ds.CacheInvalidateConfigurations {
            cfg.MutationCacheInvalidation = append(cfg.MutationCacheInvalidation, plan.MutationCacheInvalidationConfiguration{
                FieldName:       ci.FieldName,
                EntityTypeName:  ci.EntityTypeName,
            })
        }

        // Subscription entity population (for @cachePopulate on Subscription fields)
        // Note: SubscriptionEntityPopulationConfiguration is populated from entity cache
        // configs for subscription operation types. The engine uses this to populate
        // cache entries when subscription events arrive.
        // This is handled by combining CachePopulateConfigurations where
        // operation_type == "Subscription" with the entity's cache settings.

        configs = append(configs, cfg)
    }
    return configs
}
```

**Add `resolveEntityCacheName()` method**:

```go
func (l *Loader) resolveEntityCacheName(
    cfg *config.EntityCachingConfiguration, subgraphName, typeName string,
) string {
    for _, sg := range cfg.Subgraphs {
        if sg.Name == subgraphName {
            for _, e := range sg.Entities {
                if e.Type == typeName {
                    return e.CacheName
                }
            }
        }
    }
    return "default"
}
```

**Call from `Load()`**: After building datasource configs, call `buildSubgraphCachingConfigs()` and pass to the engine factory:

```go
// In Load(), after building plan datasources:
if entityCachingCfg != nil && entityCachingCfg.Enabled {
    cachingConfigs := l.buildSubgraphCachingConfigs(engineConfig, subgraphs, entityCachingCfg)
    // Pass to engine factory via WithSubgraphEntityCachingConfigs option
}
```

**Engine factory option** (from graphql-go-tools API):

```go
factory := engine.NewFederationEngineConfigFactory(
    ctx,
    subgraphConfigs,
    engine.WithSubgraphEntityCachingConfigs(cachingConfigs),
)
```

### File 2: `router/core/executor.go`

**Current state**: `Build()` function (lines 67-204) creates `resolve.ResolverOptions` and constructs the resolver.

**Extend `ExecutorBuildOptions`** (lines 54-65):

```go
type ExecutorBuildOptions struct {
    // ... existing fields ...
    EntityCacheInstances    map[string]resolve.LoaderCache
    EntityCachingConfig     *config.EntityCachingConfiguration
}
```

**Add cache fields to `ResolverOptions`** in `Build()`:

```go
options := resolve.ResolverOptions{
    // ... existing options ...
    Caches:             opts.EntityCacheInstances,     // map[string]resolve.LoaderCache
    EntityCacheConfigs: buildEntityCacheInvalidationConfigs(opts.EntityCachingConfig, subgraphs, engineConfig),
}
```

**Build entity cache invalidation configs** (for extension-based invalidation):

```go
func buildEntityCacheInvalidationConfigs(
    cfg *config.EntityCachingConfiguration,
    subgraphs []*nodev1.Subgraph,
    engineConfig *nodev1.EngineConfiguration,
) map[string]map[string]*resolve.EntityCacheInvalidationConfig {
    if cfg == nil || !cfg.Enabled {
        return nil
    }
    result := make(map[string]map[string]*resolve.EntityCacheInvalidationConfig)
    for _, ds := range engineConfig.DatasourceConfigurations {
        subgraphName := subgraphNameByID(subgraphs, ds.Id)
        for _, ec := range ds.EntityCacheConfigurations {
            if _, ok := result[subgraphName]; !ok {
                result[subgraphName] = make(map[string]*resolve.EntityCacheInvalidationConfig)
            }
            result[subgraphName][ec.TypeName] = &resolve.EntityCacheInvalidationConfig{
                CacheName:                   resolveEntityCacheName(cfg, subgraphName, ec.TypeName),
                IncludeSubgraphHeaderPrefix: ec.IncludeHeaders,
            }
        }
    }
    return result
}
```

## Data Flow

```
Proto DataSourceConfiguration (from composition JSON)
    ↓
Loader.buildSubgraphCachingConfigs()
    → Maps proto types to engine plan types
    → Resolves cache_name from router YAML per-subgraph config
    → Returns []engine.SubgraphCachingConfig
    ↓
engine.NewFederationEngineConfigFactory(
    configs, WithSubgraphEntityCachingConfigs(cachingConfigs))
    → Engine stores per-subgraph cache configurations
    ↓
Executor.Build()
    → ResolverOptions.Caches = map[string]resolve.LoaderCache (from Task 07)
    → ResolverOptions.EntityCacheConfigs = map[subgraph]map[entity]*Config
    ↓
resolve.New(ctx, options)
    → Resolver has access to caches and configs
    ↓
Per-request execution (Task 09)
    → CachingOptions set on resolve context
    → Engine performs L1/L2 cache operations
```

## Type Mapping Reference

| Proto Type | Engine Plan Type |
|---|---|
| `nodev1.EntityCacheConfiguration` | `plan.EntityCacheConfiguration` |
| `nodev1.RootFieldCacheConfiguration` | `plan.RootFieldCacheConfiguration` |
| `nodev1.EntityKeyMapping` | `plan.EntityKeyMapping` |
| `nodev1.FieldMapping` | `plan.FieldMapping` |
| `nodev1.CachePopulateConfiguration` | `plan.MutationFieldCacheConfiguration` |
| `nodev1.CacheInvalidateConfiguration` | `plan.MutationCacheInvalidationConfiguration` |
| (subscription populate configs) | `plan.SubscriptionEntityPopulationConfiguration` |
| `int64` (max_age_seconds) | `time.Duration` (TTL) |

## Verification

1. **Compilation**: `cd router && go build ./...` succeeds
2. **Unit test `buildSubgraphCachingConfigs()`**: Given proto with cache configs → returns correct engine configs with resolved cache names
3. **Unit test `resolveEntityCacheName()`**: Default fallback, exact match, no-match returns "default"
4. **Executor build**: With cache instances in options → `ResolverOptions.Caches` is populated
5. **Existing tests pass**: `cd router && go test ./...` — no regressions

## Out of Scope

- Proto definition (Task 01)
- Cache backend implementations (Task 03)
- YAML config structs (Task 04)
- Cache instance building and module wiring (Task 07)
- Per-request CachingOptions (Task 09)
- Extension-based invalidation runtime (Task 12)
