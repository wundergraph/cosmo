package core

import (
	"context"
	"net/http"
	"testing"
	"time"

	cachedirective "github.com/pquerna/cachecontrol/cacheobject"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/caching"

	inmemorycache "github.com/wundergraph/cosmo/router/pkg/responsecaching/cache/in_memory"
)

func TestParseRequestCacheControl(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		cacheControl []string // one entry per Cache-Control header line
		want         *cachedirective.RequestCacheDirectives
	}{
		{name: "no header"},
		{name: "empty header", cacheControl: []string{""}},
		{name: "garbage", cacheControl: []string{`no-cache="`}},
		{name: "no-cache", cacheControl: []string{"no-cache"}, want: &cachedirective.RequestCacheDirectives{NoCache: true}},
		{name: "directives on two header lines are joined", cacheControl: []string{"no-cache", "no-store"}, want: &cachedirective.RequestCacheDirectives{NoCache: true, NoStore: true}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			header := http.Header{}
			for _, value := range tc.cacheControl {
				header.Add("Cache-Control", value)
			}

			got := parseRequestCacheControl(header)
			if tc.want == nil {
				require.Nil(t, got)
				return
			}
			require.NotNil(t, got)
			require.Equal(t, tc.want.NoCache, got.NoCache)
			require.Equal(t, tc.want.NoStore, got.NoStore)
		})
	}
}

func TestSelectCacheStore(t *testing.T) {
	t.Parallel()

	store := newTestCache(t)

	t.Run("no directives use the store", func(t *testing.T) {
		t.Parallel()
		require.Same(t, store, selectCacheStore(store, nil))
	})

	t.Run("directives without no-cache or no-store use the store", func(t *testing.T) {
		t.Parallel()
		require.Same(t, store, selectCacheStore(store, &cachedirective.RequestCacheDirectives{MaxAge: 60}))
	})

	t.Run("no-store reads the store but does not write to it", func(t *testing.T) {
		t.Parallel()
		got := selectCacheStore(store, &cachedirective.RequestCacheDirectives{NoStore: true})
		require.IsType(t, readOnlyCache{}, got)
		require.Same(t, store, got.(readOnlyCache).Cache)
	})

	t.Run("no-cache with no-store keeps the request out of the cache", func(t *testing.T) {
		t.Parallel()
		require.Nil(t, selectCacheStore(store, &cachedirective.RequestCacheDirectives{NoStore: true, NoCache: true}))
	})

	t.Run("no-cache misses but writes to the store", func(t *testing.T) {
		t.Parallel()
		got := selectCacheStore(store, &cachedirective.RequestCacheDirectives{NoCache: true})
		require.IsType(t, writeOnlyCache{}, got)
		require.Same(t, store, got.(writeOnlyCache).Cache)
	})

	t.Run("a nil store is not wrapped", func(t *testing.T) {
		t.Parallel()
		for _, directives := range []*cachedirective.RequestCacheDirectives{{NoCache: true}, {NoStore: true}} {
			require.Nil(t, selectCacheStore(nil, directives))
		}
	})
}

func TestWriteOnlyCache(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := newTestCache(t)
	warm := caching.Item{Key: "warm", Value: []byte(`{"a":1}`), TTL: time.Minute}
	require.NoError(t, store.SetMany(ctx, []caching.Item{warm}))

	bypass := writeOnlyCache{store}

	t.Run("every lookup misses", func(t *testing.T) {
		found, err := bypass.GetMany(ctx, []string{"warm"})
		require.NoError(t, err)
		require.Empty(t, found)
	})

	t.Run("writes reach the store", func(t *testing.T) {
		fresh := caching.Item{Key: "fresh", Value: []byte(`{"b":2}`), TTL: time.Minute}
		require.NoError(t, bypass.SetMany(ctx, []caching.Item{fresh}))

		found, err := store.GetMany(ctx, []string{"fresh"})
		require.NoError(t, err)
		require.Equal(t, fresh.Value, found["fresh"].Value)
	})
}

func TestReadOnlyCache(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := newTestCache(t)
	warm := caching.Item{Key: "warm", Value: []byte(`{"a":1}`), TTL: time.Minute}
	require.NoError(t, store.SetMany(ctx, []caching.Item{warm}))

	noStore := readOnlyCache{store}

	t.Run("lookups reach the store", func(t *testing.T) {
		found, err := noStore.GetMany(ctx, []string{"warm"})
		require.NoError(t, err)
		require.Equal(t, warm.Value, found["warm"].Value)
	})

	t.Run("writes are dropped", func(t *testing.T) {
		fresh := caching.Item{Key: "fresh", Value: []byte(`{"b":2}`), TTL: time.Minute}
		require.NoError(t, noStore.SetMany(ctx, []caching.Item{fresh}))

		found, err := store.GetMany(ctx, []string{"fresh"})
		require.NoError(t, err)
		require.Empty(t, found)
	})
}

func newTestCache(t *testing.T) caching.Cache {
	t.Helper()
	cache, err := inmemorycache.NewInMemoryCache(100)
	require.NoError(t, err)
	t.Cleanup(func() { _ = cache.Close() })
	return cache
}
