package entitycache

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

func newTestRedisCache(t *testing.T, prefix string) (*RedisEntityCache, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { client.Close() })
	return NewRedisEntityCache(client, prefix), mr
}

func TestNewRedisEntityCache(t *testing.T) {
	cache, _ := newTestRedisCache(t, "test")
	require.NotNil(t, cache)
	require.Equal(t, "test", cache.keyPrefix)
}

func TestRedisEntityCache_Get_Miss(t *testing.T) {
	cache, _ := newTestRedisCache(t, "pfx")
	ctx := context.Background()

	entries, err := cache.Get(ctx, []string{"nonexistent"})
	require.NoError(t, err)
	require.Len(t, entries, 1)
	require.Nil(t, entries[0])
}

func TestRedisEntityCache_Get_Hit(t *testing.T) {
	cache, mr := newTestRedisCache(t, "pfx")
	ctx := context.Background()

	// Pre-populate directly via miniredis
	require.NoError(t, mr.Set("pfx:mykey", "myvalue"))

	entries, err := cache.Get(ctx, []string{"mykey"})
	require.NoError(t, err)
	require.Len(t, entries, 1)
	require.NotNil(t, entries[0])
	require.Equal(t, "mykey", entries[0].Key)
	require.Equal(t, []byte("myvalue"), entries[0].Value)
}

func TestRedisEntityCache_SetThenGet(t *testing.T) {
	cache, _ := newTestRedisCache(t, "pfx")
	ctx := context.Background()

	err := cache.Set(ctx, []*resolve.CacheEntry{
		{Key: "k1", Value: []byte("v1")},
		{Key: "k2", Value: []byte("v2")},
	}, time.Minute)
	require.NoError(t, err)

	entries, err := cache.Get(ctx, []string{"k1", "k2"})
	require.NoError(t, err)
	require.Len(t, entries, 2)
	require.Equal(t, []byte("v1"), entries[0].Value)
	require.Equal(t, []byte("v2"), entries[1].Value)
}

func TestRedisEntityCache_Set_TTLExpiry(t *testing.T) {
	cache, mr := newTestRedisCache(t, "pfx")
	ctx := context.Background()

	err := cache.Set(ctx, []*resolve.CacheEntry{
		{Key: "ephemeral", Value: []byte("gone-soon")},
	}, 5*time.Second)
	require.NoError(t, err)

	// Key exists before expiry
	entries, err := cache.Get(ctx, []string{"ephemeral"})
	require.NoError(t, err)
	require.NotNil(t, entries[0])

	// Fast-forward past TTL
	mr.FastForward(6 * time.Second)

	entries, err = cache.Get(ctx, []string{"ephemeral"})
	require.NoError(t, err)
	require.Nil(t, entries[0])
}

func TestRedisEntityCache_DeleteThenGet(t *testing.T) {
	cache, _ := newTestRedisCache(t, "pfx")
	ctx := context.Background()

	err := cache.Set(ctx, []*resolve.CacheEntry{
		{Key: "delme", Value: []byte("val")},
	}, time.Minute)
	require.NoError(t, err)

	err = cache.Delete(ctx, []string{"delme"})
	require.NoError(t, err)

	entries, err := cache.Get(ctx, []string{"delme"})
	require.NoError(t, err)
	require.Nil(t, entries[0])
}

func TestRedisEntityCache_KeyPrefixApplied(t *testing.T) {
	cache, mr := newTestRedisCache(t, "myprefix")
	ctx := context.Background()

	err := cache.Set(ctx, []*resolve.CacheEntry{
		{Key: "item", Value: []byte("data")},
	}, time.Minute)
	require.NoError(t, err)

	// The key in Redis should be prefixed
	require.True(t, mr.Exists("myprefix:item"))

	// The raw key without prefix should not exist
	require.False(t, mr.Exists("item"))
}

func TestRedisEntityCache_Get_EmptyKeys(t *testing.T) {
	cache, _ := newTestRedisCache(t, "pfx")
	ctx := context.Background()

	entries, err := cache.Get(ctx, []string{})
	require.NoError(t, err)
	require.Nil(t, entries)
}

func TestRedisEntityCache_Set_EmptyEntries(t *testing.T) {
	cache, _ := newTestRedisCache(t, "pfx")
	ctx := context.Background()

	err := cache.Set(ctx, []*resolve.CacheEntry{}, time.Minute)
	require.NoError(t, err)
}

func TestRedisEntityCache_Delete_EmptyKeys(t *testing.T) {
	cache, _ := newTestRedisCache(t, "pfx")
	ctx := context.Background()

	err := cache.Delete(ctx, []string{})
	require.NoError(t, err)
}
