package core

import (
	"testing"

	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

func TestInMemoryPlanCacheFallback_UpdateInMemoryFallbackCacheForConfigChanges(t *testing.T) {
	t.Parallel()
	t.Run("enable cache from disabled state", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{}
		cfg := &Config{
			cacheWarmup: &config.CacheWarmupConfiguration{
				Enabled:          true,
				InMemoryFallback: true,
			},
		}

		cache.updateStateFromConfig(cfg)

		require.NotNil(t, cache.expensiveCaches)
		require.Empty(t, cache.expensiveCaches)
		require.NotNil(t, cache.cachedOps)
		require.Empty(t, cache.cachedOps)
	})

	t.Run("disable cache from enabled state", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			expensiveCaches: make(map[string]*expensivePlanCache),
			cachedOps:       make(map[string][]*nodev1.Operation),
		}

		cfg := &Config{
			cacheWarmup: &config.CacheWarmupConfiguration{
				Enabled: false,
			},
		}

		cache.updateStateFromConfig(cfg)

		require.Nil(t, cache.expensiveCaches)
		require.Nil(t, cache.cachedOps)
	})

	t.Run("update when already enabled keeps existing data", func(t *testing.T) {
		t.Parallel()
		existingCaches := make(map[string]*expensivePlanCache)
		existingCaches["test"] = nil

		cache := &InMemoryPlanCacheFallback{
			expensiveCaches: existingCaches,
			cachedOps:       make(map[string][]*nodev1.Operation),
		}

		cfg := &Config{
			cacheWarmup: &config.CacheWarmupConfiguration{
				Enabled:          true,
				InMemoryFallback: true,
			},
		}

		cache.updateStateFromConfig(cfg)

		require.NotNil(t, cache.expensiveCaches)
		require.Len(t, cache.expensiveCaches, 1)
		require.Contains(t, cache.expensiveCaches, "test")
	})

	t.Run("update when already disabled", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			expensiveCaches: nil,
		}

		cfg := &Config{
			cacheWarmup: &config.CacheWarmupConfiguration{
				Enabled: false,
			},
		}

		cache.updateStateFromConfig(cfg)

		require.Nil(t, cache.expensiveCaches)
	})

	t.Run("nil cacheWarmup config disables cache", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			expensiveCaches: make(map[string]*expensivePlanCache),
			cachedOps:       make(map[string][]*nodev1.Operation),
		}

		cfg := &Config{
			cacheWarmup: nil,
		}

		cache.updateStateFromConfig(cfg)

		require.Nil(t, cache.expensiveCaches)
		require.Nil(t, cache.cachedOps)
	})

	t.Run("cacheWarmup enabled but InMemoryFallback disabled", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{}

		cfg := &Config{
			cacheWarmup: &config.CacheWarmupConfiguration{
				Enabled:          true,
				InMemoryFallback: false,
			},
		}

		cache.updateStateFromConfig(cfg)

		require.Nil(t, cache.expensiveCaches)
	})
}

func TestInMemoryPlanCacheFallback_GetPlanCacheForFF(t *testing.T) {
	t.Parallel()

	t.Run("returns operations for existing feature flag from cachedOps", func(t *testing.T) {
		t.Parallel()
		expectedOps := []*nodev1.Operation{
			{Request: &nodev1.OperationRequest{Query: "query { test1 }"}},
			{Request: &nodev1.OperationRequest{Query: "query { test2 }"}},
		}

		cache := &InMemoryPlanCacheFallback{
			cachedOps: map[string][]*nodev1.Operation{
				"test-ff": expectedOps,
			},
		}

		result := cache.getCachedOperationsForFF("test-ff")

		require.NotNil(t, result)
		require.Equal(t, expectedOps, result)
	})

	t.Run("returns nil for non-existent feature flag", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			logger:    zap.NewNop(),
			cachedOps: make(map[string][]*nodev1.Operation),
		}

		result := cache.getCachedOperationsForFF("non-existent")
		require.Nil(t, result)
	})

	t.Run("returns nil when cache is disabled", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			cachedOps: nil,
		}

		result := cache.getCachedOperationsForFF("test-ff")

		require.Nil(t, result)
	})
}

func TestInMemoryPlanCacheFallback_CleanupUnusedFeatureFlags(t *testing.T) {
	t.Parallel()
	t.Run("removes unused feature flags", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			expensiveCaches: map[string]*expensivePlanCache{
				"ff1": nil,
				"ff2": nil,
				"ff3": nil,
			},
			cachedOps: map[string][]*nodev1.Operation{
				"ff1": nil,
				"ff2": nil,
				"ff3": nil,
			},
		}

		routerCfg := &nodev1.RouterConfig{
			FeatureFlagConfigs: &nodev1.FeatureFlagRouterExecutionConfigs{
				ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{
					"ff1": {},
					"ff2": {},
				},
			},
		}

		cache.cleanupUnusedFeatureFlags(routerCfg)

		require.Len(t, cache.expensiveCaches, 2)
		require.Contains(t, cache.expensiveCaches, "ff1")
		require.Contains(t, cache.expensiveCaches, "ff2")
		require.NotContains(t, cache.expensiveCaches, "ff3")
		require.Len(t, cache.cachedOps, 2)
		require.NotContains(t, cache.cachedOps, "ff3")
	})

	t.Run("keeps empty string feature flag", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			expensiveCaches: map[string]*expensivePlanCache{
				"":    nil,
				"ff1": nil,
			},
			cachedOps: map[string][]*nodev1.Operation{
				"":    nil,
				"ff1": nil,
			},
		}

		routerCfg := &nodev1.RouterConfig{
			FeatureFlagConfigs: &nodev1.FeatureFlagRouterExecutionConfigs{
				ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{},
			},
		}

		cache.cleanupUnusedFeatureFlags(routerCfg)

		require.Len(t, cache.expensiveCaches, 1)
		require.Contains(t, cache.expensiveCaches, "")
		require.NotContains(t, cache.expensiveCaches, "ff1")
	})

	t.Run("does nothing when cache is disabled", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			expensiveCaches: nil,
		}

		routerCfg := &nodev1.RouterConfig{
			FeatureFlagConfigs: &nodev1.FeatureFlagRouterExecutionConfigs{
				ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{},
			},
		}

		cache.cleanupUnusedFeatureFlags(routerCfg)

		// Should still be nil because cleanup is skipped when disabled
		require.Nil(t, cache.expensiveCaches)
	})

	t.Run("removes feature flags when not in ConfigByFeatureFlagName", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			expensiveCaches: map[string]*expensivePlanCache{
				"":    nil, // base should be kept
				"ff1": nil,
				"ff2": nil,
				"ff3": nil,
				"ff4": nil,
				"ff5": nil,
			},
			cachedOps: map[string][]*nodev1.Operation{
				"":    nil,
				"ff1": nil,
				"ff2": nil,
				"ff3": nil,
			},
		}

		routerCfg := &nodev1.RouterConfig{
			FeatureFlagConfigs: nil,
		}

		cache.cleanupUnusedFeatureFlags(routerCfg)

		require.Len(t, cache.expensiveCaches, 1)
		require.Contains(t, cache.expensiveCaches, "")
		require.NotContains(t, cache.expensiveCaches, "ff1")
		require.NotContains(t, cache.expensiveCaches, "ff2")
		require.NotContains(t, cache.expensiveCaches, "ff3")
	})
}

func TestInMemoryPlanCacheFallback_ProcessOnConfigChangeRestart(t *testing.T) {
	t.Parallel()
	t.Run("extracts expensive cache entries to cachedOps", func(t *testing.T) {
		t.Parallel()

		query1 := "query { test1 }"
		query2 := "query { test2 }"

		expCache1, err := newExpensivePlanCache(100)
		require.NoError(t, err)
		expCache2, err := newExpensivePlanCache(100)
		require.NoError(t, err)

		expCache1.Set(1, &planWithMetaData{content: query1}, 5*1e9)
		expCache1.Wait()
		expCache2.Set(2, &planWithMetaData{content: query2}, 5*1e9)
		expCache2.Wait()

		cache := &InMemoryPlanCacheFallback{
			expensiveCaches: map[string]*expensivePlanCache{
				"ff1": expCache1,
				"ff2": expCache2,
			},
			cachedOps: make(map[string][]*nodev1.Operation),
		}

		cache.extractQueriesAndOverridePlanCache()

		// Verify both caches have been extracted to cachedOps
		require.Len(t, cache.cachedOps["ff1"], 1)
		require.Len(t, cache.cachedOps["ff2"], 1)
		require.Equal(t, query1, cache.cachedOps["ff1"][0].Request.Query)
		require.Equal(t, query2, cache.cachedOps["ff2"][0].Request.Query)

		// expensiveCaches should be reset to empty map
		require.NotNil(t, cache.expensiveCaches)
		require.Empty(t, cache.expensiveCaches)
	})

	t.Run("does nothing when cache is disabled", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			expensiveCaches: nil,
		}

		cache.extractQueriesAndOverridePlanCache()

		// Should remain nil since processing is skipped
		require.Nil(t, cache.expensiveCaches)
	})

	t.Run("handles empty cache", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			expensiveCaches: make(map[string]*expensivePlanCache),
			cachedOps:       make(map[string][]*nodev1.Operation),
		}

		require.NotPanics(t, func() {
			cache.extractQueriesAndOverridePlanCache()
		})

		require.Empty(t, cache.cachedOps)
	})
}

func TestInMemoryPlanCacheFallback_IsEnabled(t *testing.T) {
	t.Parallel()
	t.Run("returns true when cache is enabled", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			expensiveCaches: make(map[string]*expensivePlanCache),
		}

		require.True(t, cache.IsEnabled())
	})

	t.Run("returns false when cache is disabled", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			expensiveCaches: nil,
		}

		require.False(t, cache.IsEnabled())
	})
}
