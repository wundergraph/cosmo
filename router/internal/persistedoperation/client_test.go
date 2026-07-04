package persistedoperation

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

type fakeStorageClient struct {
	operations map[string][]byte
	calls      int
}

func (f *fakeStorageClient) PersistedOperation(_ context.Context, clientName string, sha256Hash string) ([]byte, error) {
	f.calls++
	if data, ok := f.operations[sha256Hash]; ok {
		return data, nil
	}
	return nil, &PersistentOperationNotFoundError{ClientName: clientName, Sha256Hash: sha256Hash}
}

func (f *fakeStorageClient) Close() {}

type fakeApqClient struct {
	operations map[string][]byte
}

func (f *fakeApqClient) Enabled() bool       { return true }
func (f *fakeApqClient) IsDistributed() bool { return false }

func (f *fakeApqClient) PersistedOperation(_ context.Context, _ string, sha256Hash string) ([]byte, error) {
	return f.operations[sha256Hash], nil
}

func (f *fakeApqClient) SaveOperation(_ context.Context, _, sha256Hash string, operationBody []byte) error {
	f.operations[sha256Hash] = operationBody
	return nil
}

func (f *fakeApqClient) Close() {}

func TestPersistedOperationRegisteredSourcesWinOverAPQStore(t *testing.T) {
	t.Parallel()

	const (
		clientName = "my-client"
		sha        = "49a2f7dd56b06f620c7d040dd9d562a1c16eadf7c149be5decdd62cfc92e1b12"
		body       = `mutation updateEmployeeTag { updateEmployeeTag(id: 10, tag: "dd") { id } }`
	)

	newTestClient := func(t *testing.T, provider StorageClient, apqOps map[string][]byte) *Client {
		t.Helper()
		client, err := NewClient(&Options{
			CacheSize:      1024 * 1024,
			ProviderClient: provider,
			ApqClient:      &fakeApqClient{operations: apqOps},
		})
		require.NoError(t, err)
		t.Cleanup(client.Close)
		return client
	}

	// A registered sha that was also seeded into the APQ store (e.g. by a client
	// sending body+hash) must classify as registered, not APQ.
	t.Run("local operations cache wins over APQ store", func(t *testing.T) {
		t.Parallel()
		client := newTestClient(t, &fakeStorageClient{}, map[string][]byte{sha: []byte(body)})
		client.cache.Set(clientName, sha, []byte(body), 0)
		client.cache.Cache.Wait()

		data, isAPQ, err := client.PersistedOperation(context.Background(), clientName, sha)
		require.NoError(t, err)
		require.False(t, isAPQ)
		require.Equal(t, body, string(data))
	})

	t.Run("APQ store resolves when registered sources miss", func(t *testing.T) {
		t.Parallel()
		client := newTestClient(t, &fakeStorageClient{}, map[string][]byte{sha: []byte(body)})

		data, isAPQ, err := client.PersistedOperation(context.Background(), clientName, sha)
		require.NoError(t, err)
		require.True(t, isAPQ)
		require.Equal(t, body, string(data))
	})

	t.Run("provider hit classifies as registered", func(t *testing.T) {
		t.Parallel()
		provider := &fakeStorageClient{operations: map[string][]byte{sha: []byte(body)}}
		client := newTestClient(t, provider, map[string][]byte{})

		data, isAPQ, err := client.PersistedOperation(context.Background(), clientName, sha)
		require.NoError(t, err)
		require.False(t, isAPQ)
		require.Equal(t, body, string(data))
	})

	t.Run("unknown sha with APQ enabled returns no error", func(t *testing.T) {
		t.Parallel()
		client := newTestClient(t, &fakeStorageClient{}, map[string][]byte{})

		data, isAPQ, err := client.PersistedOperation(context.Background(), clientName, sha)
		require.NoError(t, err)
		require.True(t, isAPQ)
		require.Nil(t, data)
	})
}
