package core

import (
	"sync"

	"github.com/dgraph-io/ristretto/v2"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"go.uber.org/zap"
)

type planCache = *ristretto.Cache[uint64, *planWithMetaData]

// SwitchoverConfig This file describes any configuration which should persist or be shared across router restarts
type SwitchoverConfig struct {
	inMemorySwitchOverCache *InMemorySwitchOverCache
}

func NewSwitchoverConfig(logger *zap.Logger) *SwitchoverConfig {
	return &SwitchoverConfig{
		inMemorySwitchOverCache: &InMemorySwitchOverCache{
			logger: logger,
		},
	}
}

// UpdateSwitchoverConfig updates the switchover config based on the provided config.
func (s *SwitchoverConfig) UpdateSwitchoverConfig(config *Config, isCosmoCacheWarmerEnabled bool) {
	s.inMemorySwitchOverCache.updateStateFromConfig(config, isCosmoCacheWarmerEnabled)
}

// CleanupFeatureFlags cleans up anything related to unused feature flags due to being now excluded
// from the execution config
func (s *SwitchoverConfig) CleanupFeatureFlags(routerCfg *nodev1.RouterConfig) {
	s.inMemorySwitchOverCache.cleanupUnusedFeatureFlags(routerCfg)
}

func (s *SwitchoverConfig) OnRouterConfigReload() {
	// For cases of router config changes (not execution config), we shut down before creating the
	// graph mux, because we need to initialize everything from the start
	// This causes problems in using the previous planCache reference as it gets closed, so we need to
	// copy it over before it gets closed, and we restart with config changes

	// There can be inflight requests when this is called even though it's called in the restart path,
	// This is because this is called before the router instance is shutdown before being reloaded
	s.inMemorySwitchOverCache.extractQueriesAndOverridePlanCache()
}

// InMemorySwitchOverCache is a store that stores either queries or references to the planner cache for use with the cache warmer
type InMemorySwitchOverCache struct {
	mu                    sync.RWMutex
	queriesForFeatureFlag map[string]any
	logger                *zap.Logger
}

// updateStateFromConfig updates the internal state of the in-memory switchover cache based on the provided config
func (c *InMemorySwitchOverCache) updateStateFromConfig(config *Config, isCosmoCacheWarmerEnabled bool) {
	enabled := config.cacheWarmup != nil &&
		!isCosmoCacheWarmerEnabled && // We only enable in-memory switchover cache if the cosmo cache warmer is not enabled
		config.cacheWarmup.Enabled &&
		config.cacheWarmup.InMemorySwitchoverFallback

	c.mu.Lock()
	defer c.mu.Unlock()

	// If the configuration change occurred which disabled or enabled the switchover cache, we need to update the internal state
	if enabled {
		// Only initialize if its nil because its a first start, we dont want to override any old data in a map
		if c.queriesForFeatureFlag == nil {
			c.queriesForFeatureFlag = make(map[string]any)
		}
		return
	}

	// Reset the map to free up memory
	c.queriesForFeatureFlag = nil
}

// IsEnabled returns whether the in-memory switchover cache is enabled
func (c *InMemorySwitchOverCache) IsEnabled() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()

	return c.queriesForFeatureFlag != nil
}

// getPlanCacheForFF gets the plan cache in the []*nodev1.Operation format for a specific feature flag key
func (c *InMemorySwitchOverCache) getPlanCacheForFF(featureFlagKey string) []*nodev1.Operation {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if c.queriesForFeatureFlag == nil {
		return nil
	}

	switch cache := c.queriesForFeatureFlag[featureFlagKey].(type) {
	case planCache:
		return convertToNodeOperation(cache)
	case []*nodev1.Operation:
		return cache
	// This would occur during the first start (we add this case to specifically log any other cases)
	case nil:
		return nil
	// This should not happen as we cannot have any types other than the above
	default:
		c.logger.Error("unexpected type")
		return nil
	}
}

// setPlanCacheForFF sets the plan cache for a specific feature flag key
func (c *InMemorySwitchOverCache) setPlanCacheForFF(featureFlagKey string, cache planCache) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.queriesForFeatureFlag == nil || cache == nil {
		return
	}
	c.queriesForFeatureFlag[featureFlagKey] = cache
}

// extractQueriesAndOverridePlanCache extracts the queries from the plan cache and overrides the internal map
func (c *InMemorySwitchOverCache) extractQueriesAndOverridePlanCache() {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.queriesForFeatureFlag == nil {
		return
	}

	switchoverMap := make(map[string]any)
	for k, v := range c.queriesForFeatureFlag {
		if cache, ok := v.(planCache); ok {
			switchoverMap[k] = convertToNodeOperation(cache)
		}
	}
	c.queriesForFeatureFlag = switchoverMap
}

// cleanupUnusedFeatureFlags removes any feature flags from the in-memory switchover cache
// this is useful in case where the updated execution config excludes a feature flag
func (c *InMemorySwitchOverCache) cleanupUnusedFeatureFlags(routerCfg *nodev1.RouterConfig) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.queriesForFeatureFlag == nil || routerCfg.FeatureFlagConfigs == nil {
		return
	}

	for ffName := range c.queriesForFeatureFlag {
		// Skip the base which is ""
		if ffName == "" {
			continue
		}
		if _, exists := routerCfg.FeatureFlagConfigs.ConfigByFeatureFlagName[ffName]; !exists {
			delete(c.queriesForFeatureFlag, ffName)
		}
	}
}

func convertToNodeOperation(data planCache) []*nodev1.Operation {
	items := make([]*nodev1.Operation, 0)

	// Ensure any buffered writes have been applied
	data.Wait()

	data.IterValues(func(v *planWithMetaData) (stop bool) {
		items = append(items, &nodev1.Operation{
			Request: &nodev1.OperationRequest{Query: v.content},
		})
		return false
	})
	return items
}
