package cacheevents

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestFieldPathColumn(t *testing.T) {
	t.Parallel()

	t.Run("nil normalizes to empty slice", func(t *testing.T) {
		got := fieldPathColumn(nil)
		require.NotNil(t, got, "ClickHouse Array column requires non-nil empty slice")
		require.Empty(t, got)
	})

	t.Run("empty slice stays empty", func(t *testing.T) {
		got := fieldPathColumn([]string{})
		require.NotNil(t, got)
		require.Empty(t, got)
	})

	t.Run("non-empty slice passes through unchanged", func(t *testing.T) {
		in := []string{"user", "address", "city"}
		require.Equal(t, in, fieldPathColumn(in))
	})

	t.Run("single-element slice passes through", func(t *testing.T) {
		require.Equal(t, []string{"name"}, fieldPathColumn([]string{"name"}))
	})
}
