package core

import (
	"testing"

	"github.com/dgraph-io/ristretto/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestInMemorySwitchOverCache_UpdateInMemorySwitchOverCacheForConfigChanges(t *testing.T) {
	t.Run("enable cache from disabled state", func(t *testing.T) {
		cache := &InMemorySwitchOverCache{}
		cfg := &Config{
			cacheWarmup: &config.CacheWarmupConfiguration{
				Enabled: true,
				Source: config.CacheWarmupSource{
					InMemorySwitchover: config.CacheWarmupInMemorySwitchover{
						Enabled: true,
					},
				},
			},
		}

		cache.UpdateInMemorySwitchOverCacheForConfigChanges(cfg)

		assert.True(t, cache.enabled)
		assert.NotNil(t, cache.queriesForFeatureFlag)
		assert.Empty(t, cache.queriesForFeatureFlag)
	})

	t.Run("disable cache from enabled state", func(t *testing.T) {
		cache := &InMemorySwitchOverCache{
			enabled:               true,
			queriesForFeatureFlag: make(map[string]planCache),
		}
		cache.queriesForFeatureFlag["test"] = nil

		cfg := &Config{
			cacheWarmup: &config.CacheWarmupConfiguration{
				Enabled: false,
			},
		}

		cache.UpdateInMemorySwitchOverCacheForConfigChanges(cfg)

		assert.False(t, cache.enabled)
		assert.Nil(t, cache.queriesForFeatureFlag)
	})

	t.Run("update when already enabled keeps existing data", func(t *testing.T) {
		existingMap := make(map[string]planCache)
		existingMap["test"] = nil

		cache := &InMemorySwitchOverCache{
			enabled:               true,
			queriesForFeatureFlag: existingMap,
		}

		cfg := &Config{
			cacheWarmup: &config.CacheWarmupConfiguration{
				Enabled: true,
				Source: config.CacheWarmupSource{
					InMemorySwitchover: config.CacheWarmupInMemorySwitchover{
						Enabled: true,
					},
				},
			},
		}

		cache.UpdateInMemorySwitchOverCacheForConfigChanges(cfg)

		assert.True(t, cache.enabled)
		assert.NotNil(t, cache.queriesForFeatureFlag)
		assert.Len(t, cache.queriesForFeatureFlag, 1)
		assert.Contains(t, cache.queriesForFeatureFlag, "test")
	})

	t.Run("update when already disabled", func(t *testing.T) {
		cache := &InMemorySwitchOverCache{
			enabled:               false,
			queriesForFeatureFlag: nil,
		}

		cfg := &Config{
			cacheWarmup: &config.CacheWarmupConfiguration{
				Enabled: false,
			},
		}

		cache.UpdateInMemorySwitchOverCacheForConfigChanges(cfg)

		assert.False(t, cache.enabled)
		assert.Nil(t, cache.queriesForFeatureFlag)
	})

	t.Run("nil cacheWarmup config disables cache", func(t *testing.T) {
		cache := &InMemorySwitchOverCache{
			enabled:               true,
			queriesForFeatureFlag: make(map[string]planCache),
		}

		cfg := &Config{
			cacheWarmup: nil,
		}

		cache.UpdateInMemorySwitchOverCacheForConfigChanges(cfg)

		assert.False(t, cache.enabled)
		assert.Nil(t, cache.queriesForFeatureFlag)
	})

	t.Run("cacheWarmup enabled but InMemorySwitchover disabled", func(t *testing.T) {
		cache := &InMemorySwitchOverCache{}

		cfg := &Config{
			cacheWarmup: &config.CacheWarmupConfiguration{
				Enabled: true,
				Source: config.CacheWarmupSource{
					InMemorySwitchover: config.CacheWarmupInMemorySwitchover{
						Enabled: false,
					},
				},
			},
		}

		cache.UpdateInMemorySwitchOverCacheForConfigChanges(cfg)

		assert.False(t, cache.enabled)
		assert.Nil(t, cache.queriesForFeatureFlag)
	})
}

func TestInMemorySwitchOverCache_GetPlanCacheForFF(t *testing.T) {
	t.Run("returns cache for existing feature flag when enabled", func(t *testing.T) {
		mockCache, err := ristretto.NewCache(&ristretto.Config[uint64, *planWithMetaData]{
			MaxCost:     100,
			NumCounters: 10000,
			BufferItems: 64,
		})
		require.NoError(t, err)

		cache := &InMemorySwitchOverCache{
			enabled:               true,
			queriesForFeatureFlag: make(map[string]planCache),
		}
		cache.queriesForFeatureFlag["test-ff"] = mockCache

		result := cache.getPlanCacheForFF("test-ff")

		assert.NotNil(t, result)
		// Verify it's the same cache by comparing pointer addresses
		assert.Equal(t, mockCache, (*ristretto.Cache[uint64, *planWithMetaData])(result))
	})

	t.Run("returns nil for non-existent feature flag", func(t *testing.T) {
		cache := &InMemorySwitchOverCache{
			enabled:               true,
			queriesForFeatureFlag: make(map[string]planCache),
		}

		result := cache.getPlanCacheForFF("non-existent")

		assert.Nil(t, result)
	})

	t.Run("returns nil when cache is disabled", func(t *testing.T) {
		mockCache, err := ristretto.NewCache(&ristretto.Config[uint64, *planWithMetaData]{
			MaxCost:     100,
			NumCounters: 10000,
			BufferItems: 64,
		})
		require.NoError(t, err)

		cache := &InMemorySwitchOverCache{
			enabled:               false,
			queriesForFeatureFlag: make(map[string]planCache),
		}
		cache.queriesForFeatureFlag["test-ff"] = mockCache

		result := cache.getPlanCacheForFF("test-ff")

		assert.Nil(t, result)
	})
}

func TestInMemorySwitchOverCache_SetPlanCacheForFF(t *testing.T) {
	t.Run("sets cache for feature flag when enabled", func(t *testing.T) {
		mockCache, err := ristretto.NewCache(&ristretto.Config[uint64, *planWithMetaData]{
			MaxCost:     100,
			NumCounters: 10000,
			BufferItems: 64,
		})
		require.NoError(t, err)

		cache := &InMemorySwitchOverCache{
			enabled:               true,
			queriesForFeatureFlag: make(map[string]planCache),
		}

		cache.setPlanCacheForFF("test-ff", mockCache)

		assert.Contains(t, cache.queriesForFeatureFlag, "test-ff")
		// Verify it's the same cache by comparing the underlying pointer
		assert.Equal(t, mockCache, (*ristretto.Cache[uint64, *planWithMetaData])(cache.queriesForFeatureFlag["test-ff"]))
	})

	t.Run("does not set cache when disabled", func(t *testing.T) {
		mockCache, err := ristretto.NewCache(&ristretto.Config[uint64, *planWithMetaData]{
			MaxCost:     100,
			NumCounters: 10000,
			BufferItems: 64,
		})
		require.NoError(t, err)

		cache := &InMemorySwitchOverCache{
			enabled:               false,
			queriesForFeatureFlag: make(map[string]planCache),
		}

		cache.setPlanCacheForFF("test-ff", mockCache)

		assert.NotContains(t, cache.queriesForFeatureFlag, "test-ff")
	})

	t.Run("does not set nil cache", func(t *testing.T) {
		cache := &InMemorySwitchOverCache{
			enabled:               true,
			queriesForFeatureFlag: make(map[string]planCache),
		}

		cache.setPlanCacheForFF("test-ff", nil)

		assert.NotContains(t, cache.queriesForFeatureFlag, "test-ff")
	})
}

func TestInMemorySwitchOverCache_CleanupUnusedFeatureFlags(t *testing.T) {
	t.Run("removes unused feature flags", func(t *testing.T) {
		cache := &InMemorySwitchOverCache{
			enabled:               true,
			queriesForFeatureFlag: make(map[string]planCache),
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

		assert.Len(t, cache.queriesForFeatureFlag, 2)
		assert.Contains(t, cache.queriesForFeatureFlag, "ff1")
		assert.Contains(t, cache.queriesForFeatureFlag, "ff2")
		assert.NotContains(t, cache.queriesForFeatureFlag, "ff3")
	})

	t.Run("keeps empty string feature flag", func(t *testing.T) {
		cache := &InMemorySwitchOverCache{
			enabled:               true,
			queriesForFeatureFlag: make(map[string]planCache),
		}
		cache.queriesForFeatureFlag[""] = nil
		cache.queriesForFeatureFlag["ff1"] = nil

		routerCfg := &nodev1.RouterConfig{
			FeatureFlagConfigs: &nodev1.FeatureFlagRouterExecutionConfigs{
				ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{},
			},
		}

		cache.cleanupUnusedFeatureFlags(routerCfg)

		assert.Len(t, cache.queriesForFeatureFlag, 1)
		assert.Contains(t, cache.queriesForFeatureFlag, "")
		assert.NotContains(t, cache.queriesForFeatureFlag, "ff1")
	})

	t.Run("does nothing when cache is disabled", func(t *testing.T) {
		cache := &InMemorySwitchOverCache{
			enabled:               false,
			queriesForFeatureFlag: make(map[string]planCache),
		}
		cache.queriesForFeatureFlag["ff1"] = nil

		routerCfg := &nodev1.RouterConfig{
			FeatureFlagConfigs: &nodev1.FeatureFlagRouterExecutionConfigs{
				ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{},
			},
		}

		cache.cleanupUnusedFeatureFlags(routerCfg)

		// Should still have ff1 because cleanup is skipped when disabled
		assert.Len(t, cache.queriesForFeatureFlag, 1)
		assert.Contains(t, cache.queriesForFeatureFlag, "ff1")
	})

	t.Run("does nothing when FeatureFlagConfigs is nil", func(t *testing.T) {
		cache := &InMemorySwitchOverCache{
			enabled:               true,
			queriesForFeatureFlag: make(map[string]planCache),
		}
		cache.queriesForFeatureFlag["ff1"] = nil

		routerCfg := &nodev1.RouterConfig{
			FeatureFlagConfigs: nil,
		}

		cache.cleanupUnusedFeatureFlags(routerCfg)

		// Should still have ff1 because FeatureFlagConfigs is nil
		assert.Len(t, cache.queriesForFeatureFlag, 1)
		assert.Contains(t, cache.queriesForFeatureFlag, "ff1")
	})
}

func TestSwitchoverConfig_NewSwitchoverConfig(t *testing.T) {
	t.Run("creates new switchover config with initialized cache", func(t *testing.T) {
		cfg := NewSwitchoverConfig()

		assert.NotNil(t, cfg)
		assert.NotNil(t, cfg.inMemorySwitchOverCache)
		assert.False(t, cfg.inMemorySwitchOverCache.enabled)
		assert.Nil(t, cfg.inMemorySwitchOverCache.queriesForFeatureFlag)
	})
}

func TestSwitchoverConfig_UpdateSwitchoverConfig(t *testing.T) {
	t.Run("delegates to InMemorySwitchOverCache", func(t *testing.T) {
		cfg := NewSwitchoverConfig()
		routerConfig := &Config{
			cacheWarmup: &config.CacheWarmupConfiguration{
				Enabled: true,
				Source: config.CacheWarmupSource{
					InMemorySwitchover: config.CacheWarmupInMemorySwitchover{
						Enabled: true,
					},
				},
			},
		}

		cfg.UpdateSwitchoverConfig(routerConfig)

		assert.True(t, cfg.inMemorySwitchOverCache.enabled)
		assert.NotNil(t, cfg.inMemorySwitchOverCache.queriesForFeatureFlag)
	})
}

func TestSwitchoverConfig_CleanupFeatureFlags(t *testing.T) {
	t.Run("delegates to InMemorySwitchOverCache", func(t *testing.T) {
		cfg := NewSwitchoverConfig()
		cfg.inMemorySwitchOverCache.enabled = true
		cfg.inMemorySwitchOverCache.queriesForFeatureFlag = make(map[string]planCache)
		cfg.inMemorySwitchOverCache.queriesForFeatureFlag["ff1"] = nil
		cfg.inMemorySwitchOverCache.queriesForFeatureFlag["ff2"] = nil

		routerCfg := &nodev1.RouterConfig{
			FeatureFlagConfigs: &nodev1.FeatureFlagRouterExecutionConfigs{
				ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{
					"ff1": {},
				},
			},
		}

		cfg.CleanupFeatureFlags(routerCfg)

		assert.Len(t, cfg.inMemorySwitchOverCache.queriesForFeatureFlag, 1)
		assert.Contains(t, cfg.inMemorySwitchOverCache.queriesForFeatureFlag, "ff1")
		assert.NotContains(t, cfg.inMemorySwitchOverCache.queriesForFeatureFlag, "ff2")
	})
}
