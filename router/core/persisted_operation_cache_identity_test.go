package core

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPersistedOperationCacheIdentity(t *testing.T) {
	type identity struct{ id, client, operationName string }
	for _, tc := range []struct {
		name          string
		first, second identity
	}{
		{"ID and client boundary", identity{"a", "bc", ""}, identity{"ab", "c", ""}},
		{"ID and operation name boundary", identity{"id", "web", "a"}, identity{"ida", "web", ""}},
		{"same ID across clients", identity{"shared", "web", ""}, identity{"shared", "mobile", ""}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			processor := NewOperationProcessor(OperationProcessorOptions{Executor: &Executor{}, ParseKitPoolSize: 1})
			kit, err := processor.NewKit()
			require.NoError(t, err)
			defer kit.Free()
			key := func(value identity) uint64 {
				kit.parsedOperation.GraphQLRequestExtensions.PersistedQuery = &GraphQLRequestExtensionsPersistedQuery{Sha256Hash: value.id}
				kit.parsedOperation.Request.OperationName = value.operationName
				return kit.generatePersistedOperationCacheKey(value.client, nil, value.operationName != "")
			}
			require.NotEqual(t, key(tc.first), key(tc.second))
		})
	}
}
