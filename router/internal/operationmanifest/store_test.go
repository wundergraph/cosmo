package operationmanifest

import (
	"testing"

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

	t.Run("Subscribe signals after a later Load", func(t *testing.T) {
		store := NewStore(zap.NewNop())
		updates := store.Subscribe()

		select {
		case <-updates:
			t.Fatal("no signal expected before Load")
		default:
		}

		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"a": "q"}})

		select {
		case <-updates:
		default:
			t.Fatal("expected a signal after Load")
		}
	})

	t.Run("Subscribe does not replay loads from before the subscription", func(t *testing.T) {
		core, logs := observer.New(zap.DebugLevel)
		store := NewStore(zap.New(core))

		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"a": "q"}})
		updates := store.Subscribe()

		select {
		case <-updates:
			t.Fatal("no signal expected for a load before Subscribe")
		default:
		}
		require.Equal(t, 0, logs.Len())
	})

	t.Run("Subscribe coalesces loads while a signal is pending", func(t *testing.T) {
		core, logs := observer.New(zap.DebugLevel)
		store := NewStore(zap.New(core))
		updates := store.Subscribe()

		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"a": "q"}})
		store.Load(&Manifest{Version: 1, Revision: "rev-2", Operations: map[string]string{"b": "q"}})
		store.Load(&Manifest{Version: 1, Revision: "rev-3", Operations: map[string]string{"c": "q"}})

		require.Equal(t, 2, logs.FilterMessage("Skipping manifest update signal, previous signal still pending").Len())

		// Exactly one signal is pending, and the receiver sees the latest manifest.
		<-updates
		require.Equal(t, "rev-3", store.Revision())
		body, found := store.LookupByHash("c")
		require.True(t, found)
		require.Equal(t, "q", string(body))
		_, found = store.LookupByHash("a")
		require.False(t, found)

		select {
		case <-updates:
			t.Fatal("coalesced loads must not queue a second signal")
		default:
		}
	})

	t.Run("Subscribe replaces the previous subscriber", func(t *testing.T) {
		store := NewStore(zap.NewNop())
		first := store.Subscribe()
		second := store.Subscribe()

		store.Load(&Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{"a": "q"}})

		select {
		case <-first:
			t.Fatal("replaced subscriber must not receive signals")
		default:
		}
		select {
		case <-second:
		default:
			t.Fatal("expected a signal on the current subscriber")
		}
	})
}
