package pqlmanifest

import (
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

func TestStore(t *testing.T) {
	t.Run("Load and LookupByHash", func(t *testing.T) {
		store := NewStore(zap.NewNop())

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
		store := NewStore(zap.NewNop())

		body, found := store.LookupByHash("abc")
		require.False(t, found)
		require.Nil(t, body)
	})

	t.Run("LookupByHash returns false for unknown hash", func(t *testing.T) {
		store := NewStore(zap.NewNop())
		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"abc": "query { a }"}})

		body, found := store.LookupByHash("unknown")
		require.False(t, found)
		require.Nil(t, body)
	})

	t.Run("Revision changes on Load", func(t *testing.T) {
		store := NewStore(zap.NewNop())

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
		store := NewStore(zap.NewNop())
		require.Equal(t, "", store.Revision())
	})

	t.Run("IsLoaded", func(t *testing.T) {
		store := NewStore(zap.NewNop())
		require.False(t, store.IsLoaded())

		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"a": "q"}})
		require.True(t, store.IsLoaded())
	})

	t.Run("OperationCount", func(t *testing.T) {
		store := NewStore(zap.NewNop())
		require.Equal(t, 0, store.OperationCount())

		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{
			"a": "q1",
			"b": "q2",
			"c": "q3",
		}})
		require.Equal(t, 3, store.OperationCount())
	})

	t.Run("AllOperations returns nil when not loaded", func(t *testing.T) {
		store := NewStore(zap.NewNop())
		require.Nil(t, store.AllOperations())
	})

	t.Run("AllOperations returns all operations", func(t *testing.T) {
		store := NewStore(zap.NewNop())
		ops := map[string]string{
			"hash1": "query { a }",
			"hash2": "query { b }",
			"hash3": "mutation { c }",
		}
		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: ops})

		result := store.AllOperations()
		require.Equal(t, ops, result)
	})

	t.Run("AddListener callback is invoked on Load", func(t *testing.T) {
		store := NewStore(zap.NewNop())
		done := make(chan struct{})
		defer close(done)

		var called atomic.Bool
		store.AddListener(done, func() {
			called.Store(true)
		})

		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"a": "query { a }"}})

		require.Eventually(t, func() bool {
			return called.Load()
		}, time.Second, 10*time.Millisecond)
	})

	t.Run("no listeners does not panic", func(t *testing.T) {
		store := NewStore(zap.NewNop())
		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"a": "query { a }"}})
	})

	t.Run("each listener runs its callback sequentially", func(t *testing.T) {
		store := NewStore(zap.NewNop())
		done := make(chan struct{})
		defer close(done)

		var concurrent atomic.Int32
		var maxConcurrent atomic.Int32
		var totalCalls atomic.Int32

		store.AddListener(done, func() {
			c := concurrent.Add(1)
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

		for i := 0; i < 5; i++ {
			store.Load(&Manifest{
				Version:    1,
				Revision:   fmt.Sprintf("rev-%d", i),
				Operations: map[string]string{"a": "q"},
			})
		}

		require.Eventually(t, func() bool {
			return totalCalls.Load() >= 1
		}, 2*time.Second, 10*time.Millisecond)

		time.Sleep(50 * time.Millisecond)
		require.Equal(t, int32(1), maxConcurrent.Load(), "callbacks must run sequentially, never concurrently")
	})

	t.Run("rapid loads coalesce signals when listener is busy", func(t *testing.T) {
		core, logs := observer.New(zap.DebugLevel)
		store := NewStore(zap.New(core))
		done := make(chan struct{})
		defer close(done)

		processing := make(chan struct{})
		proceed := make(chan struct{})
		var totalCalls atomic.Int32

		store.AddListener(done, func() {
			totalCalls.Add(1)
			processing <- struct{}{}
			<-proceed
		})

		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"a": "q"}})
		<-processing

		store.Load(&Manifest{Version: 1, Revision: "rev-2", Operations: map[string]string{"a": "q"}})
		store.Load(&Manifest{Version: 1, Revision: "rev-3", Operations: map[string]string{"a": "q"}})
		store.Load(&Manifest{Version: 1, Revision: "rev-4", Operations: map[string]string{"a": "q"}})

		dropCount := logs.FilterMessage("Skipping PQL manifest update signal, worker is busy").Len()
		require.GreaterOrEqual(t, dropCount, 2, "at least 2 signals should have been dropped")

		proceed <- struct{}{}
		<-processing
		proceed <- struct{}{}

		time.Sleep(50 * time.Millisecond)
		require.Equal(t, int32(2), totalCalls.Load())
	})

	t.Run("manifest is updated even when signal is dropped", func(t *testing.T) {
		store := NewStore(zap.NewNop())
		done := make(chan struct{})

		block := make(chan struct{})
		store.AddListener(done, func() {
			<-block
		})

		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"a": "q1"}})
		time.Sleep(20 * time.Millisecond)

		store.Load(&Manifest{Version: 1, Revision: "rev-2", Operations: map[string]string{"b": "q2"}})
		store.Load(&Manifest{Version: 1, Revision: "rev-3", Operations: map[string]string{"c": "q3"}})

		require.Equal(t, "rev-3", store.Revision())
		body, found := store.LookupByHash("c")
		require.True(t, found)
		require.Equal(t, "q3", string(body))

		_, found = store.LookupByHash("a")
		require.False(t, found)

		close(block)
		close(done)
	})

	t.Run("multiple listeners fire independently", func(t *testing.T) {
		store := NewStore(zap.NewNop())
		done := make(chan struct{})
		defer close(done)

		var calls1 atomic.Int32
		var calls2 atomic.Int32

		store.AddListener(done, func() { calls1.Add(1) })
		store.AddListener(done, func() { calls2.Add(1) })

		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"a": "q"}})

		require.Eventually(t, func() bool {
			return calls1.Load() >= 1 && calls2.Load() >= 1
		}, time.Second, 10*time.Millisecond)
	})

	t.Run("closing done channel stops listener", func(t *testing.T) {
		store := NewStore(zap.NewNop())
		done := make(chan struct{})

		var calls atomic.Int32
		store.AddListener(done, func() {
			calls.Add(1)
		})

		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"a": "q"}})
		require.Eventually(t, func() bool {
			return calls.Load() >= 1
		}, time.Second, 10*time.Millisecond)

		countBefore := calls.Load()
		close(done)

		// Allow goroutine to exit
		time.Sleep(50 * time.Millisecond)

		store.Load(&Manifest{Version: 1, Revision: "rev-2", Operations: map[string]string{"a": "q"}})
		time.Sleep(50 * time.Millisecond)
		require.Equal(t, countBefore, calls.Load(), "listener should not fire after done is closed")
	})

	t.Run("closing done does not affect other listeners", func(t *testing.T) {
		store := NewStore(zap.NewNop())
		done1 := make(chan struct{})
		done2 := make(chan struct{})
		defer close(done2)

		var calls1 atomic.Int32
		var calls2 atomic.Int32

		store.AddListener(done1, func() { calls1.Add(1) })
		store.AddListener(done2, func() { calls2.Add(1) })

		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"a": "q"}})
		require.Eventually(t, func() bool {
			return calls1.Load() >= 1 && calls2.Load() >= 1
		}, time.Second, 10*time.Millisecond)

		// Stop first listener only
		close(done1)
		time.Sleep(50 * time.Millisecond)

		calls1Before := calls1.Load()
		calls2Before := calls2.Load()

		store.Load(&Manifest{Version: 1, Revision: "rev-2", Operations: map[string]string{"a": "q"}})
		require.Eventually(t, func() bool {
			return calls2.Load() > calls2Before
		}, time.Second, 10*time.Millisecond)

		time.Sleep(50 * time.Millisecond)
		require.Equal(t, calls1Before, calls1.Load(), "stopped listener should not fire")
	})

	t.Run("done channel prevents work after signal received", func(t *testing.T) {
		store := NewStore(zap.NewNop())
		done := make(chan struct{})

		var calls atomic.Int32
		store.AddListener(done, func() {
			calls.Add(1)
		})

		// Close done before any Load — listener should never fire
		close(done)
		time.Sleep(50 * time.Millisecond)

		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"a": "q"}})
		time.Sleep(50 * time.Millisecond)
		require.Equal(t, int32(0), calls.Load(), "listener should not fire when done is already closed")
	})
}

func TestParseManifest(t *testing.T) {
	t.Run("valid manifest", func(t *testing.T) {
		data := []byte(`{"version":1,"revision":"rev-1","generatedAt":"2024-01-01","operations":{"h1":"query { a }"}}`)
		m, err := ParseManifest(data)
		require.NoError(t, err)
		require.Equal(t, 1, m.Version)
		require.Equal(t, "rev-1", m.Revision)
		require.Equal(t, "2024-01-01", m.GeneratedAt)
		require.Equal(t, "query { a }", m.Operations["h1"])
	})

	t.Run("invalid JSON", func(t *testing.T) {
		_, err := ParseManifest([]byte(`{bad`))
		require.ErrorContains(t, err, "failed to parse manifest")
	})

	t.Run("unsupported version", func(t *testing.T) {
		_, err := ParseManifest([]byte(`{"version":2,"revision":"r","operations":{}}`))
		require.ErrorContains(t, err, "unsupported manifest version 2")
	})

	t.Run("missing revision", func(t *testing.T) {
		_, err := ParseManifest([]byte(`{"version":1,"revision":"","operations":{}}`))
		require.ErrorContains(t, err, "revision is required")
	})

	t.Run("nil operations", func(t *testing.T) {
		_, err := ParseManifest([]byte(`{"version":1,"revision":"r"}`))
		require.ErrorContains(t, err, "operations field is required")
	})
}

func TestLoadFromData(t *testing.T) {
	t.Run("valid data loads into store", func(t *testing.T) {
		store := NewStore(zap.NewNop())
		data := []byte(`{"version":1,"revision":"rev-1","operations":{"h1":"query { a }"}}`)
		err := store.LoadFromData(data)
		require.NoError(t, err)
		require.True(t, store.IsLoaded())
		require.Equal(t, "rev-1", store.Revision())
		body, found := store.LookupByHash("h1")
		require.True(t, found)
		require.Equal(t, "query { a }", string(body))
	})

	t.Run("invalid data returns error", func(t *testing.T) {
		store := NewStore(zap.NewNop())
		err := store.LoadFromData([]byte(`{bad`))
		require.Error(t, err)
		require.False(t, store.IsLoaded())
	})
}

func TestLoadFromFile(t *testing.T) {
	t.Run("valid file", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "manifest.json")
		err := os.WriteFile(path, []byte(`{"version":1,"revision":"file-rev","operations":{"fh":"query { f }"}}`), 0644)
		require.NoError(t, err)

		store := NewStore(zap.NewNop())
		err = store.LoadFromFile(path)
		require.NoError(t, err)
		require.Equal(t, "file-rev", store.Revision())
	})

	t.Run("missing file", func(t *testing.T) {
		store := NewStore(zap.NewNop())
		err := store.LoadFromFile("/nonexistent/path/manifest.json")
		require.ErrorContains(t, err, "failed to read manifest file")
	})
}
