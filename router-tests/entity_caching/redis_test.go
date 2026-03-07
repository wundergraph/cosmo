package entity_caching

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router/pkg/entitycache"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

func newTestRedisCache(t *testing.T) (*entitycache.RedisEntityCache, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { client.Close() })
	return entitycache.NewRedisEntityCache(client, "test"), mr
}

func TestRedis(t *testing.T) {
	t.Parallel()

	t.Run("basic_miss_then_hit", func(t *testing.T) {
		t.Parallel()

		cache, _ := newTestRedisCache(t)
		ctx := context.Background()

		// Get miss
		entries, err := cache.Get(ctx, []string{"key1"})
		require.NoError(t, err)
		require.Len(t, entries, 1)
		require.Nil(t, entries[0])

		// Set
		err = cache.Set(ctx, []*resolve.CacheEntry{
			{Key: "key1", Value: []byte(`{"id":"1","name":"Widget"}`)},
		}, 300*time.Second)
		require.NoError(t, err)

		// Get hit
		entries, err = cache.Get(ctx, []string{"key1"})
		require.NoError(t, err)
		require.Len(t, entries, 1)
		require.NotNil(t, entries[0])
		require.Equal(t, "key1", entries[0].Key)
		require.Equal(t, `{"id":"1","name":"Widget"}`, string(entries[0].Value))
	})

	t.Run("batch_operations", func(t *testing.T) {
		t.Parallel()

		cache, _ := newTestRedisCache(t)
		ctx := context.Background()

		// Batch Set
		err := cache.Set(ctx, []*resolve.CacheEntry{
			{Key: "a", Value: []byte(`{"id":"1"}`)},
			{Key: "b", Value: []byte(`{"id":"2"}`)},
			{Key: "c", Value: []byte(`{"id":"3"}`)},
		}, 300*time.Second)
		require.NoError(t, err)

		// Batch Get (MGet)
		entries, err := cache.Get(ctx, []string{"a", "b", "c", "d"})
		require.NoError(t, err)
		require.Len(t, entries, 4)
		require.NotNil(t, entries[0])
		require.Equal(t, `{"id":"1"}`, string(entries[0].Value))
		require.NotNil(t, entries[1])
		require.Equal(t, `{"id":"2"}`, string(entries[1].Value))
		require.NotNil(t, entries[2])
		require.Equal(t, `{"id":"3"}`, string(entries[2].Value))
		require.Nil(t, entries[3]) // "d" not set
	})

	t.Run("ttl_expiry", func(t *testing.T) {
		t.Parallel()

		cache, mr := newTestRedisCache(t)
		ctx := context.Background()

		err := cache.Set(ctx, []*resolve.CacheEntry{
			{Key: "expiring", Value: []byte(`{"ttl":"test"}`)},
		}, 1*time.Second)
		require.NoError(t, err)

		// Verify it's there
		entries, err := cache.Get(ctx, []string{"expiring"})
		require.NoError(t, err)
		require.NotNil(t, entries[0])

		// Fast-forward time
		mr.FastForward(2 * time.Second)

		// Should be expired
		entries, err = cache.Get(ctx, []string{"expiring"})
		require.NoError(t, err)
		require.Nil(t, entries[0])
	})

	t.Run("delete", func(t *testing.T) {
		t.Parallel()

		cache, _ := newTestRedisCache(t)
		ctx := context.Background()

		// Set entries
		err := cache.Set(ctx, []*resolve.CacheEntry{
			{Key: "del1", Value: []byte(`{"a":"1"}`)},
			{Key: "del2", Value: []byte(`{"b":"2"}`)},
		}, 300*time.Second)
		require.NoError(t, err)

		// Verify present
		entries, err := cache.Get(ctx, []string{"del1", "del2"})
		require.NoError(t, err)
		require.NotNil(t, entries[0])
		require.NotNil(t, entries[1])

		// Delete one
		err = cache.Delete(ctx, []string{"del1"})
		require.NoError(t, err)

		// Verify deleted
		entries, err = cache.Get(ctx, []string{"del1", "del2"})
		require.NoError(t, err)
		require.Nil(t, entries[0])
		require.NotNil(t, entries[1])
	})
}
