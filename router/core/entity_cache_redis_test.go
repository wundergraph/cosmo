package core

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

func newTestRedisEntityCache(t *testing.T, mr *miniredis.Miniredis, keyPrefix string) *redisEntityCache {
	t.Helper()

	cache, err := newRedisEntityCache(zap.NewNop(), config.RedisStorageProvider{
		ID:   "redis-cache",
		URLs: []string{fmt.Sprintf("redis://%s", mr.Addr())},
	}, keyPrefix)
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, cache.Close())
	})

	return cache
}

func requireMiniRedisString(t *testing.T, mr *miniredis.Miniredis, key string) string {
	t.Helper()

	value, err := mr.Get(key)
	require.NoError(t, err)
	return value
}

func TestRedisEntityCacheGetReturnsAlignedEntries(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	cache := newTestRedisEntityCache(t, mr, "entity-prefix")
	require.NoError(t, mr.Set("entity-prefix:hit-1", "value-1"))
	require.NoError(t, mr.Set("entity-prefix:hit-2", "value-2"))

	entries, err := cache.Get(ctx, []string{"hit-1", "miss", "hit-2"})

	require.NoError(t, err)
	require.Len(t, entries, 3)
	require.NotNil(t, entries[0])
	assert.Equal(t, "hit-1", entries[0].Key)
	assert.Equal(t, []byte("value-1"), entries[0].Value)
	assert.Nil(t, entries[1])
	require.NotNil(t, entries[2])
	assert.Equal(t, "hit-2", entries[2].Key)
	assert.Equal(t, []byte("value-2"), entries[2].Value)
}

func TestRedisEntityCacheGetPopulatesRemainingTTL(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	cache := newTestRedisEntityCache(t, mr, "entity-prefix")
	require.NoError(t, mr.Set("entity-prefix:ttl", "value"))
	mr.SetTTL("entity-prefix:ttl", 30*time.Second)

	entries, err := cache.Get(ctx, []string{"ttl"})

	require.NoError(t, err)
	require.Len(t, entries, 1)
	require.NotNil(t, entries[0])
	assert.Equal(t, 30*time.Second, entries[0].RemainingTTL)
}

func TestRedisEntityCacheSetStoresPositiveTTLWithExpiry(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	cache := newTestRedisEntityCache(t, mr, "entity-prefix")

	err := cache.Set(ctx, []*resolve.CacheEntry{
		{Key: "positive", Value: []byte("positive-value"), TTL: 5 * time.Second},
	})

	require.NoError(t, err)
	assert.Equal(t, "positive-value", requireMiniRedisString(t, mr, "entity-prefix:positive"))
	assert.Equal(t, 5*time.Second, mr.TTL("entity-prefix:positive"))
	mr.FastForward(5 * time.Second)
	assert.False(t, mr.Exists("entity-prefix:positive"))
}

func TestRedisEntityCacheSetWithZeroTTLKeepsExistingExpiry(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	cache := newTestRedisEntityCache(t, mr, "entity-prefix")
	require.NoError(t, cache.Set(ctx, []*resolve.CacheEntry{
		{Key: "keep", Value: []byte("old-value"), TTL: 20 * time.Second},
	}))

	err := cache.Set(ctx, []*resolve.CacheEntry{
		{Key: "keep", Value: []byte("new-value"), TTL: 0},
	})

	require.NoError(t, err)
	assert.Equal(t, "new-value", requireMiniRedisString(t, mr, "entity-prefix:keep"))
	assert.Equal(t, 20*time.Second, mr.TTL("entity-prefix:keep"))
}

func TestRedisEntityCacheSetWithNegativeTTLStoresWithoutExpiry(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	cache := newTestRedisEntityCache(t, mr, "entity-prefix")
	require.NoError(t, cache.Set(ctx, []*resolve.CacheEntry{
		{Key: "indefinite", Value: []byte("old-value"), TTL: 20 * time.Second},
	}))

	err := cache.Set(ctx, []*resolve.CacheEntry{
		{Key: "indefinite", Value: []byte("new-value"), TTL: -1 * time.Second},
	})

	require.NoError(t, err)
	assert.Equal(t, "new-value", requireMiniRedisString(t, mr, "entity-prefix:indefinite"))
	assert.Equal(t, time.Duration(0), mr.TTL("entity-prefix:indefinite"))
	mr.FastForward(20 * time.Second)
	assert.True(t, mr.Exists("entity-prefix:indefinite"))
}

func TestRedisEntityCacheDeleteRemovesPrefixedKeys(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	cache := newTestRedisEntityCache(t, mr, "entity-prefix")
	require.NoError(t, mr.Set("entity-prefix:delete-1", "value-1"))
	require.NoError(t, mr.Set("entity-prefix:delete-2", "value-2"))
	require.NoError(t, mr.Set("delete-1", "unprefixed-value"))

	err := cache.Delete(ctx, []string{"delete-1", "delete-2"})

	require.NoError(t, err)
	assert.False(t, mr.Exists("entity-prefix:delete-1"))
	assert.False(t, mr.Exists("entity-prefix:delete-2"))
	assert.True(t, mr.Exists("delete-1"))
}

func TestBuildEntityCacheInstancesBuildsRedisCacheForDefaultProvider(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	cfg := config.EntityCachingConfiguration{
		L2: config.EntityCachingL2{
			Enabled: true,
			Storage: config.EntityCachingL2Storage{
				ProviderID: "redis-default",
				KeyPrefix:  "builder-prefix",
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
		Redis: []config.RedisStorageProvider{
			{ID: "redis-default", URLs: []string{fmt.Sprintf("redis://%s", mr.Addr())}},
		},
	})
	require.NoError(t, err)

	caches, err := buildEntityCacheInstances(cfg, registry, zap.NewNop())

	require.NoError(t, err)
	rawCache, ok := caches["default"]
	require.True(t, ok)
	breaker := requireCircuitBreakerCache(t, rawCache)
	cache, ok := breaker.inner.(*redisEntityCache)
	require.True(t, ok)
	t.Cleanup(func() {
		require.NoError(t, breaker.Close())
	})
	require.NoError(t, cache.Set(ctx, []*resolve.CacheEntry{
		{Key: "builder-key", Value: []byte("builder-value"), TTL: -1 * time.Second},
	}))
	assert.Equal(t, "builder-value", requireMiniRedisString(t, mr, "builder-prefix:builder-key"))
}

func TestBuildEntityCacheInstancesBuildsRedisCacheForEntityProviderOverride(t *testing.T) {
	t.Parallel()

	mr := miniredis.RunT(t)
	cfg := config.EntityCachingConfiguration{
		L2: config.EntityCachingL2{
			Enabled: true,
			Storage: config.EntityCachingL2Storage{
				ProviderID: "redis-default",
				KeyPrefix:  "builder-prefix",
			},
		},
		SubgraphCacheOverrides: []config.SubgraphCacheOverride{
			{
				Name: "accounts",
				Entities: []config.EntityCacheEntityConfiguration{
					{Type: "User", StorageProviderID: "entity-redis"},
				},
			},
		},
	}
	registry, err := NewProviderRegistry(config.StorageProviders{
		Redis: []config.RedisStorageProvider{
			{ID: "redis-default", URLs: []string{fmt.Sprintf("redis://%s", mr.Addr())}},
			{ID: "entity-redis", URLs: []string{fmt.Sprintf("redis://%s", mr.Addr())}},
		},
	})
	require.NoError(t, err)

	caches, err := buildEntityCacheInstances(cfg, registry, zap.NewNop())

	require.NoError(t, err)
	breaker := requireCircuitBreakerCache(t, caches["entity-redis"])
	_, ok := breaker.inner.(*redisEntityCache)
	require.True(t, ok)
	t.Cleanup(func() {
		require.NoError(t, breaker.Close())
	})
}
