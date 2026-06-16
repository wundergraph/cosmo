package core

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type fakeCircuitBreakerLoaderCache struct {
	getEntries []*resolve.CacheEntry
	getErr     error
	setErr     error
	deleteErr  error

	getCalls    int
	setCalls    int
	deleteCalls int
	closeCalls  int
}

func (f *fakeCircuitBreakerLoaderCache) Get(ctx context.Context, keys []string) ([]*resolve.CacheEntry, error) {
	f.getCalls++
	if f.getErr != nil {
		return nil, f.getErr
	}
	if f.getEntries != nil {
		return f.getEntries, nil
	}
	return make([]*resolve.CacheEntry, len(keys)), nil
}

func (f *fakeCircuitBreakerLoaderCache) Set(ctx context.Context, entries []*resolve.CacheEntry) error {
	f.setCalls++
	return f.setErr
}

func (f *fakeCircuitBreakerLoaderCache) Delete(ctx context.Context, keys []string) error {
	f.deleteCalls++
	return f.deleteErr
}

func (f *fakeCircuitBreakerLoaderCache) Close() error {
	f.closeCalls++
	return nil
}

func newTestCircuitBreakerCache(inner resolve.LoaderCache, now func() time.Time) *circuitBreakerCache {
	cache := newCircuitBreakerCache(inner, config.EntityCachingCircuitBreaker{
		FailureThreshold: 3,
		CooldownPeriod:   time.Minute,
	})
	cache.now = now
	return cache
}

func requireCircuitBreakerCache(t *testing.T, rawCache resolve.LoaderCache) *circuitBreakerCache {
	t.Helper()

	cache, ok := rawCache.(*circuitBreakerCache)
	require.True(t, ok)
	return cache
}

func TestCircuitBreakerCacheClosedPassesThrough(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 6, 16, 10, 0, 0, 0, time.UTC)
	inner := &fakeCircuitBreakerLoaderCache{
		getEntries: []*resolve.CacheEntry{
			{Key: "hit", Value: []byte("value"), RemainingTTL: time.Minute},
		},
	}
	cache := newTestCircuitBreakerCache(inner, func() time.Time { return now })

	entries, err := cache.Get(context.Background(), []string{"hit"})

	require.NoError(t, err)
	require.Len(t, entries, 1)
	require.NotNil(t, entries[0])
	assert.Equal(t, "hit", entries[0].Key)
	assert.Equal(t, []byte("value"), entries[0].Value)
	assert.Equal(t, 1, inner.getCalls)
}

func TestCircuitBreakerCacheOpensAfterFailureThreshold(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	now := time.Date(2026, 6, 16, 10, 0, 0, 0, time.UTC)
	backendErr := errors.New("backend unavailable")
	inner := &fakeCircuitBreakerLoaderCache{getErr: backendErr, setErr: backendErr, deleteErr: backendErr}
	cache := newTestCircuitBreakerCache(inner, func() time.Time { return now })

	for i := 0; i < 2; i++ {
		entries, err := cache.Get(ctx, []string{"miss"})
		require.ErrorIs(t, err, backendErr)
		assert.Nil(t, entries)
	}
	entries, err := cache.Get(ctx, []string{"miss"})
	require.ErrorIs(t, err, backendErr)
	assert.Nil(t, entries)
	assert.Equal(t, 3, inner.getCalls)

	entries, err = cache.Get(ctx, []string{"a", "b"})
	require.NoError(t, err)
	require.Len(t, entries, 2)
	assert.Nil(t, entries[0])
	assert.Nil(t, entries[1])
	assert.Equal(t, 3, inner.getCalls)

	require.NoError(t, cache.Set(ctx, []*resolve.CacheEntry{{Key: "a", Value: []byte("value")}}))
	require.NoError(t, cache.Delete(ctx, []string{"a"}))
	assert.Equal(t, 0, inner.setCalls)
	assert.Equal(t, 0, inner.deleteCalls)
}

func TestCircuitBreakerCacheSetAndDeleteFailuresOpenBreaker(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	now := time.Date(2026, 6, 16, 10, 0, 0, 0, time.UTC)
	backendErr := errors.New("backend unavailable")
	inner := &fakeCircuitBreakerLoaderCache{setErr: backendErr, deleteErr: backendErr}
	cache := newTestCircuitBreakerCache(inner, func() time.Time { return now })

	require.ErrorIs(t, cache.Set(ctx, []*resolve.CacheEntry{{Key: "first", Value: []byte("value")}}), backendErr)
	require.ErrorIs(t, cache.Delete(ctx, []string{"second"}), backendErr)
	require.ErrorIs(t, cache.Set(ctx, []*resolve.CacheEntry{{Key: "third", Value: []byte("value")}}), backendErr)

	require.NoError(t, cache.Set(ctx, []*resolve.CacheEntry{{Key: "short-circuited", Value: []byte("value")}}))
	entries, err := cache.Get(ctx, []string{"short-circuited"})
	require.NoError(t, err)
	require.Len(t, entries, 1)
	assert.Nil(t, entries[0])
	assert.Equal(t, 2, inner.setCalls)
	assert.Equal(t, 1, inner.deleteCalls)
	assert.Equal(t, 0, inner.getCalls)
}

func TestCircuitBreakerCacheHalfOpenSuccessCloses(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	now := time.Date(2026, 6, 16, 10, 0, 0, 0, time.UTC)
	backendErr := errors.New("backend unavailable")
	inner := &fakeCircuitBreakerLoaderCache{getErr: backendErr}
	cache := newTestCircuitBreakerCache(inner, func() time.Time { return now })

	for i := 0; i < 3; i++ {
		_, err := cache.Get(ctx, []string{"miss"})
		require.ErrorIs(t, err, backendErr)
	}
	now = now.Add(time.Minute)
	inner.getErr = nil
	inner.getEntries = []*resolve.CacheEntry{{Key: "hit", Value: []byte("value")}}

	entries, err := cache.Get(ctx, []string{"hit"})
	require.NoError(t, err)
	require.Len(t, entries, 1)
	require.NotNil(t, entries[0])
	assert.Equal(t, []byte("value"), entries[0].Value)
	assert.Equal(t, 4, inner.getCalls)

	_, err = cache.Get(ctx, []string{"hit"})
	require.NoError(t, err)
	assert.Equal(t, 5, inner.getCalls)
}

func TestCircuitBreakerCacheHalfOpenFailureReopens(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	now := time.Date(2026, 6, 16, 10, 0, 0, 0, time.UTC)
	backendErr := errors.New("backend unavailable")
	inner := &fakeCircuitBreakerLoaderCache{getErr: backendErr}
	cache := newTestCircuitBreakerCache(inner, func() time.Time { return now })

	for i := 0; i < 3; i++ {
		_, err := cache.Get(ctx, []string{"miss"})
		require.ErrorIs(t, err, backendErr)
	}
	now = now.Add(time.Minute)

	entries, err := cache.Get(ctx, []string{"trial"})
	require.ErrorIs(t, err, backendErr)
	assert.Nil(t, entries)
	assert.Equal(t, 4, inner.getCalls)

	entries, err = cache.Get(ctx, []string{"short-circuited"})
	require.NoError(t, err)
	require.Len(t, entries, 1)
	assert.Nil(t, entries[0])
	assert.Equal(t, 4, inner.getCalls)
}

func TestCircuitBreakerCacheSuccessResetsConsecutiveFailures(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	now := time.Date(2026, 6, 16, 10, 0, 0, 0, time.UTC)
	backendErr := errors.New("backend unavailable")
	inner := &fakeCircuitBreakerLoaderCache{getErr: backendErr}
	cache := newTestCircuitBreakerCache(inner, func() time.Time { return now })

	for i := 0; i < 2; i++ {
		_, err := cache.Get(ctx, []string{"miss"})
		require.ErrorIs(t, err, backendErr)
	}
	inner.getErr = nil
	entries, err := cache.Get(ctx, []string{"miss"})
	require.NoError(t, err)
	require.Len(t, entries, 1)
	assert.Nil(t, entries[0])

	inner.getErr = backendErr
	for i := 0; i < 2; i++ {
		_, err = cache.Get(ctx, []string{"miss"})
		require.ErrorIs(t, err, backendErr)
	}

	entries, err = cache.Get(ctx, []string{"still-closed"})
	require.ErrorIs(t, err, backendErr)
	assert.Nil(t, entries)
	assert.Equal(t, 6, inner.getCalls)

	entries, err = cache.Get(ctx, []string{"open"})
	require.NoError(t, err)
	require.Len(t, entries, 1)
	assert.Nil(t, entries[0])
	assert.Equal(t, 6, inner.getCalls)
}

func TestCircuitBreakerCacheCloseClosesInner(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 6, 16, 10, 0, 0, 0, time.UTC)
	inner := &fakeCircuitBreakerLoaderCache{}
	cache := newTestCircuitBreakerCache(inner, func() time.Time { return now })

	require.NoError(t, cache.Close())

	assert.Equal(t, 1, inner.closeCalls)
}
