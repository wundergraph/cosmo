package core

import (
	"github.com/dgraph-io/ristretto/v2"
	"sync"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

// This file describes any configuration which should persist across router restarts
type SwitchoverConfig struct {
	CacheWarmerQueries *CacheWarmerQueries
}

type planCache *ristretto.Cache[uint64, *planWithMetaData]

type CacheWarmerQueries struct {
	mu                    sync.RWMutex
	queriesForFeatureFlag map[string]planCache
}

func NewSwitchoverConfig(config *Config) *SwitchoverConfig {
	switchoverConfig := &SwitchoverConfig{}

	inMemorySwitchoverCacheWarmerEnabled := config.cacheWarmup != nil && config.cacheWarmup.Enabled && config.cacheWarmup.Source.InMemorySwitchover.Enabled

	if inMemorySwitchoverCacheWarmerEnabled {
		switchoverConfig.CacheWarmerQueries = &CacheWarmerQueries{
			queriesForFeatureFlag: make(map[string]planCache),
		}
	}

	return switchoverConfig
}

func (s *SwitchoverConfig) CleanupFeatureFlags(routerCfg *nodev1.RouterConfig) {
	s.CacheWarmerQueries.cleanupUnusedFeatureFlags(routerCfg)
}

func (c *CacheWarmerQueries) getPlanCacheForFF(featureFlagKey string) planCache {
	c.mu.RLock()
	warmer, _ := c.queriesForFeatureFlag[featureFlagKey]
	c.mu.RUnlock()
	return warmer
}

func (c *CacheWarmerQueries) setPlanCacheForFF(featureFlagKey string, cache planCache) bool {
	// If not initialized will return nil
	if c == nil || cache == nil {
		return false
	}

	c.mu.RLock()
	_, exists := c.queriesForFeatureFlag[featureFlagKey]
	c.mu.RUnlock()

	if exists {
		return true
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	// Double-check in case another goroutine created it while we were waiting for the write lock
	_, exists = c.queriesForFeatureFlag[featureFlagKey]
	if exists {
		return true
	}

	c.queriesForFeatureFlag[featureFlagKey] = cache
	return true
}

func (c *CacheWarmerQueries) cleanupUnusedFeatureFlags(routerCfg *nodev1.RouterConfig) {
	if c == nil {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	ffNames := make(map[string]struct{})
	for ffName, _ := range routerCfg.FeatureFlagConfigs.ConfigByFeatureFlagName {
		ffNames[ffName] = struct{}{}
	}

	for ffName, _ := range c.queriesForFeatureFlag {
		if _, exists := ffNames[ffName]; !exists {
			delete(c.queriesForFeatureFlag, ffName)
		}
	}
}
