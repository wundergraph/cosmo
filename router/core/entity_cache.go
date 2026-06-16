package core

import (
	"github.com/wundergraph/cosmo/router/pkg/config"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

const defaultEntityCacheProviderID = "default"

func resolveEntityCacheProviderID(subgraph config.SubgraphCacheOverride, entity config.EntityCacheEntityConfiguration) string {
	if entity.StorageProviderID != "" {
		return entity.StorageProviderID
	}
	if subgraph.StorageProviderID != "" {
		return subgraph.StorageProviderID
	}
	return defaultEntityCacheProviderID
}

func (r *Router) buildEntityCacheInstances() map[string]resolve.LoaderCache {
	return buildEntityCacheInstances(r.entityCaching)
}

func buildEntityCacheInstances(entityCaching config.EntityCachingConfiguration) map[string]resolve.LoaderCache {
	if len(entityCaching.SubgraphCacheOverrides) == 0 {
		return nil
	}

	caches := make(map[string]resolve.LoaderCache)
	for _, subgraph := range entityCaching.SubgraphCacheOverrides {
		for _, entity := range subgraph.Entities {
			providerID := resolveEntityCacheProviderID(subgraph, entity)
			caches[providerID] = nil
		}
	}

	if len(caches) == 0 {
		return nil
	}
	return caches
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
