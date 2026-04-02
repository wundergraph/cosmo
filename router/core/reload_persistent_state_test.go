package core

import (
	"testing"

	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/slowplancache"
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
		existing := make(map[string]any)
		existing["test"] = (*slowplancache.Cache[*planWithMetaData])(nil)

		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: existing,
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

	t.Run("returns operations for existing feature flag from extracted ops", func(t *testing.T) {
		t.Parallel()
		expectedOps := []*nodev1.Operation{
			{Request: &nodev1.OperationRequest{Query: "query { test1 }"}},
			{Request: &nodev1.OperationRequest{Query: "query { test2 }"}},
		}

		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: map[string]any{
				"test-ff": expectedOps,
			},
		}

		result := cache.getPlanCacheForFF("test-ff")

		require.NotNil(t, result)
		require.Equal(t, expectedOps, result)
	})

	t.Run("returns operations from live fallback cache reference", func(t *testing.T) {
		t.Parallel()

		fallbackCache, err := slowplancache.New[*planWithMetaData](100, 0)
		require.NoError(t, err)
		fallbackCache.Set(1, &planWithMetaData{content: "query { fromFallback }"}, 5*1e9)
		fallbackCache.Wait()

		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: map[string]any{
				"test-ff": fallbackCache,
			},
		}

		result := cache.getPlanCacheForFF("test-ff")

		require.NotNil(t, result)
		require.Len(t, result, 1)
		require.Equal(t, "query { fromFallback }", result[0].Request.Query)
	})

	t.Run("returns nil for non-existent feature flag", func(t *testing.T) {
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

func TestInMemoryPlanCacheFallback_CleanupUnusedFeatureFlags(t *testing.T) {
	t.Parallel()
	t.Run("removes unused feature flags", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: map[string]any{
				"ff1": (*slowplancache.Cache[*planWithMetaData])(nil),
				"ff2": (*slowplancache.Cache[*planWithMetaData])(nil),
				"ff3": (*slowplancache.Cache[*planWithMetaData])(nil),
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

		require.Len(t, cache.queriesForFeatureFlag, 2)
		require.Contains(t, cache.queriesForFeatureFlag, "ff1")
		require.Contains(t, cache.queriesForFeatureFlag, "ff2")
		require.NotContains(t, cache.queriesForFeatureFlag, "ff3")
	})

	t.Run("keeps empty string feature flag", func(t *testing.T) {
		t.Parallel()
		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: map[string]any{
				"":    (*slowplancache.Cache[*planWithMetaData])(nil),
				"ff1": (*slowplancache.Cache[*planWithMetaData])(nil),
			},
		}

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
			queriesForFeatureFlag: map[string]any{
				"":    (*slowplancache.Cache[*planWithMetaData])(nil), // base should be kept
				"ff1": (*slowplancache.Cache[*planWithMetaData])(nil),
				"ff2": (*slowplancache.Cache[*planWithMetaData])(nil),
				"ff3": (*slowplancache.Cache[*planWithMetaData])(nil),
				"ff4": (*slowplancache.Cache[*planWithMetaData])(nil),
				"ff5": (*slowplancache.Cache[*planWithMetaData])(nil),
			},
		}

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
	t.Run("extracts fallback cache entries to operations", func(t *testing.T) {
		t.Parallel()

		query1 := "query { test1 }"
		query2 := "query { test2 }"

		fallbackCache1, err := slowplancache.New[*planWithMetaData](100, 0)
		require.NoError(t, err)
		fallbackCache2, err := slowplancache.New[*planWithMetaData](100, 0)
		require.NoError(t, err)

		fallbackCache1.Set(1, &planWithMetaData{content: query1}, 5*1e9)
		fallbackCache1.Wait()
		fallbackCache2.Set(2, &planWithMetaData{content: query2}, 5*1e9)
		fallbackCache2.Wait()

		cache := &InMemoryPlanCacheFallback{
			queriesForFeatureFlag: map[string]any{
				"ff1": fallbackCache1,
				"ff2": fallbackCache2,
			},
		}

		cache.extractQueriesAndOverridePlanCache()

		// Verify both caches have been extracted to operations
		ff1Ops, ok := cache.queriesForFeatureFlag["ff1"].([]*nodev1.Operation)
		require.True(t, ok)
		require.Len(t, ff1Ops, 1)
		require.Equal(t, query1, ff1Ops[0].Request.Query)

		ff2Ops, ok := cache.queriesForFeatureFlag["ff2"].([]*nodev1.Operation)
		require.True(t, ok)
		require.Len(t, ff2Ops, 1)
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
