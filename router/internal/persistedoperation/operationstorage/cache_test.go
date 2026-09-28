package operationstorage

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCacheKeyBoundaries(t *testing.T) {
	t.Parallel()

	cache := &OperationsCache{}
	require.NotEqual(t, cache.key("a", "bc"), cache.key("ab", "c"))
	require.NotEqual(t, cache.key("web", "shared"), cache.key("mobile", "shared"))
}
