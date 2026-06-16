package core

import (
	"fmt"
	"io"

	"github.com/wundergraph/cosmo/router/pkg/config"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

const defaultEntityCacheProviderID = "default"
const defaultEntityCacheKeyPrefix = "cosmo_entity_cache"

func resolveEntityCacheProviderID(subgraph config.SubgraphCacheOverride, entity config.EntityCacheEntityConfiguration) string {
	if entity.StorageProviderID != "" {
		return entity.StorageProviderID
	}
	if subgraph.StorageProviderID != "" {
		return subgraph.StorageProviderID
	}
	return defaultEntityCacheProviderID
}

func (r *Router) buildEntityCacheInstances() (map[string]resolve.LoaderCache, error) {
	return buildEntityCacheInstances(r.entityCaching, r.providerRegistry, r.logger)
}

func buildEntityCacheInstances(entityCaching config.EntityCachingConfiguration, registry *ProviderRegistry, logger *zap.Logger) (map[string]resolve.LoaderCache, error) {
	if len(entityCaching.SubgraphCacheOverrides) == 0 {
		return nil, nil
	}

	caches := make(map[string]resolve.LoaderCache)
	for _, subgraph := range entityCaching.SubgraphCacheOverrides {
		for _, entity := range subgraph.Entities {
			providerID := resolveEntityCacheProviderID(subgraph, entity)
			caches[providerID] = nil
		}
	}

	if len(caches) == 0 {
		return nil, nil
	}

	if !entityCaching.L2.Enabled || registry == nil {
		return caches, nil
	}

	for cacheName := range caches {
		storageProviderID := cacheName
		if cacheName == defaultEntityCacheProviderID {
			storageProviderID = entityCaching.L2.Storage.ProviderID
		}
		if storageProviderID == "" {
			continue
		}
		redisProvider, ok := registry.Redis(storageProviderID)
		if ok {
			cache, err := newRedisEntityCache(logger, redisProvider, entityCaching.L2.Storage.KeyPrefix)
			if err != nil {
				closeEntityCacheInstances(caches)
				return nil, fmt.Errorf("failed to create Redis entity cache %q with storage provider %q: %w", cacheName, storageProviderID, err)
			}
			caches[cacheName] = newCircuitBreakerCache(cache, entityCaching.L2.CircuitBreaker)
			continue
		}

		memoryProvider, ok := registry.Memory(storageProviderID)
		if ok {
			caches[cacheName] = newCircuitBreakerCache(newMemoryEntityCache(memoryProvider, entityCaching.L2.Storage.KeyPrefix), entityCaching.L2.CircuitBreaker)
		}
	}

	return caches, nil
}

func closeEntityCacheInstances(caches map[string]resolve.LoaderCache) {
	for _, cache := range caches {
		if closer, ok := cache.(io.Closer); ok {
			_ = closer.Close()
		}
	}
}

func buildEntityCacheInvalidationConfigs(entityCaching config.EntityCachingConfiguration) map[string]map[string]*resolve.EntityCacheInvalidationConfig {
	if len(entityCaching.SubgraphCacheOverrides) == 0 {
		return nil
	}

	out := make(map[string]map[string]*resolve.EntityCacheInvalidationConfig)
	for _, subgraph := range entityCaching.SubgraphCacheOverrides {
		if subgraph.Name == "" {
			continue
		}
		for _, entity := range subgraph.Entities {
			if entity.Type == "" {
				continue
			}
			if out[subgraph.Name] == nil {
				out[subgraph.Name] = make(map[string]*resolve.EntityCacheInvalidationConfig)
			}
			out[subgraph.Name][entity.Type] = &resolve.EntityCacheInvalidationConfig{
				CacheName: resolveEntityCacheProviderID(subgraph, entity),
			}
		}
	}

	if len(out) == 0 {
		return nil
	}
	return out
}
