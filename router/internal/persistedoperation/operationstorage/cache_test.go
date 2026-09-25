package operationstorage

import (
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestVariableLengthOperationIDs(t *testing.T) {
	t.Parallel()

	cache, err := NewOperationsCache(1024 * 1024)
	require.NoError(t, err)
	defer cache.Cache.Close()
	cache.Set("abc", "def", []byte("first"), 0)
	cache.Set("abcd", "ef", []byte("second"), 0)
	cache.Cache.Wait()
	assert.Equal(t, []byte("first"), cache.Get("abc", "def"))
	assert.Equal(t, []byte("second"), cache.Get("abcd", "ef"))
}
