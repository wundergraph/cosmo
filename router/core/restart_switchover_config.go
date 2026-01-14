package core

import (
	"sync"

	"github.com/dgraph-io/ristretto/v2"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

type planCache *ristretto.Cache[uint64, *planWithMetaData]

// SwitchoverConfig This file describes any configuration which should persist or be shared across router restarts
type SwitchoverConfig struct {
	inMemorySwitchOverCache *InMemorySwitchOverCache
}

func NewSwitchoverConfig() *SwitchoverConfig {
	return &SwitchoverConfig{
		inMemorySwitchOverCache: &InMemorySwitchOverCache{},
	}
}

func (s *SwitchoverConfig) UpdateSwitchoverConfig(config *Config) {
	s.inMemorySwitchOverCache.UpdateInMemorySwitchOverCacheForConfigChanges(config)
}

func (s *SwitchoverConfig) CleanupFeatureFlags(routerCfg *nodev1.RouterConfig) {
	s.inMemorySwitchOverCache.cleanupUnusedFeatureFlags(routerCfg)
}

type InMemorySwitchOverCache struct {
	enabled               bool
	mu                    sync.RWMutex
	queriesForFeatureFlag map[string]planCache
}

func (c *InMemorySwitchOverCache) UpdateInMemorySwitchOverCacheForConfigChanges(config *Config) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	c.enabled = config.cacheWarmup != nil &&
		config.cacheWarmup.Enabled &&
		config.cacheWarmup.Source.InMemorySwitchover.Enabled

	// If the configuration change occurred which disabled or enabled the switchover cache, we need to update the internal state
	if c.enabled {
		// Only initialize if its nil (because its a first start or it was disabled before)
		if c.queriesForFeatureFlag == nil {
			c.queriesForFeatureFlag = make(map[string]planCache)
		}
	} else {
		c.queriesForFeatureFlag = nil
	}
}

func (c *InMemorySwitchOverCache) getPlanCacheForFF(featureFlagKey string) planCache {
	if !c.enabled {
		return nil
	}

	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.queriesForFeatureFlag[featureFlagKey]
}

func (c *InMemorySwitchOverCache) setPlanCacheForFF(featureFlagKey string, cache *ristretto.Cache[uint64, *planWithMetaData]) {
	if !c.enabled || cache == nil {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	c.queriesForFeatureFlag[featureFlagKey] = cache
}

func (c *InMemorySwitchOverCache) cleanupUnusedFeatureFlags(routerCfg *nodev1.RouterConfig) {
	if !c.enabled {
		return
	}

	if routerCfg.FeatureFlagConfigs == nil {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	ffNames := make(map[string]struct{})
	for ffName := range routerCfg.FeatureFlagConfigs.ConfigByFeatureFlagName {
		ffNames[ffName] = struct{}{}
	}

	for ffName := range c.queriesForFeatureFlag {
		// Skip the base which is ""
		if ffName == "" {
			continue
		}
		if _, exists := ffNames[ffName]; !exists {
			delete(c.queriesForFeatureFlag, ffName)
		}
	}
}
