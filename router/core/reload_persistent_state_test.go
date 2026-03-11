package core

import (
	"testing"

	"github.com/dgraph-io/ristretto/v2"
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

		require.NotNil(t, cache.queriesForFeatureFlag)
		require.Empty(t, cache.queriesForFeatureFlag)
	})

	t.Run("disable cache from enabled state", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: make(map[string]any),
		}
		cache.queriesForFeatureFlag["test"] = nil

		cfg := &Config{
			cacheWarmup: &config.CacheWarmupConfiguration{
				Enabled: false,
			},
		}

		cache.updateStateFromConfig(cfg)

		require.Nil(t, cache.queriesForFeatureFlag)
	})

	t.Run("update when already enabled keeps existing data", func(t *testing.T) {
		t.Parallel()
		existingMap := make(map[string]any)
		existingMap["test"] = nil

		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: existingMap,
		}

		cfg := &Config{
			cacheWarmup: &config.CacheWarmupConfiguration{
				Enabled:          true,
				InMemoryFallback: true,
			},
		}

		cache.updateStateFromConfig(cfg)

		require.NotNil(t, cache.queriesForFeatureFlag)
		require.Len(t, cache.queriesForFeatureFlag, 1)
		require.Contains(t, cache.queriesForFeatureFlag, "test")
	})

	t.Run("update when already disabled", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: nil,
		}

		cfg := &Config{
			cacheWarmup: &config.CacheWarmupConfiguration{
				Enabled: false,
			},
		}

		cache.updateStateFromConfig(cfg)

		require.Nil(t, cache.queriesForFeatureFlag)
	})

	t.Run("nil cacheWarmup config disables cache", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: make(map[string]any),
		}

		cfg := &Config{
			cacheWarmup: nil,
		}

		cache.updateStateFromConfig(cfg)

		require.Nil(t, cache.queriesForFeatureFlag)
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

		require.Nil(t, cache.queriesForFeatureFlag)
	})
}

func TestInMemoryPlanCacheFallback_GetPlanCacheForFF(t *testing.T) {
	t.Parallel()
	t.Run("returns operations for existing feature flag when enabled with ristretto cache", func(t *testing.T) {
		t.Parallel()
		mockCache, err := ristretto.NewCache(&ristretto.Config[uint64, *planWithMetaData]{
			MaxCost:            10000,
			NumCounters:        10000000,
			IgnoreInternalCost: true,
			BufferItems:        64,
		})
		require.NoError(t, err)

		query1 := "query { test1 }"
		query2 := "query { test2 }"

		mockCache.Set(1, &planWithMetaData{content: query1}, 1)
		mockCache.Set(2, &planWithMetaData{content: query2}, 1)
		mockCache.Wait()

		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: make(map[string]any),
		}
		cache.queriesForFeatureFlag["test-ff"] = mockCache

		result := cache.getPlanCacheForFF("test-ff")

		require.NotNil(t, result)
		require.IsType(t, []*nodev1.Operation{}, result)
		require.Len(t, result, 2)

		// Verify the operations contain the expected queries (order may vary)
		queries := make([]string, len(result))
		for i, op := range result {
			queries[i] = op.Request.Query
		}
		require.ElementsMatch(t, []string{query1, query2}, queries)
	})

	t.Run("returns operations for existing feature flag when enabled with operation slice", func(t *testing.T) {
		t.Parallel()
		expectedOps := []*nodev1.Operation{
			{Request: &nodev1.OperationRequest{Query: "query { test1 }"}},
			{Request: &nodev1.OperationRequest{Query: "query { test2 }"}},
		}

		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: make(map[string]any),
		}
		cache.queriesForFeatureFlag["test-ff"] = expectedOps

		result := cache.getPlanCacheForFF("test-ff")

		require.NotNil(t, result)
		require.Equal(t, expectedOps, result)
	})

	t.Run("returns empty slice for non-existent feature flag", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			logger:                zap.NewNop(),
			queriesForFeatureFlag: make(map[string]any),
		}

		result := cache.getPlanCacheForFF("non-existent")
		require.Nil(t, result)
	})

	t.Run("returns nil when cache is disabled", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: nil,
		}

		result := cache.getPlanCacheForFF("test-ff")

		require.Nil(t, result)
	})
}

func TestInMemoryPlanCacheFallback_SetPlanCacheForFF(t *testing.T) {
	t.Parallel()
	t.Run("sets cache for feature flag when enabled", func(t *testing.T) {
		t.Parallel()
		mockCache, err := ristretto.NewCache(&ristretto.Config[uint64, *planWithMetaData]{
			MaxCost:     100,
			NumCounters: 10000,
			BufferItems: 64,
		})
		require.NoError(t, err)

		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: make(map[string]any),
		}

		cache.setPlanCacheForFF("test-ff", mockCache)

		require.Contains(t, cache.queriesForFeatureFlag, "test-ff")
		// Verify it's the same cache by comparing the underlying pointer
		require.Equal(t, cache.queriesForFeatureFlag["test-ff"], mockCache)
	})

	t.Run("does not set cache when disabled", func(t *testing.T) {
		t.Parallel()
		mockCache, err := ristretto.NewCache(&ristretto.Config[uint64, *planWithMetaData]{
			MaxCost:     100,
			NumCounters: 10000,
			BufferItems: 64,
		})
		require.NoError(t, err)

		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: nil,
		}

		cache.setPlanCacheForFF("test-ff", mockCache)

		require.Nil(t, cache.queriesForFeatureFlag)
	})

	t.Run("does not set nil cache", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: make(map[string]any),
		}

		cache.setPlanCacheForFF("test-ff", nil)

		require.NotContains(t, cache.queriesForFeatureFlag, "test-ff")
	})
}

func TestInMemoryPlanCacheFallback_CleanupUnusedFeatureFlags(t *testing.T) {
	t.Parallel()
	t.Run("removes unused feature flags", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: make(map[string]any),
		}
		cache.queriesForFeatureFlag["ff1"] = nil
		cache.queriesForFeatureFlag["ff2"] = nil
		cache.queriesForFeatureFlag["ff3"] = nil

		routerCfg := &nodev1.RouterConfig{
			FeatureFlagConfigs: &nodev1.FeatureFlagRouterExecutionConfigs{
				ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{
					"ff1": {},
					"ff2": {},
				},
			},
		}

		cache.cleanupUnusedFeatureFlags(routerCfg)

		require.Len(t, cache.queriesForFeatureFlag, 2)
		require.Contains(t, cache.queriesForFeatureFlag, "ff1")
		require.Contains(t, cache.queriesForFeatureFlag, "ff2")
		require.NotContains(t, cache.queriesForFeatureFlag, "ff3")
	})

	t.Run("keeps empty string feature flag", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: make(map[string]any),
		}
		cache.queriesForFeatureFlag[""] = nil
		cache.queriesForFeatureFlag["ff1"] = nil

		routerCfg := &nodev1.RouterConfig{
			FeatureFlagConfigs: &nodev1.FeatureFlagRouterExecutionConfigs{
				ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{},
			},
		}

		cache.cleanupUnusedFeatureFlags(routerCfg)

		require.Len(t, cache.queriesForFeatureFlag, 1)
		require.Contains(t, cache.queriesForFeatureFlag, "")
		require.NotContains(t, cache.queriesForFeatureFlag, "ff1")
	})

	t.Run("does nothing when cache is disabled", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: nil,
		}

		routerCfg := &nodev1.RouterConfig{
			FeatureFlagConfigs: &nodev1.FeatureFlagRouterExecutionConfigs{
				ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{},
			},
		}

		cache.cleanupUnusedFeatureFlags(routerCfg)

		// Should still be nil because cleanup is skipped when disabled
		require.Nil(t, cache.queriesForFeatureFlag)
	})

	t.Run("removes feature flags when not in ConfigByFeatureFlagName", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: make(map[string]any),
		}
		cache.queriesForFeatureFlag[""] = nil // base should be kept
		cache.queriesForFeatureFlag["ff1"] = nil
		cache.queriesForFeatureFlag["ff2"] = nil
		cache.queriesForFeatureFlag["ff3"] = nil
		cache.queriesForFeatureFlag["ff4"] = nil
		cache.queriesForFeatureFlag["ff5"] = nil

		routerCfg := &nodev1.RouterConfig{
			FeatureFlagConfigs: nil,
		}

		cache.cleanupUnusedFeatureFlags(routerCfg)

		require.Len(t, cache.queriesForFeatureFlag, 1)
		require.Contains(t, cache.queriesForFeatureFlag, "")
		require.NotContains(t, cache.queriesForFeatureFlag, "ff1")
		require.NotContains(t, cache.queriesForFeatureFlag, "ff2")
		require.NotContains(t, cache.queriesForFeatureFlag, "ff3")
	})
}

func TestInMemoryPlanCacheFallback_ProcessOnConfigChangeRestart(t *testing.T) {
	t.Parallel()
	t.Run("converts ristretto caches to operation slices", func(t *testing.T) {
		t.Parallel()
		mockCache1, err := ristretto.NewCache(&ristretto.Config[uint64, *planWithMetaData]{
			MaxCost:            10000,
			NumCounters:        10000000,
			IgnoreInternalCost: true,
			BufferItems:        64,
		})
		require.NoError(t, err)

		mockCache2, err := ristretto.NewCache(&ristretto.Config[uint64, *planWithMetaData]{
			MaxCost:            10000,
			NumCounters:        10000000,
			IgnoreInternalCost: true,
			BufferItems:        64,
		})
		require.NoError(t, err)

		query1 := "query { test1 }"
		query2 := "query { test2 }"

		mockCache1.Set(1, &planWithMetaData{content: query1}, 1)
		mockCache1.Wait()
		mockCache2.Set(2, &planWithMetaData{content: query2}, 1)
		mockCache2.Wait()

		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: make(map[string]any),
		}
		cache.queriesForFeatureFlag["ff1"] = mockCache1
		cache.queriesForFeatureFlag["ff2"] = mockCache2

		cache.extractQueriesAndOverridePlanCache()

		// Verify both caches have been converted to operation slices
		require.IsType(t, []*nodev1.Operation{}, cache.queriesForFeatureFlag["ff1"])
		require.IsType(t, []*nodev1.Operation{}, cache.queriesForFeatureFlag["ff2"])

		ff1Ops := cache.queriesForFeatureFlag["ff1"].([]*nodev1.Operation)
		ff2Ops := cache.queriesForFeatureFlag["ff2"].([]*nodev1.Operation)

		require.Len(t, ff1Ops, 1)
		require.Len(t, ff2Ops, 1)
		require.Equal(t, query1, ff1Ops[0].Request.Query)
		require.Equal(t, query2, ff2Ops[0].Request.Query)
	})

	t.Run("does nothing when cache is disabled", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: nil,
		}

		cache.extractQueriesAndOverridePlanCache()

		// Should remain nil since processing is skipped
		require.Nil(t, cache.queriesForFeatureFlag)
	})

	t.Run("handles empty cache", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: make(map[string]any),
		}

		require.NotPanics(t, func() {
			cache.extractQueriesAndOverridePlanCache()
		})

		require.Empty(t, cache.queriesForFeatureFlag)
	})
}

func TestInMemoryPlanCacheFallback_IsEnabled(t *testing.T) {
	t.Parallel()
	t.Run("returns true when cache is enabled", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: make(map[string]any),
		}

		require.True(t, cache.IsEnabled())
	})

	t.Run("returns false when cache is disabled", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: nil,
		}

		require.False(t, cache.IsEnabled())
	})

}
