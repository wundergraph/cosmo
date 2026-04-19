package core

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	ristretto "github.com/dgraph-io/ristretto/v2"

	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/entitycache"
)

// TestBuildEntityCacheInstances_ReusesDefaultCacheForSameProviderID verifies
// that when an override points at the same provider_id as l2.storage.provider_id,
// no second cache instance is allocated. The default entry and the provider_id
// entry must resolve to the same *MemoryEntityCache pointer.
func TestBuildEntityCacheInstances_ReusesDefaultCacheForSameProviderID(t *testing.T) {
	t.Parallel()

	r := &Router{
		Config: Config{
			logger: zap.NewNop(),
			entityCachingConfig: config.EntityCachingConfiguration{
				Enabled: true,
				L2: config.EntityCachingL2Configuration{
					Enabled: true,
					Storage: config.EntityCachingL2StorageConfig{
						ProviderID: "memory-1",
					},
				},
				SubgraphCacheOverrides: []config.EntityCachingSubgraphCacheOverride{
					{
						Name:              "products",
						StorageProviderID: "memory-1", // same as the default
					},
				},
			},
			storageProviders: config.StorageProviders{
				Memory: []config.MemoryStorageProvider{
					{ID: "memory-1", MaxSize: config.BytesString(1024 * 1024)},
				},
			},
		},
	}

	caches, err := r.buildEntityCacheInstances()
	require.NoError(t, err)
	require.Len(t, caches, 2, "expected exactly two keys: default and memory-1")

	defaultCache, ok := caches["default"]
	require.True(t, ok, `missing "default" entry`)
	namedCache, ok := caches["memory-1"]
	require.True(t, ok, `missing "memory-1" entry`)
	require.Same(t, defaultCache, namedCache,
		"default cache and same-provider-id override must share the same instance")
}

// TestBuildEntityCacheInstances_DistinctProviderIDs verifies that overrides
// pointing at a different provider still allocate their own cache instance.
func TestBuildEntityCacheInstances_DistinctProviderIDs(t *testing.T) {
	t.Parallel()

	r := &Router{
		Config: Config{
			logger: zap.NewNop(),
			entityCachingConfig: config.EntityCachingConfiguration{
				Enabled: true,
				L2: config.EntityCachingL2Configuration{
					Enabled: true,
					Storage: config.EntityCachingL2StorageConfig{
						ProviderID: "memory-1",
					},
				},
				SubgraphCacheOverrides: []config.EntityCachingSubgraphCacheOverride{
					{
						Name:              "products",
						StorageProviderID: "memory-2",
					},
				},
			},
			storageProviders: config.StorageProviders{
				Memory: []config.MemoryStorageProvider{
					{ID: "memory-1", MaxSize: config.BytesString(1024 * 1024)},
					{ID: "memory-2", MaxSize: config.BytesString(2 * 1024 * 1024)},
				},
			},
		},
	}

	caches, err := r.buildEntityCacheInstances()
	require.NoError(t, err)
	require.Len(t, caches, 3, "expected three keys: default, memory-1 alias, memory-2 override")
	require.NotSame(t, caches["memory-1"], caches["memory-2"],
		"distinct provider ids must yield distinct cache instances")
	require.Same(t, caches["default"], caches["memory-1"],
		"default alias must point at the memory-1 instance")
}

func TestBuildEntityCacheInstances_DisabledReturnsNil(t *testing.T) {
	t.Parallel()

	r := &Router{
		Config: Config{
			logger: zap.NewNop(),
			entityCachingConfig: config.EntityCachingConfiguration{
				Enabled: false,
			},
		},
	}

	caches, err := r.buildEntityCacheInstances()
	require.NoError(t, err)
	require.Nil(t, caches)
}

func TestBuildSingleEntityCache_WrapsMemoryProviderWithCircuitBreaker(t *testing.T) {
	t.Parallel()

	r := &Router{
		Config: Config{
			logger: zap.NewNop(),
			storageProviders: config.StorageProviders{
				Memory: []config.MemoryStorageProvider{
					{ID: "memory-1", MaxSize: config.BytesString(2048)},
				},
			},
		},
	}

	cache, err := r.buildSingleEntityCache("memory-1", config.EntityCachingL2Configuration{
		CircuitBreaker: config.EntityCachingCircuitBreakerConfig{
			Enabled:          true,
			FailureThreshold: 3,
			CooldownPeriod:   time.Second,
		},
	})
	require.NoError(t, err)

	breaker, ok := cache.(*entitycache.CircuitBreakerCache)
	require.True(t, ok, "expected circuit breaker wrapper")

	metricsProvider, ok := any(breaker).(interface {
		Metrics() *ristretto.Metrics
		MaxSizeBytes() int64
	})
	require.True(t, ok, "wrapped cache should expose metrics accessors")
	require.NotNil(t, metricsProvider.Metrics())
	require.EqualValues(t, 2048, metricsProvider.MaxSizeBytes())
}

func TestFindMemoryProvider_ReturnsFalseForUnknownProvider(t *testing.T) {
	t.Parallel()

	r := &Router{
		Config: Config{
			logger: zap.NewNop(),
			storageProviders: config.StorageProviders{
				Memory: []config.MemoryStorageProvider{
					{ID: "memory-1", MaxSize: config.BytesString(1024)},
				},
			},
		},
	}

	provider, ok := r.findMemoryProvider("missing")
	require.False(t, ok)
	require.Nil(t, provider)
}
