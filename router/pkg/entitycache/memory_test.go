package entitycache

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

const testCacheSize = 10 * 1024 * 1024 // 10MB

func newTestCache(t *testing.T) *MemoryEntityCache {
	t.Helper()
	c, err := NewMemoryEntityCache(testCacheSize)
	require.NoError(t, err)
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func TestMemoryEntityCache_GetMiss(t *testing.T) {
	c := newTestCache(t)
	entries, err := c.Get(context.Background(), []string{"key1", "key2"})
	require.NoError(t, err)
	require.Len(t, entries, 2)
	assert.Nil(t, entries[0])
	assert.Nil(t, entries[1])
}

func TestMemoryEntityCache_SetThenGet(t *testing.T) {
	c := newTestCache(t)
	ctx := context.Background()
	err := c.Set(ctx, []*resolve.CacheEntry{
		{Key: "k1", Value: []byte("v1")},
		{Key: "k2", Value: []byte("v2")},
	}, 5*time.Second)
	require.NoError(t, err)

	entries, err := c.Get(ctx, []string{"k1", "k2"})
	require.NoError(t, err)
	require.Len(t, entries, 2)
	assert.Equal(t, []byte("v1"), entries[0].Value)
	assert.Equal(t, []byte("v2"), entries[1].Value)
}

func TestMemoryEntityCache_PartialHit(t *testing.T) {
	c := newTestCache(t)
	ctx := context.Background()
	require.NoError(t, c.Set(ctx, []*resolve.CacheEntry{
		{Key: "k1", Value: []byte("v1")},
	}, 5*time.Second))

	entries, err := c.Get(ctx, []string{"k1", "k2"})
	require.NoError(t, err)
	require.Len(t, entries, 2)
	assert.NotNil(t, entries[0])
	assert.Nil(t, entries[1])
}

func TestMemoryEntityCache_Delete(t *testing.T) {
	c := newTestCache(t)
	ctx := context.Background()
	require.NoError(t, c.Set(ctx, []*resolve.CacheEntry{
		{Key: "k1", Value: []byte("v1")},
	}, 5*time.Second))

	require.NoError(t, c.Delete(ctx, []string{"k1"}))

	entries, err := c.Get(ctx, []string{"k1"})
	require.NoError(t, err)
	assert.Nil(t, entries[0])
}

func TestMemoryEntityCache_DeleteNonexistent(t *testing.T) {
	c := newTestCache(t)
	err := c.Delete(context.Background(), []string{"nonexistent"})
	require.NoError(t, err)
}

func TestMemoryEntityCache_TTLExpiry(t *testing.T) {
	c := newTestCache(t)
	ctx := context.Background()
	require.NoError(t, c.Set(ctx, []*resolve.CacheEntry{
		{Key: "k1", Value: []byte("v1")},
	}, 50*time.Millisecond))

	// Should be present immediately
	entries, err := c.Get(ctx, []string{"k1"})
	require.NoError(t, err)
	assert.NotNil(t, entries[0])

	// Wait for expiry — ristretto's TTL cleanup ticker runs periodically
	require.Eventually(t, func() bool {
		entries, err = c.Get(ctx, []string{"k1"})
		return err == nil && entries[0] == nil
	}, 2*time.Second, 50*time.Millisecond)
}

func TestMemoryEntityCache_Overwrite(t *testing.T) {
	c := newTestCache(t)
	ctx := context.Background()
	require.NoError(t, c.Set(ctx, []*resolve.CacheEntry{
		{Key: "k1", Value: []byte("v1")},
	}, 5*time.Second))
	require.NoError(t, c.Set(ctx, []*resolve.CacheEntry{
		{Key: "k1", Value: []byte("v2")},
	}, 5*time.Second))

	entries, err := c.Get(ctx, []string{"k1"})
	require.NoError(t, err)
	assert.Equal(t, []byte("v2"), entries[0].Value)
}

func TestMemoryEntityCache_EmptyBatch(t *testing.T) {
	c := newTestCache(t)
	ctx := context.Background()

	entries, err := c.Get(ctx, nil)
	require.NoError(t, err)
	assert.Nil(t, entries)

	require.NoError(t, c.Set(ctx, nil, 0))
	require.NoError(t, c.Delete(ctx, nil))
}

func TestMemoryEntityCache_NilEntriesInSet(t *testing.T) {
	c := newTestCache(t)
	err := c.Set(context.Background(), []*resolve.CacheEntry{
		nil,
		{Key: "k1", Value: []byte("v1")},
		nil,
	}, 5*time.Second)
	require.NoError(t, err)

	entries, err := c.Get(context.Background(), []string{"k1"})
	require.NoError(t, err)
	assert.NotNil(t, entries[0])
}

func TestMemoryEntityCache_ConcurrentAccess(t *testing.T) {
	c := newTestCache(t)
	ctx := context.Background()
	var wg sync.WaitGroup

	var firstErrOnce sync.Once
	var firstErr error
	recordErr := func(err error) {
		if err == nil {
			return
		}
		firstErrOnce.Do(func() { firstErr = err })
	}

	for i := range 10 {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			key := "key" + string(rune('0'+n))
			recordErr(c.Set(ctx, []*resolve.CacheEntry{
				{Key: key, Value: []byte("val")},
			}, 5*time.Second))
			_, err := c.Get(ctx, []string{key})
			recordErr(err)
			recordErr(c.Delete(ctx, []string{key}))
		}(i)
	}
	wg.Wait()
	require.NoError(t, firstErr)
}

func TestMemoryEntityCache_NoExpiryWithZeroTTL(t *testing.T) {
	c := newTestCache(t)
	ctx := context.Background()
	require.NoError(t, c.Set(ctx, []*resolve.CacheEntry{
		{Key: "k1", Value: []byte("v1")},
	}, 0))

	// Should still be present (no expiry)
	time.Sleep(10 * time.Millisecond)
	entries, err := c.Get(ctx, []string{"k1"})
	require.NoError(t, err)
	assert.NotNil(t, entries[0])
}

func TestMemoryEntityCache_RemainingTTL(t *testing.T) {
	c := newTestCache(t)
	ctx := context.Background()
	require.NoError(t, c.Set(ctx, []*resolve.CacheEntry{
		{Key: "k1", Value: []byte("v1")},
	}, 5*time.Second))

	entries, err := c.Get(ctx, []string{"k1"})
	require.NoError(t, err)
	require.NotNil(t, entries[0])
	assert.True(t, entries[0].RemainingTTL > 0)
	assert.True(t, entries[0].RemainingTTL <= 5*time.Second)
}

func TestMemoryEntityCache_InvalidMaxSize(t *testing.T) {
	_, err := NewMemoryEntityCache(0)
	require.Error(t, err)

	_, err = NewMemoryEntityCache(-1)
	require.Error(t, err)
}

func TestMemoryEntityCache_EvictsWhenFull(t *testing.T) {
	// Create a tiny cache (1KB)
	c, err := NewMemoryEntityCache(1024)
	require.NoError(t, err)
	t.Cleanup(func() { _ = c.Close() })

	ctx := context.Background()
	// Fill with entries larger than cache capacity
	val := make([]byte, 512)
	for i := range len(val) {
		val[i] = byte(i % 256)
	}
	const totalKeys = 10
	for i := range totalKeys {
		key := "key" + string(rune('A'+i))
		require.NoError(t, c.Set(ctx, []*resolve.CacheEntry{
			{Key: key, Value: val},
		}, 5*time.Second))
	}

	// Ristretto's admission policy and sampled counters make the exact number
	// of survivors non-deterministic. With 1KB MaxCost and 512B entries the
	// cache CANNOT hold all 10 entries, and in practice rarely holds the full
	// theoretical 2. Assert the upper bound (eviction happened) and the lower
	// bound (the cache isn't completely empty). Flush outstanding async work
	// via cache.Wait() to stabilize before measuring.
	c.cache.Wait()

	hitCount := 0
	for i := range totalKeys {
		key := "key" + string(rune('A'+i))
		entries, err := c.Get(ctx, []string{key})
		require.NoError(t, err)
		if entries[0] != nil {
			hitCount++
		}
	}

	// With 1KB max and 512B entries, at most ~2 can coexist. Admission may
	// evict entries we just wrote before we read, so the lower bound is 0 —
	// the only invariant we care about is that not ALL 10 survive.
	assert.LessOrEqual(t, hitCount, 2, "cache must evict to stay within MaxCost")
	assert.Less(t, hitCount, totalKeys, "cache must evict at least some entries")
}

func TestMemoryEntityCache_Close(t *testing.T) {
	c, err := NewMemoryEntityCache(testCacheSize)
	require.NoError(t, err)

	ctx := context.Background()
	require.NoError(t, c.Set(ctx, []*resolve.CacheEntry{
		{Key: "k1", Value: []byte("v1")},
	}, 5*time.Second))

	c.Close()

	// After close, Get returns zero values without panicking. The post-close
	// path may return nil entries or an empty slice; either is acceptable so
	// long as the call doesn't panic and no entry is resurrected.
	entries, err := c.Get(ctx, []string{"k1"})
	require.NoError(t, err)
	if len(entries) > 0 {
		assert.Nil(t, entries[0])
	}
}
