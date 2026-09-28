package persistedoperation

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/pqlmanifest"
	"go.uber.org/zap"
)

func TestManifestSnapshotOverridesStorageCache(t *testing.T) {
	t.Parallel()

	store := pqlmanifest.NewStore(zap.NewNop())
	t.Cleanup(store.Close)
	client, err := NewClient(&Options{PQLStore: store, CacheSize: 1024 * 1024})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, client.Close()) })

	// A provider response cached before the first manifest must not mask it.
	client.cache.Set("web", "operation", []byte("provider body"), 0)
	client.cache.Cache.Wait()
	beforeLoad := client.ManifestSnapshot()
	require.Nil(t, beforeLoad)
	store.Load(&pqlmanifest.Manifest{
		Version:    1,
		Revision:   "one",
		Operations: map[string]string{"operation": "manifest body"},
	})
	snapshot := client.ManifestSnapshot()
	body, _, err := client.PersistedOperation(t.Context(), "web", "operation")
	require.NoError(t, err)
	require.Equal(t, "manifest body", string(body))

	store.Load(&pqlmanifest.Manifest{Version: 1, Revision: "two", Operations: map[string]string{}})
	_, _, err = client.PersistedOperation(t.Context(), "web", "operation")
	var notFound *PersistentOperationNotFoundError
	require.ErrorAs(t, err, &notFound)

	// In-flight requests continue using their captured snapshot, including nil.
	body, _, err = client.PersistedOperationWithManifest(t.Context(), "web", "operation", snapshot)
	require.NoError(t, err)
	require.Equal(t, "manifest body", string(body))
	body, _, err = client.PersistedOperationWithManifest(t.Context(), "web", "operation", beforeLoad)
	require.NoError(t, err)
	require.Equal(t, "provider body", string(body))
}
