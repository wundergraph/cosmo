package operationmanifest

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/goleak"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

func TestStore(t *testing.T) {
	t.Run("Load and LookupByHash", func(t *testing.T) {
		store := NewStore(t.Context(), zap.NewNop())

		store.Load(&Manifest{
			Version:    1,
			Revision:   "rev-1",
			Operations: map[string]string{"abc": "query { a }"},
		})

		body, found := store.LookupByHash("abc")
		require.True(t, found)
		require.Equal(t, "query { a }", string(body))
		require.Equal(t, "rev-1", store.Revision())
	})

	t.Run("LookupByHash returns false on empty store", func(t *testing.T) {
		store := NewStore(t.Context(), zap.NewNop())

		body, found := store.LookupByHash("abc")
		require.False(t, found)
		require.Nil(t, body)
	})

	t.Run("LookupByHash returns false for unknown hash", func(t *testing.T) {
		store := NewStore(t.Context(), zap.NewNop())
		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"abc": "query { a }"}})

		body, found := store.LookupByHash("unknown")
		require.False(t, found)
		require.Nil(t, body)
	})

	t.Run("Revision changes on Load", func(t *testing.T) {
		store := NewStore(t.Context(), zap.NewNop())

		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"abc": "query { a }"}})
		require.Equal(t, "rev-1", store.Revision())

		store.Load(&Manifest{Version: 1, Revision: "rev-2", Operations: map[string]string{"def": "query { b }"}})
		require.Equal(t, "rev-2", store.Revision())

		// Old operation gone, new one present
		_, found := store.LookupByHash("abc")
		require.False(t, found)
		body, found := store.LookupByHash("def")
		require.True(t, found)
		require.Equal(t, "query { b }", string(body))
	})

	t.Run("Revision returns empty string on empty store", func(t *testing.T) {
		store := NewStore(t.Context(), zap.NewNop())
		require.Equal(t, "", store.Revision())
	})

	t.Run("IsLoaded", func(t *testing.T) {
		store := NewStore(t.Context(), zap.NewNop())
		require.False(t, store.IsLoaded())

		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"a": "q"}})
		require.True(t, store.IsLoaded())
	})

	t.Run("OperationCount", func(t *testing.T) {
		store := NewStore(t.Context(), zap.NewNop())
		require.Equal(t, 0, store.OperationCount())

		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{
			"a": "q1",
			"b": "q2",
			"c": "q3",
		}})
		require.Equal(t, 3, store.OperationCount())
	})

	t.Run("AllOperations returns nil when not loaded", func(t *testing.T) {
		store := NewStore(t.Context(), zap.NewNop())
		require.Nil(t, store.AllOperations())
	})

	t.Run("AllOperations returns all operations", func(t *testing.T) {
		store := NewStore(t.Context(), zap.NewNop())
		ops := map[string]string{
			"hash1": "query { a }",
			"hash2": "query { b }",
			"hash3": "mutation { c }",
		}
		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: ops})

		result := store.AllOperations()
		require.Equal(t, ops, result)
	})

	t.Run("SetOnUpdate callback is invoked on Load", func(t *testing.T) {
		synctest.Test(t, func(t *testing.T) {
			store := NewStore(t.Context(), zap.NewNop())

			var calls atomic.Int32
			store.SetOnUpdate(func() {
				calls.Add(1)
			})

			store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"a": "query { a }"}})

			synctest.Wait()
			require.Equal(t, int32(1), calls.Load())
		})
	})

	t.Run("SetOnUpdate not called when no callback set", func(t *testing.T) {
		store := NewStore(t.Context(), zap.NewNop())
		// Should not panic
		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"a": "query { a }"}})
	})

	t.Run("SetOnUpdate runs callbacks sequentially", func(t *testing.T) {
		synctest.Test(t, func(t *testing.T) {
			store := NewStore(t.Context(), zap.NewNop())

			var concurrent atomic.Int32
			var maxConcurrent atomic.Int32
			var totalCalls atomic.Int32

			store.SetOnUpdate(func() {
				c := concurrent.Add(1)
				// Track the max concurrency observed
				for {
					old := maxConcurrent.Load()
					if c <= old || maxConcurrent.CompareAndSwap(old, c) {
						break
					}
				}
				time.Sleep(10 * time.Millisecond)
				totalCalls.Add(1)
				concurrent.Add(-1)
			})

			// The first update puts the worker inside the callback. The next
			// four coalesce into one buffered signal, so exactly two callbacks
			// run, and they must run sequentially (max concurrency = 1).
			store.Load(&Manifest{Version: 1, Revision: "rev-0", Operations: map[string]string{"a": "q"}})
			synctest.Wait()
			for i := 1; i < 5; i++ {
				store.Load(&Manifest{
					Version:    1,
					Revision:   fmt.Sprintf("rev-%d", i),
					Operations: map[string]string{"a": "q"},
				})
			}

			time.Sleep(time.Second)
			synctest.Wait()

			require.Equal(t, int32(2), totalCalls.Load())
			require.Equal(t, int32(1), maxConcurrent.Load(), "callbacks must run sequentially, never concurrently")
		})
	})

	t.Run("rapid loads coalesce signals when worker is busy", func(t *testing.T) {
		synctest.Test(t, func(t *testing.T) {
			core, logs := observer.New(zap.DebugLevel)
			store := NewStore(t.Context(), zap.New(core))

			processing := make(chan struct{})
			proceed := make(chan struct{})
			var totalCalls atomic.Int32

			store.SetOnUpdate(func() {
				totalCalls.Add(1)
				processing <- struct{}{} // signal that we started
				<-proceed                // block until test says go
			})

			// First Load — worker picks it up
			store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"a": "q"}})
			<-processing // wait until worker is busy

			// Second Load — fills the channel buffer (1 pending signal)
			store.Load(&Manifest{Version: 1, Revision: "rev-2", Operations: map[string]string{"a": "q"}})

			// Third and fourth Loads — dropped (channel full, worker busy)
			store.Load(&Manifest{Version: 1, Revision: "rev-3", Operations: map[string]string{"a": "q"}})
			store.Load(&Manifest{Version: 1, Revision: "rev-4", Operations: map[string]string{"a": "q"}})

			require.Equal(t, 2, logs.FilterMessage("Skipping manifest update signal, worker is busy").Len())

			// Let the first callback finish
			proceed <- struct{}{}

			// Second callback starts (the one pending signal)
			<-processing
			proceed <- struct{}{}

			synctest.Wait()

			// Exactly 2 callbacks: the first + the one that was buffered. The rest were dropped.
			require.Equal(t, int32(2), totalCalls.Load())
		})
	})

	t.Run("manifest is updated even when signal is dropped", func(t *testing.T) {
		synctest.Test(t, func(t *testing.T) {
			store := NewStore(t.Context(), zap.NewNop())

			block := make(chan struct{})
			store.SetOnUpdate(func() {
				<-block
			})

			// First load — worker picks it up and blocks
			store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"a": "q1"}})
			synctest.Wait()

			// Second load — queued in channel
			store.Load(&Manifest{Version: 1, Revision: "rev-2", Operations: map[string]string{"b": "q2"}})

			// Third load — signal dropped, but manifest IS updated atomically
			store.Load(&Manifest{Version: 1, Revision: "rev-3", Operations: map[string]string{"c": "q3"}})

			// Even though the signal was dropped, the manifest pointer should reflect the latest load
			require.Equal(t, "rev-3", store.Revision())
			body, found := store.LookupByHash("c")
			require.True(t, found)
			require.Equal(t, "q3", string(body))

			// Old operations should be gone
			_, found = store.LookupByHash("a")
			require.False(t, found)

			close(block)
		})
	})

	t.Run("SetOnUpdate can be called multiple times without leaking goroutines", func(t *testing.T) {
		synctest.Test(t, func(t *testing.T) {
			store := NewStore(t.Context(), zap.NewNop())

			var firstCalls atomic.Int32
			var secondCalls atomic.Int32

			// Register first callback
			store.SetOnUpdate(func() {
				firstCalls.Add(1)
			})

			store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"a": "q"}})
			synctest.Wait()
			require.Equal(t, int32(1), firstCalls.Load())

			// Replace with second callback
			store.SetOnUpdate(func() {
				secondCalls.Add(1)
			})

			// New loads should only trigger the second callback
			store.Load(&Manifest{Version: 1, Revision: "rev-2", Operations: map[string]string{"a": "q"}})
			synctest.Wait()
			require.Equal(t, int32(1), secondCalls.Load())
			require.Equal(t, int32(1), firstCalls.Load())
		})
	})

	t.Run("Load does not panic and the worker exits after the context is canceled", func(t *testing.T) {
		ignore := goleak.IgnoreCurrent()
		ctx, cancel := context.WithCancel(t.Context())
		store := NewStore(ctx, zap.NewNop())

		var calls atomic.Int32
		store.SetOnUpdate(func() {
			calls.Add(1)
		})
		cancel()

		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"a": "q"}})
		require.Equal(t, "rev-1", store.Revision())
		goleak.VerifyNone(t, ignore)
		require.Equal(t, int32(0), calls.Load())
	})
}
