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

func TestRedisEntityCache_ConstructorStoresKeyPrefix(t *testing.T) {
	t.Parallel()
	cache, _ := newTestRedisCache(t, "test")
	require.NotNil(t, cache)
	require.Equal(t, "test", cache.keyPrefix)
}

func TestRedisEntityCache_GetReturnsNilForMissingKey(t *testing.T) {
	t.Parallel()
	cache, _ := newTestRedisCache(t, "pfx")
	ctx := context.Background()

	entries, err := cache.Get(ctx, []string{"nonexistent"})
	require.NoError(t, err)
	require.Len(t, entries, 1)
	require.Nil(t, entries[0])
}

func TestRedisEntityCache_GetReturnsValueForExistingKey(t *testing.T) {
	t.Parallel()
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

func TestRedisEntityCache_SetThenGetReturnsStoredValues(t *testing.T) {
	t.Parallel()
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

func TestRedisEntityCache_KeyExpiresAfterTTL(t *testing.T) {
	t.Parallel()
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

func TestRedisEntityCache_DeleteRemovesKey(t *testing.T) {
	t.Parallel()
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

func TestRedisEntityCache_KeyPrefixAppliedToStoredKey(t *testing.T) {
	t.Parallel()
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

func TestRedisEntityCache_GetWithEmptyKeysReturnsNil(t *testing.T) {
	t.Parallel()
	cache, _ := newTestRedisCache(t, "pfx")
	ctx := context.Background()

	entries, err := cache.Get(ctx, []string{})
	require.NoError(t, err)
	require.Nil(t, entries)
}

func TestRedisEntityCache_SetWithEmptyEntriesIsNoop(t *testing.T) {
	t.Parallel()
	cache, _ := newTestRedisCache(t, "pfx")
	ctx := context.Background()

	err := cache.Set(ctx, []*resolve.CacheEntry{}, time.Minute)
	require.NoError(t, err)
}

func TestRedisEntityCache_DeleteWithEmptyKeysIsNoop(t *testing.T) {
	t.Parallel()
	cache, _ := newTestRedisCache(t, "pfx")
	ctx := context.Background()

	err := cache.Delete(ctx, []string{})
	require.NoError(t, err)
}

func TestRedisEntityCache_GetAfterCloseReturnsError(t *testing.T) {
	t.Parallel()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	cache := NewRedisEntityCache(client, "test")

	err := cache.Close()
	require.NoError(t, err)

	// After closing, operations should fail
	_, err = cache.Get(context.Background(), []string{"key"})
	require.Error(t, err)
}

// TestRedisEntityCache_SetAndDeleteAfterCloseReturnError verifies the same
// post-close semantics for the mutating operations: Set and Delete must also
// surface an error instead of silently succeeding against a closed client.
func TestRedisEntityCache_SetAndDeleteAfterCloseReturnError(t *testing.T) {
	t.Parallel()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	cache := NewRedisEntityCache(client, "test")

	require.NoError(t, cache.Close())

	err := cache.Set(context.Background(),
		[]*resolve.CacheEntry{{Key: "k", Value: []byte("v")}}, time.Minute)
	require.Error(t, err, "Set on closed client must return error")

	err = cache.Delete(context.Background(), []string{"k"})
	require.Error(t, err, "Delete on closed client must return error")
}
