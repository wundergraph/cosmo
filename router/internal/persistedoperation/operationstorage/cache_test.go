package operationstorage

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// TestOperationsCacheKeyIncludesClientName verifies that cached operation
// bodies are scoped to the client that requested them, so clients using the
// same operation ID never share a cache entry.
func TestOperationsCacheKeyIncludesClientName(t *testing.T) {
	t.Parallel()

	type keyInput struct {
		clientName    string
		operationHash string
	}

	tests := []struct {
		name  string
		a, b  keyInput
		equal bool
	}{
		{
			name:  "same client and operation hash share a key",
			a:     keyInput{clientName: "web", operationHash: "shared"},
			b:     keyInput{clientName: "web", operationHash: "shared"},
			equal: true,
		},
		{
			name: "different clients with the same operation hash get different keys",
			a:    keyInput{clientName: "web", operationHash: "shared"},
			b:    keyInput{clientName: "mobile", operationHash: "shared"},
		},
		{
			// The client name is length-prefixed, so bytes cannot move between
			// the client name and the operation hash to produce the same key.
			name: "client name cannot absorb the start of the operation hash",
			a:    keyInput{clientName: "a", operationHash: "bc"},
			b:    keyInput{clientName: "ab", operationHash: "c"},
		},
	}

	cache := &OperationsCache{}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			a := cache.key(tt.a.clientName, tt.a.operationHash)
			b := cache.key(tt.b.clientName, tt.b.operationHash)
			if tt.equal {
				require.Equal(t, a, b)
			} else {
				require.NotEqual(t, a, b)
			}
		})
	}
}
