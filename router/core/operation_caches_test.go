package core

import (
	"testing"
	"testing/synctest"

	"github.com/dgraph-io/ristretto/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOperationCaches(t *testing.T) {
	t.Parallel()

	t.Run("the last release closes the caches", func(t *testing.T) {
		t.Parallel()

		caches := newTestOperationCaches(t)
		mux := &graphMux{cancel: func() {}, caches: caches}

		first, second := caches.Acquire(), caches.Acquire()
		require.NoError(t, mux.Shutdown(t.Context()))
		first()
		assert.True(t, caches.Validation.Set(1, true, 1), "the caches were closed while an operation used them")

		second()
		assert.False(t, caches.Validation.Set(1, true, 1), "the last release must close the caches")
	})

	t.Run("acquire waits for a close in progress", func(t *testing.T) {
		t.Parallel()

		synctest.Test(t, func(t *testing.T) {
			// The caches are closing: no references left, close not finished.
			caches := &OperationCaches{closed: make(chan struct{})}

			acquired := make(chan struct{})
			go func() {
				caches.Acquire()
				close(acquired)
			}()

			synctest.Wait()
			select {
			case <-acquired:
				require.Fail(t, "acquire returned while the caches were being closed")
			default:
			}

			close(caches.closed)
			<-acquired
		})
	})
}

func newTestOperationCaches(t *testing.T) *OperationCaches {
	t.Helper()

	caches := NewOperationCaches()
	var err error
	caches.Validation, err = ristretto.NewCache(&ristretto.Config[uint64, bool]{NumCounters: 100, MaxCost: 10, BufferItems: 64})
	require.NoError(t, err)
	return caches
}
