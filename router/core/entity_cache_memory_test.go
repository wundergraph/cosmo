package core

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

func newTestMemoryEntityCache(t *testing.T, maxSize uint64, keyPrefix string, now func() time.Time) *memoryEntityCache {
	t.Helper()

	cache := newMemoryEntityCache(config.MemoryStorageProvider{
		ID:      "memory-cache",
		MaxSize: config.BytesString(maxSize),
	}, keyPrefix)
	cache.now = now
	t.Cleanup(func() {
		require.NoError(t, cache.Close())
	})

	return cache
}

func TestMemoryEntityCacheGetReturnsAlignedEntries(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	now := time.Date(2026, 6, 16, 10, 0, 0, 0, time.UTC)
	cache := newTestMemoryEntityCache(t, 100, "entity-prefix", func() time.Time { return now })
	require.NoError(t, cache.Set(ctx, []*resolve.CacheEntry{
		{Key: "hit-1", Value: []byte("value-1"), TTL: time.Minute},
		{Key: "hit-2", Value: []byte("value-2"), TTL: time.Minute},
	}))

	entries, err := cache.Get(ctx, []string{"hit-1", "miss", "hit-2"})

	require.NoError(t, err)
	require.Len(t, entries, 3)
	require.NotNil(t, entries[0])
	assert.Equal(t, "hit-1", entries[0].Key)
	assert.Equal(t, []byte("value-1"), entries[0].Value)
	assert.Equal(t, time.Minute, entries[0].RemainingTTL)
	assert.Nil(t, entries[1])
	require.NotNil(t, entries[2])
	assert.Equal(t, "hit-2", entries[2].Key)
	assert.Equal(t, []byte("value-2"), entries[2].Value)
	assert.Equal(t, time.Minute, entries[2].RemainingTTL)
}

func TestMemoryEntityCacheGetLazyExpiresEntries(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	now := time.Date(2026, 6, 16, 10, 0, 0, 0, time.UTC)
	cache := newTestMemoryEntityCache(t, 100, "entity-prefix", func() time.Time { return now })
	require.NoError(t, cache.Set(ctx, []*resolve.CacheEntry{
		{Key: "expiring", Value: []byte("value"), TTL: 10 * time.Second},
	}))

	now = now.Add(11 * time.Second)
	entries, err := cache.Get(ctx, []string{"expiring"})

	require.NoError(t, err)
	require.Len(t, entries, 1)
	assert.Nil(t, entries[0])
	_, ok := cache.entries["entity-prefix:expiring"]
	assert.False(t, ok)
	assert.Equal(t, uint64(0), cache.currentSize)
}

func TestMemoryEntityCacheSetTTLSemantics(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	now := time.Date(2026, 6, 16, 10, 0, 0, 0, time.UTC)
	cache := newTestMemoryEntityCache(t, 100, "entity-prefix", func() time.Time { return now })

	require.NoError(t, cache.Set(ctx, []*resolve.CacheEntry{
		{Key: "positive", Value: []byte("positive-value"), TTL: 5 * time.Second},
		{Key: "default", Value: []byte("default-value"), TTL: 0},
		{Key: "indefinite", Value: []byte("indefinite-value"), TTL: -1 * time.Second},
	}))

	entries, err := cache.Get(ctx, []string{"positive", "default", "indefinite"})
	require.NoError(t, err)
	require.Len(t, entries, 3)
	require.NotNil(t, entries[0])
	assert.Equal(t, 5*time.Second, entries[0].RemainingTTL)
	require.NotNil(t, entries[1])
	assert.Equal(t, defaultMemoryEntityCacheTTL, entries[1].RemainingTTL)
	require.NotNil(t, entries[2])
	assert.Equal(t, time.Duration(0), entries[2].RemainingTTL)

	now = now.Add(defaultMemoryEntityCacheTTL + time.Second)
	entries, err = cache.Get(ctx, []string{"positive", "default", "indefinite"})
	require.NoError(t, err)
	require.Len(t, entries, 3)
	assert.Nil(t, entries[0])
	assert.Nil(t, entries[1])
	require.NotNil(t, entries[2])
	assert.Equal(t, []byte("indefinite-value"), entries[2].Value)
	assert.Equal(t, time.Duration(0), entries[2].RemainingTTL)
}

func TestMemoryEntityCacheDeleteRemovesPrefixedKeys(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	now := time.Date(2026, 6, 16, 10, 0, 0, 0, time.UTC)
	cache := newTestMemoryEntityCache(t, 100, "entity-prefix", func() time.Time { return now })
	require.NoError(t, cache.Set(ctx, []*resolve.CacheEntry{
		{Key: "delete-1", Value: []byte("value-1"), TTL: -1},
		{Key: "delete-2", Value: []byte("value-2"), TTL: -1},
	}))
	cache.entries["delete-1"] = memoryEntityCacheEntry{
		value: []byte("unprefixed-value"),
		size:  uint64(len("unprefixed-value")),
	}

	err := cache.Delete(ctx, []string{"delete-1", "delete-2"})

	require.NoError(t, err)
	_, ok := cache.entries["entity-prefix:delete-1"]
	assert.False(t, ok)
	_, ok = cache.entries["entity-prefix:delete-2"]
	assert.False(t, ok)
	entry, ok := cache.entries["delete-1"]
	require.True(t, ok)
	assert.Equal(t, []byte("unprefixed-value"), entry.value)
}

func TestMemoryEntityCacheSetEvictsOldestEntriesWhenMaxSizeExceeded(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	now := time.Date(2026, 6, 16, 10, 0, 0, 0, time.UTC)
	cache := newTestMemoryEntityCache(t, 8, "entity-prefix", func() time.Time { return now })
	require.NoError(t, cache.Set(ctx, []*resolve.CacheEntry{
		{Key: "oldest", Value: []byte("1111"), TTL: -1},
		{Key: "middle", Value: []byte("2222"), TTL: -1},
	}))

	require.NoError(t, cache.Set(ctx, []*resolve.CacheEntry{
		{Key: "newest", Value: []byte("3333"), TTL: -1},
	}))

	entries, err := cache.Get(ctx, []string{"oldest", "middle", "newest"})
	require.NoError(t, err)
	require.Len(t, entries, 3)
	assert.Nil(t, entries[0])
	require.NotNil(t, entries[1])
	assert.Equal(t, []byte("2222"), entries[1].Value)
	require.NotNil(t, entries[2])
	assert.Equal(t, []byte("3333"), entries[2].Value)
	assert.Equal(t, uint64(8), cache.currentSize)
}

func TestMemoryEntityCacheSetSkipsEntriesLargerThanMaxSize(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	now := time.Date(2026, 6, 16, 10, 0, 0, 0, time.UTC)
	cache := newTestMemoryEntityCache(t, 4, "entity-prefix", func() time.Time { return now })

	require.NoError(t, cache.Set(ctx, []*resolve.CacheEntry{
		{Key: "too-large", Value: []byte("12345"), TTL: -1},
	}))

	entries, err := cache.Get(ctx, []string{"too-large"})
	require.NoError(t, err)
	require.Len(t, entries, 1)
	assert.Nil(t, entries[0])
	assert.Equal(t, uint64(0), cache.currentSize)
}

func TestMemoryEntityCacheCloseDropsStore(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	now := time.Date(2026, 6, 16, 10, 0, 0, 0, time.UTC)
	cache := newMemoryEntityCache(config.MemoryStorageProvider{
		ID:      "memory-cache",
		MaxSize: 100,
	}, "entity-prefix")
	cache.now = func() time.Time { return now }
	require.NoError(t, cache.Set(ctx, []*resolve.CacheEntry{
		{Key: "close-me", Value: []byte("value"), TTL: -1},
	}))

	require.NoError(t, cache.Close())

	assert.Equal(t, uint64(0), cache.currentSize)
	assert.Equal(t, 0, len(cache.entries))
}

func TestBuildEntityCacheInstancesBuildsMemoryCacheForDefaultProvider(t *testing.T) {
	t.Parallel()

	cfg := config.EntityCachingConfiguration{
		L2: config.EntityCachingL2{
			Enabled: true,
			Storage: config.EntityCachingL2Storage{
				ProviderID: "memory-default",
				KeyPrefix:  "builder-prefix",
			},
			CircuitBreaker: config.EntityCachingCircuitBreaker{
				FailureThreshold: 7,
				CooldownPeriod:   42 * time.Second,
			},
		},
		SubgraphCacheOverrides: []config.SubgraphCacheOverride{
			{
				Name: "accounts",
				Entities: []config.EntityCacheEntityConfiguration{
					{Type: "User"},
				},
			},
		},
	}
	registry, err := NewProviderRegistry(config.StorageProviders{
		Memory: []config.MemoryStorageProvider{
			{ID: "memory-default", MaxSize: 100},
		},
	})
	require.NoError(t, err)

	caches, err := buildEntityCacheInstances(cfg, registry, zap.NewNop())

	require.NoError(t, err)
	rawCache, ok := caches["default"]
	require.True(t, ok)
	breaker := requireCircuitBreakerCache(t, rawCache)
	cache, ok := breaker.inner.(*memoryEntityCache)
	require.True(t, ok)
	t.Cleanup(func() {
		require.NoError(t, breaker.Close())
	})
	assert.Equal(t, 7, breaker.failureThreshold)
	assert.Equal(t, 42*time.Second, breaker.cooldownPeriod)
	assert.Equal(t, "builder-prefix", cache.keyPrefix)
}

func TestBuildEntityCacheInstancesBuildsMemoryCacheForEntityProviderOverride(t *testing.T) {
	t.Parallel()

	cfg := config.EntityCachingConfiguration{
		L2: config.EntityCachingL2{
			Enabled: true,
			Storage: config.EntityCachingL2Storage{
				ProviderID: "memory-default",
				KeyPrefix:  "builder-prefix",
			},
		},
		SubgraphCacheOverrides: []config.SubgraphCacheOverride{
			{
				Name: "accounts",
				Entities: []config.EntityCacheEntityConfiguration{
					{Type: "User", StorageProviderID: "entity-memory"},
				},
			},
		},
	}
	registry, err := NewProviderRegistry(config.StorageProviders{
		Memory: []config.MemoryStorageProvider{
			{ID: "memory-default", MaxSize: 100},
			{ID: "entity-memory", MaxSize: 100},
		},
	})
	require.NoError(t, err)

	caches, err := buildEntityCacheInstances(cfg, registry, zap.NewNop())

	require.NoError(t, err)
	breaker := requireCircuitBreakerCache(t, caches["entity-memory"])
	cache, ok := breaker.inner.(*memoryEntityCache)
	require.True(t, ok)
	t.Cleanup(func() {
		require.NoError(t, breaker.Close())
	})
	assert.Equal(t, uint64(100), cache.maxSize)
	assert.Equal(t, "builder-prefix", cache.keyPrefix)
}
