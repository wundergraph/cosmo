package core

import (
	"context"
	"testing"

	"github.com/dgraph-io/ristretto/v2"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/pqlmanifest"
	"go.uber.org/zap"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPersistedOperationCacheIdentity(t *testing.T) {
	t.Parallel()

	type identity struct{ id, client, operationName string }
	cases := []struct {
		name          string
		first, second identity
	}{
		{"ID and client boundary", identity{"a", "bc", ""}, identity{"ab", "c", ""}},
		{"ID and operation name boundary", identity{"id", "web", "a"}, identity{"ida", "web", ""}},
		{"same ID across clients", identity{"shared", "web", ""}, identity{"shared", "mobile", ""}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			processor := NewOperationProcessor(OperationProcessorOptions{Executor: &Executor{}, ParseKitPoolSize: 1})
			kit, err := processor.NewKit()
			require.NoError(t, err)
			defer kit.Free()
			key := func(value identity) uint64 {
				kit.parsedOperation.GraphQLRequestExtensions.PersistedQuery = &GraphQLRequestExtensionsPersistedQuery{Sha256Hash: value.id}
				kit.parsedOperation.Request.OperationName = value.operationName
				return kit.generatePersistedOperationCacheKey(value.client, nil, value.operationName != "")
			}
			assert.NotEqual(t, key(tc.first), key(tc.second))
		})
	}
}

func TestManifestPersistedOperationCacheReuse(t *testing.T) {
	t.Parallel()

	store := pqlmanifest.NewStore(zap.NewNop())
	defer store.Close()
	client, err := persistedoperation.NewClient(&persistedoperation.Options{PQLStore: store})
	require.NoError(t, err)
	defer client.Close()
	cache, err := ristretto.NewCache(&ristretto.Config[uint64, NormalizationCacheEntry]{
		NumCounters:        100,
		MaxCost:            10,
		BufferItems:        64,
		IgnoreInternalCost: true,
	})
	require.NoError(t, err)
	defer cache.Close()
	processor := NewOperationProcessor(OperationProcessorOptions{
		Executor:                         &Executor{},
		AllowCustomPersistedOperationIDs: true,
		PersistedOperationClient:         client,
		EnablePersistedOperationsCache:   true,
		PersistedOpsNormalizationCache:   cache,
	})
	kit, err := processor.NewKit()
	require.NoError(t, err)
	defer kit.Free()

	const query = `query { __typename }`
	store.Load(&pqlmanifest.Manifest{Revision: "one", Operations: map[string]string{"get_typename_v1": query}})
	kit.manifestSnapshot = store.Snapshot()
	kit.parsedOperation.GraphQLRequestExtensions.PersistedQuery = &GraphQLRequestExtensionsPersistedQuery{Sha256Hash: "get_typename_v1"}
	kit.parsedOperation.Request.Query = query
	kit.parsedOperation.NormalizedRepresentation = query
	kit.savePersistedOperationToCache("web", false, nil)
	cache.Wait()

	// Saving another operation after a reload must retain the unchanged entry
	// and its variable metadata, without warmup repopulating the original entry.
	store.Load(&pqlmanifest.Manifest{Revision: "two", Operations: map[string]string{
		"get_typename_v1":   query,
		"another_operation": query,
	}})
	kit.manifestSnapshot = store.Snapshot()
	kit.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash = "another_operation"
	kit.savePersistedOperationToCache("web", false, nil)
	cache.Wait()
	kit.parsedOperation = &ParsedOperation{GraphQLRequestExtensions: GraphQLRequestExtensions{
		PersistedQuery: &GraphQLRequestExtensionsPersistedQuery{Sha256Hash: "get_typename_v1"},
	}}
	hit, _, err := kit.FetchPersistedOperation(context.Background(), &ClientInfo{Name: "mobile"})
	require.NoError(t, err)
	assert.True(t, hit, "unchanged manifest entries remain cached across clients and revisions")
	assert.Equal(t, query, kit.parsedOperation.Request.Query)

	store.Load(&pqlmanifest.Manifest{Revision: "three", Operations: map[string]string{
		"get_typename_v1": `query { changed: __typename }`,
	}})
	hit, _, err = kit.FetchPersistedOperation(context.Background(), &ClientInfo{Name: "web"})
	require.NoError(t, err)
	assert.False(t, hit, "a changed body cannot reuse the old entry")
	assert.Equal(t, `query { changed: __typename }`, kit.parsedOperation.Request.Query)

	store.Load(&pqlmanifest.Manifest{Revision: "four", Operations: map[string]string{}})
	_, _, err = kit.FetchPersistedOperation(context.Background(), &ClientInfo{Name: "web"})
	assert.ErrorAs(t, err, new(*persistedoperation.PersistentOperationNotFoundError))
}
