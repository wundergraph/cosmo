package core

import (
	"sync"
	"sync/atomic"

	"go.uber.org/zap"

	"github.com/dgraph-io/ristretto/v2"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
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

func (s *SwitchoverConfig) UpdateSwitchoverConfig(config *Config, isCosmoCacheWarmerEnabled bool) {
	s.inMemorySwitchOverCache.updateStateFromConfig(config, isCosmoCacheWarmerEnabled)
}

func (s *SwitchoverConfig) CleanupFeatureFlags(routerCfg *nodev1.RouterConfig) {
	s.inMemorySwitchOverCache.cleanupUnusedFeatureFlags(routerCfg)
}

func (s *SwitchoverConfig) ProcessOnConfigChangeRestart() {
	// For cases of router config changes (not execution config), we shut down before creating the
	// graph mux, because we need to initialize everything from the start
	// This causes problems in using the previous planCache reference as it gets closed, so we need to
	// copy it over before it gets closed, and we restart with config changes

	// There can be inflight requests when this is called even though it's called in the restart path,
	// This is because this is called before the router instance is shutdown before being reloaded
	s.inMemorySwitchOverCache.processOnConfigChangeRestart()
}

type InMemorySwitchOverCache struct {
	enabled               atomic.Bool
	mu                    sync.RWMutex
	queriesForFeatureFlag map[string]any
	logger                *zap.Logger
}

func (c *InMemorySwitchOverCache) updateStateFromConfig(config *Config, isCosmoCacheWarmerEnabled bool) {
	enabled := config.cacheWarmup != nil &&
		!isCosmoCacheWarmerEnabled && // We only enable in-memory switchover cache if the cosmo cache warmer is not enabled
		config.cacheWarmup.Enabled &&
		config.cacheWarmup.InMemorySwitchoverFallback

	c.mu.Lock()
	defer c.mu.Unlock()

	c.enabled.Store(enabled)

	// If the configuration change occurred which disabled or enabled the switchover cache, we need to update the internal state
	if enabled {
		// Only initialize if its nil (because its a first start or it was disabled before)
		if c.queriesForFeatureFlag == nil {
			c.queriesForFeatureFlag = make(map[string]any)
		}
	} else {
		c.queriesForFeatureFlag = nil
	}
}

func (c *InMemorySwitchOverCache) getPlanCacheForFF(featureFlagKey string) []*nodev1.Operation {
	if !c.enabled.Load() {
		return nil
	}

	c.mu.RLock()
	defer c.mu.RUnlock()

	switch cache := c.queriesForFeatureFlag[featureFlagKey].(type) {
	case planCache:
		return convertToNodeOperation(cache)
	case []*nodev1.Operation:
		return cache
	case nil:
		// This would occur during the first start
		return make([]*nodev1.Operation, 0)
	default:
		// This should not happen as we cannot have any types other than the above
		c.logger.Error("unexpected type")
		return make([]*nodev1.Operation, 0)
	}
}

func (c *InMemorySwitchOverCache) setPlanCacheForFF(featureFlagKey string, cache planCache) {
	if !c.enabled.Load() || cache == nil {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	c.queriesForFeatureFlag[featureFlagKey] = cache
}

func (c *InMemorySwitchOverCache) processOnConfigChangeRestart() {
	if !c.enabled.Load() {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	switchoverMap := make(map[string]any)
	for k, v := range c.queriesForFeatureFlag {
		if cache, ok := v.(planCache); ok {
			switchoverMap[k] = convertToNodeOperation(cache)
		}
	}
	c.queriesForFeatureFlag = switchoverMap
}

func (c *InMemorySwitchOverCache) cleanupUnusedFeatureFlags(routerCfg *nodev1.RouterConfig) {
	if !c.enabled.Load() || routerCfg.FeatureFlagConfigs == nil {
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

func convertToNodeOperation(data planCache) []*nodev1.Operation {
	items := make([]*nodev1.Operation, 0)
	data.IterValues(func(v *planWithMetaData) (stop bool) {
		items = append(items, &nodev1.Operation{
			Request: &nodev1.OperationRequest{Query: v.content},
		})
		return false
	})
	return items
}
