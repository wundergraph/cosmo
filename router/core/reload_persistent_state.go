package core

import (
	"sync"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"go.uber.org/zap"
)

// ReloadPersistentState This file describes any configuration which should persist or be shared across router restarts
type ReloadPersistentState struct {
	inMemoryPlanCacheFallback *InMemoryPlanCacheFallback
}

func NewReloadPersistentState(logger *zap.Logger) *ReloadPersistentState {
	return &ReloadPersistentState{
		inMemoryPlanCacheFallback: &InMemoryPlanCacheFallback{
			logger: logger,
		},
	}
}

// UpdateReloadPersistentState updates the fallback config based on the provided config.
func (s *ReloadPersistentState) UpdateReloadPersistentState(config *Config) {
	s.inMemoryPlanCacheFallback.updateStateFromConfig(config)
}

// CleanupFeatureFlags cleans up anything related to unused feature flags due to being now excluded
// from the execution config
func (s *ReloadPersistentState) CleanupFeatureFlags(routerCfg *nodev1.RouterConfig) {
	s.inMemoryPlanCacheFallback.cleanupUnusedFeatureFlags(routerCfg)
}

func (s *ReloadPersistentState) OnRouterConfigReload() {
	// For cases of router config changes (not execution config), we shut down before creating the
	// graph mux, because we need to initialize everything from the start
	// This causes problems in using the previous planCache reference as it gets closed, so we need to
	// copy it over before it gets closed, and we restart with config changes

	// There can be inflight requests when this is called even though it's called in the restart path,
	// This is because this is called before the router instance is shutdown before being reloaded
	s.inMemoryPlanCacheFallback.extractQueriesAndOverridePlanCache()
}

// InMemoryPlanCacheFallback is a store that stores expensive query cache references or extracted operations
// for use with the cache warmer across config reloads. Only expensive queries (planning duration >= threshold)
// are persisted.
type InMemoryPlanCacheFallback struct {
	mu              sync.RWMutex
	expensiveCaches map[string]*expensivePlanCache // live references during runtime
	cachedOps       map[string][]*nodev1.Operation // extracted snapshots after reload
	logger          *zap.Logger
}

// updateStateFromConfig updates the internal state of the in-memory fallback cache based on the provided config
func (c *InMemoryPlanCacheFallback) updateStateFromConfig(config *Config) {
	enabled := config.cacheWarmup != nil &&
		config.cacheWarmup.Enabled &&
		config.cacheWarmup.InMemoryFallback

	c.mu.Lock()
	defer c.mu.Unlock()

	// If the configuration change occurred which disabled or enabled the fallback cache, we need to update the internal state
	if enabled {
		// Only initialize if its nil because its a first start, we dont want to override any old data in a map
		if c.expensiveCaches == nil {
			c.expensiveCaches = make(map[string]*expensivePlanCache)
		}
		if c.cachedOps == nil {
			c.cachedOps = make(map[string][]*nodev1.Operation)
		}
		return
	}

	// Reset the maps to free up memory
	c.expensiveCaches = nil
	c.cachedOps = nil
}

// IsEnabled returns whether the in-memory fallback cache is enabled
func (c *InMemoryPlanCacheFallback) IsEnabled() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()

	return c.expensiveCaches != nil
}

// getCachedOperationsForFF returns all cached operations for a feature flag key.
func (c *InMemoryPlanCacheFallback) getCachedOperationsForFF(featureFlagKey string) []*nodev1.Operation {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if c.cachedOps == nil {
		return nil
	}

	return c.cachedOps[featureFlagKey]
}

// setExpensiveCacheForFF stores the expensive plan cache reference for a feature flag key
// so that expensive query entries survive config reloads.
func (c *InMemoryPlanCacheFallback) setExpensiveCacheForFF(featureFlagKey string, cache *expensivePlanCache) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.expensiveCaches == nil || cache == nil {
		return
	}
	c.expensiveCaches[featureFlagKey] = cache
}

// extractQueriesAndOverridePlanCache extracts operations from the expensive plan caches
// and stores them in cachedOps so they survive config reloads.
func (c *InMemoryPlanCacheFallback) extractQueriesAndOverridePlanCache() {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.expensiveCaches == nil {
		return
	}

	// Wait for all pending writes from expensive caches so that
	// IterValues sees a complete snapshot before we extract.
	for _, expCache := range c.expensiveCaches {
		expCache.Wait()
	}

	cachedOps := make(map[string][]*nodev1.Operation)
	for k, expCache := range c.expensiveCaches {
		var ops []*nodev1.Operation
		expCache.IterValues(func(v *planWithMetaData) bool {
			if v.content != "" {
				ops = append(ops, &nodev1.Operation{
					Request: &nodev1.OperationRequest{Query: v.content},
				})
			}
			return false
		})
		if len(ops) > 0 {
			cachedOps[k] = ops
		}
	}
	c.cachedOps = cachedOps
	c.expensiveCaches = make(map[string]*expensivePlanCache)
}

// cleanupUnusedFeatureFlags removes any feature flags that were removed from the execution config
// after a schema / execution config change
func (c *InMemoryPlanCacheFallback) cleanupUnusedFeatureFlags(routerCfg *nodev1.RouterConfig) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.expensiveCaches == nil {
		return
	}

	for ffName := range c.expensiveCaches {
		// Skip the base which is ""
		if ffName == "" {
			continue
		}
		if routerCfg.FeatureFlagConfigs == nil {
			delete(c.expensiveCaches, ffName)
			delete(c.cachedOps, ffName)
		} else if _, exists := routerCfg.FeatureFlagConfigs.ConfigByFeatureFlagName[ffName]; !exists {
			delete(c.expensiveCaches, ffName)
			delete(c.cachedOps, ffName)
		}
	}
}
