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
	s.inMemorySwitchOverCache.enabled = config.cacheWarmup != nil &&
		config.cacheWarmup.Enabled &&
		config.cacheWarmup.Source.InMemorySwitchover.Enabled

	if s.inMemorySwitchOverCache.enabled {
		// Only initialize if its nil (because its a first start or it was disabled before)
		if s.inMemorySwitchOverCache.queriesForFeatureFlag == nil {
			s.inMemorySwitchOverCache.queriesForFeatureFlag = make(map[string]planCache)
		}
		s.inMemorySwitchOverCache.testValue++
	} else {
		s.inMemorySwitchOverCache.queriesForFeatureFlag = nil
	}
}

func (s *SwitchoverConfig) CleanupFeatureFlags(routerCfg *nodev1.RouterConfig) {
	s.inMemorySwitchOverCache.cleanupUnusedFeatureFlags(routerCfg)
}

type InMemorySwitchOverCache struct {
	enabled               bool
	mu                    sync.RWMutex
	testValue             int
	queriesForFeatureFlag map[string]planCache
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
	for ffName, _ := range routerCfg.FeatureFlagConfigs.ConfigByFeatureFlagName {
		ffNames[ffName] = struct{}{}
	}

	for ffName, _ := range c.queriesForFeatureFlag {
		// Skip the base which is ""
		if ffName == "" {
			continue
		}
		if _, exists := ffNames[ffName]; !exists {
			delete(c.queriesForFeatureFlag, ffName)
		}
	}
}
