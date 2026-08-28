package apq

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestNewMemoryStore(t *testing.T) {
	t.Run("returns error when cache size is zero", func(t *testing.T) {
		store, err := NewMemoryStore(0, time.Minute)

		require.Error(t, err)
		require.Nil(t, store)
	})

	t.Run("returns a backed store when cache size is positive", func(t *testing.T) {
		store, err := NewMemoryStore(1024*1024, time.Minute)
		require.NoError(t, err)
		t.Cleanup(store.Close)

		require.NotNil(t, store.cache.Cache)
	})
}
