package core

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/pqlmanifest"
	"go.uber.org/zap"
)

func TestManifestWarmupSource(t *testing.T) {
	t.Parallel()

	t.Run("returns nil when store has no manifest", func(t *testing.T) {
		t.Parallel()
		store := pqlmanifest.NewStore(zap.NewNop())
		source := NewManifestWarmupSource(store)

		items, err := source.LoadItems(context.Background(), zap.NewNop())
		require.NoError(t, err)
		require.Nil(t, items)
	})

	t.Run("returns nil when manifest has no operations", func(t *testing.T) {
		t.Parallel()
		store := pqlmanifest.NewStore(zap.NewNop())
		store.Load(&pqlmanifest.Manifest{
			Version:    1,
			Revision:   "rev-1",
			Operations: map[string]string{},
		})
		source := NewManifestWarmupSource(store)

		items, err := source.LoadItems(context.Background(), zap.NewNop())
		require.NoError(t, err)
		require.Nil(t, items)
	})

	t.Run("returns all operations with persisted query extensions", func(t *testing.T) {
		t.Parallel()
		store := pqlmanifest.NewStore(zap.NewNop())
		store.Load(&pqlmanifest.Manifest{
			Version:  1,
			Revision: "rev-1",
			Operations: map[string]string{
				"sha256abc": "query Employees { employees { id } }",
				"sha256def": "mutation CreateUser { createUser { id } }",
			},
		})
		source := NewManifestWarmupSource(store)

		items, err := source.LoadItems(context.Background(), zap.NewNop())
		require.NoError(t, err)
		require.Len(t, items, 2)

		// Collect items into a map for deterministic assertions (map iteration is unordered)
		byHash := make(map[string]string)
		for _, item := range items {
			require.NotNil(t, item.Request)
			require.NotNil(t, item.Request.Extensions)
			require.NotNil(t, item.Request.Extensions.PersistedQuery)
			require.Equal(t, int32(1), item.Request.Extensions.PersistedQuery.Version)
			byHash[item.Request.Extensions.PersistedQuery.Sha256Hash] = item.Request.Query
		}

		require.Equal(t, "query Employees { employees { id } }", byHash["sha256abc"])
		require.Equal(t, "mutation CreateUser { createUser { id } }", byHash["sha256def"])
	})

	t.Run("does not include client info", func(t *testing.T) {
		t.Parallel()
		store := pqlmanifest.NewStore(zap.NewNop())
		store.Load(&pqlmanifest.Manifest{
			Version:    1,
			Revision:   "rev-1",
			Operations: map[string]string{"hash1": "query { a }"},
		})
		source := NewManifestWarmupSource(store)

		items, err := source.LoadItems(context.Background(), zap.NewNop())
		require.NoError(t, err)
		require.Len(t, items, 1)
		require.Nil(t, items[0].Client)
	})
}
