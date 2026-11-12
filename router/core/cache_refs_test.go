package core

import (
	"testing"
	"testing/synctest"
	"time"

	"github.com/dgraph-io/ristretto/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router/pkg/slowplancache"
)

func TestCacheRefs(t *testing.T) {
	t.Parallel()

	t.Run("the last release closes the caches", func(t *testing.T) {
		t.Parallel()

		closes := 0
		refs := newCacheRefs(func() { closes++ })

		first, second := refs.acquire(), refs.acquire()
		refs.release() // the mux shuts down
		first()
		assert.Zero(t, closes, "the caches were closed while an operation used them")

		second()
		assert.Equal(t, 1, closes)
	})

	t.Run("acquire waits for a close in progress", func(t *testing.T) {
		t.Parallel()

		synctest.Test(t, func(t *testing.T) {
			closing, finish := make(chan struct{}), make(chan struct{})
			refs := newCacheRefs(func() {
				close(closing)
				<-finish
			})
			go refs.release()
			<-closing

			acquired := make(chan func(), 1)
			go func() { acquired <- refs.acquire() }()

			synctest.Wait()
			select {
			case <-acquired:
				require.Fail(t, "acquire returned while the caches were being closed")
			default:
			}

			close(finish)
			release := <-acquired
			release()
			assert.Zero(t, refs.refs.Load(), "an operation that came late must not hold a reference")
		})
	})
}

// cacheRefs lets an operation that comes too late use the closed caches.
func TestClosedCachesAreSafeToUse(t *testing.T) {
	t.Parallel()

	cache, err := ristretto.NewCache(&ristretto.Config[uint64, string]{NumCounters: 100, MaxCost: 10, BufferItems: 64})
	require.NoError(t, err)
	cache.Close()

	assert.NotPanics(t, func() {
		assert.False(t, cache.Set(1, "a", 1))
		cache.Wait()
		_, ok := cache.Get(1)
		assert.False(t, ok)
	})

	slow, err := slowplancache.New[string](10, time.Millisecond)
	require.NoError(t, err)
	slow.Close()

	assert.NotPanics(t, func() {
		slow.Set(1, "a", time.Second)
		slow.Wait()
		_, ok := slow.Get(1)
		assert.False(t, ok)
	})
}
