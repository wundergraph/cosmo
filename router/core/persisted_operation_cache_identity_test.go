package core

import (
	"testing"

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
