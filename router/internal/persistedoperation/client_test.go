package persistedoperation

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/operationmanifest"
	"go.uber.org/zap"
)

func TestManifestSnapshotOverridesStorageCache(t *testing.T) {
	t.Parallel()

	store := operationmanifest.NewStore(zap.NewNop())
	t.Cleanup(store.Close)
	client, err := NewClient(&Options{PQLStore: store, CacheSize: 1024 * 1024})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, client.Close()) })

	// A provider response cached before the first manifest must not mask it.
	client.cache.Set("web", "operation", []byte("provider body"), 0)
	client.cache.Cache.Wait()
	beforeLoad := client.ManifestSnapshot()
	require.Nil(t, beforeLoad)
	store.Load(&operationmanifest.Manifest{
		Version:    1,
		Revision:   "one",
		Operations: map[string]string{"operation": "manifest body"},
	})
	snapshot := client.ManifestSnapshot()
	body, _, err := client.PersistedOperation(t.Context(), "web", "operation")
	assert.NoError(t, err)
	assert.Equal(t, "manifest body", string(body))

	store.Load(&operationmanifest.Manifest{Version: 1, Revision: "two", Operations: map[string]string{}})
	_, _, err = client.PersistedOperation(t.Context(), "web", "operation")
	var notFound *PersistentOperationNotFoundError
	assert.ErrorAs(t, err, &notFound)

	// In-flight requests continue using their captured snapshot, including nil.
	body, _, err = client.PersistedOperationWithManifest(t.Context(), "web", "operation", snapshot)
	assert.NoError(t, err)
	assert.Equal(t, "manifest body", string(body))
	body, _, err = client.PersistedOperationWithManifest(t.Context(), "web", "operation", beforeLoad)
	assert.NoError(t, err)
	assert.Equal(t, "provider body", string(body))
}

type staticStorageClient struct {
	body  []byte
	calls int
}

func (s *staticStorageClient) PersistedOperation(context.Context, string, string) ([]byte, error) {
	s.calls++
	return s.body, nil
}

func (s *staticStorageClient) Close() {}

func TestStorageOperationsWithMismatchedSHA256IDs(t *testing.T) {
	t.Parallel()

	const body = `query Employees { employees { id } }`
	sum := sha256.Sum256([]byte(body))

	newClient := func(t *testing.T) (*Client, *staticStorageClient) {
		t.Helper()
		provider := &staticStorageClient{body: []byte(body)}
		client, err := NewClient(&Options{ProviderClient: provider, CacheSize: 1024 * 1024})
		require.NoError(t, err)
		t.Cleanup(func() { require.NoError(t, client.Close()) })
		return client, provider
	}

	for name, id := range map[string]string{"SHA256 of the body": hex.EncodeToString(sum[:]), "custom ID": "get_employees"} {
		t.Run(name+" is served", func(t *testing.T) {
			t.Parallel()
			client, _ := newClient(t)

			content, _, err := client.PersistedOperation(t.Context(), "web", id)
			assert.NoError(t, err)
			assert.Equal(t, body, string(content))
		})
	}

	t.Run("other SHA256 returns an error", func(t *testing.T) {
		t.Parallel()
		client, provider := newClient(t)
		mismatchedID := strings.Repeat("a", 64)

		content, _, err := client.PersistedOperation(t.Context(), "web", mismatchedID)
		var mismatch *OperationIDMismatchError
		if assert.ErrorAs(t, err, &mismatch) {
			assert.Equal(t, mismatchedID, mismatch.Sha256Hash)
		}
		assert.Nil(t, content)

		// The invalid operation isn't cached, so the next lookup asks the provider again.
		client.cache.Cache.Wait()
		_, _, _ = client.PersistedOperation(t.Context(), "web", mismatchedID)
		assert.Equal(t, 2, provider.calls)
	})
}

func TestManifestOperationsWithMismatchedSHA256IDs(t *testing.T) {
	t.Parallel()

	const body = `query Employees { employees { id } }`
	sum := sha256.Sum256([]byte(body))
	hashID := hex.EncodeToString(sum[:])
	mismatchedID := strings.Repeat("a", 64)

	store := operationmanifest.NewStore(zap.NewNop())
	t.Cleanup(store.Close)
	client, err := NewClient(&Options{PQLStore: store})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	store.Load(&operationmanifest.Manifest{Version: 1, Revision: "rev-1", Operations: map[string]string{
		hashID:                  body,
		"get_employees":         body,
		strings.ToUpper(hashID): body, // Not lowercase hex, so it's a custom ID.
		mismatchedID:            body,
	}})

	for _, id := range []string{hashID, "get_employees", strings.ToUpper(hashID)} {
		content, _, err := client.PersistedOperation(t.Context(), "web", id)
		assert.NoError(t, err)
		assert.Equal(t, body, string(content))
	}

	content, _, err := client.PersistedOperation(t.Context(), "web", mismatchedID)
	var mismatch *OperationIDMismatchError
	if assert.ErrorAs(t, err, &mismatch) {
		assert.Equal(t, mismatchedID, mismatch.Sha256Hash)
	}
	assert.Nil(t, content)
}
