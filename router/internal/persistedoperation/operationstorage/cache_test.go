package operationstorage

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestOperationsCacheKeyVariableLengthComponents verifies that cache keys stay
// unambiguous when client names and operation IDs vary in length. Custom
// operation IDs are 1-250 characters, so the key length-prefixes the client
// name instead of relying on a fixed-size ID.
func TestOperationsCacheKeyVariableLengthComponents(t *testing.T) {
	t.Parallel()

	type keyInput struct {
		clientName  string
		operationID string
	}

	tests := []struct {
		name  string
		a, b  keyInput
		equal bool
	}{
		{
			// Guards against a key that differs for every input.
			name:  "identical inputs share a key",
			a:     keyInput{clientName: "web", operationID: "get_employee"},
			b:     keyInput{clientName: "web", operationID: "get_employee"},
			equal: true,
		},
		{
			name: "bytes shifted from the operation ID into the client name",
			a:    keyInput{clientName: "a", operationID: "bc"},
			b:    keyInput{clientName: "ab", operationID: "c"},
		},
		{
			name: "empty client name",
			a:    keyInput{clientName: "", operationID: "abc"},
			b:    keyInput{clientName: "a", operationID: "bc"},
		},
		{
			// Both concatenate to "1:ab"; only the length prefix tells them apart.
			name: "client name containing a length prefix",
			a:    keyInput{clientName: "1:a", operationID: "b"},
			b:    keyInput{clientName: "1:", operationID: "ab"},
		},
	}

	cache := &OperationsCache{}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			a := cache.key(tt.a.clientName, tt.a.operationID)
			b := cache.key(tt.b.clientName, tt.b.operationID)
			if tt.equal {
				assert.Equal(t, a, b)
			} else {
				assert.NotEqual(t, a, b)
			}
		})
	}
}
