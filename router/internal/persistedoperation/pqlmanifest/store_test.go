package pqlmanifest

import (
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
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
}
