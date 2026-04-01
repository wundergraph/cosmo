package pqlmanifest

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestStorageFetcher(t *testing.T) {
	t.Parallel()

	t.Run("first fetch with empty revision returns manifest", func(t *testing.T) {
		t.Parallel()

		manifest := &Manifest{
			Version:    1,
			Revision:   "rev-1",
			Operations: map[string]string{"h1": "query { a }"},
		}
		fetcher := NewStorageFetcher(
			func(_ context.Context, _ string) (*Manifest, error) {
				return manifest, nil
			},
			"ops/manifest.json",
			zap.NewNop(),
		)

		result, changed, err := fetcher.Fetch(context.Background(), "")
		require.NoError(t, err)
		require.True(t, changed)
		require.Equal(t, manifest, result)
	})

	t.Run("same revision returns no change", func(t *testing.T) {
		t.Parallel()

		fetcher := NewStorageFetcher(
			func(_ context.Context, _ string) (*Manifest, error) {
				return &Manifest{
					Version:    1,
					Revision:   "rev-1",
					Operations: map[string]string{"h1": "query { a }"},
				}, nil
			},
			"ops/manifest.json",
			zap.NewNop(),
		)

		result, changed, err := fetcher.Fetch(context.Background(), "rev-1")
		require.NoError(t, err)
		require.False(t, changed)
		require.Nil(t, result)
	})

	t.Run("different revision returns updated manifest", func(t *testing.T) {
		t.Parallel()

		manifest := &Manifest{
			Version:    1,
			Revision:   "rev-2",
			Operations: map[string]string{"h1": "query { a }", "h2": "query { b }"},
		}
		fetcher := NewStorageFetcher(
			func(_ context.Context, _ string) (*Manifest, error) {
				return manifest, nil
			},
			"ops/manifest.json",
			zap.NewNop(),
		)

		result, changed, err := fetcher.Fetch(context.Background(), "rev-1")
		require.NoError(t, err)
		require.True(t, changed)
		require.Equal(t, manifest, result)
	})

	t.Run("read error is propagated", func(t *testing.T) {
		t.Parallel()

		fetcher := NewStorageFetcher(
			func(_ context.Context, _ string) (*Manifest, error) {
				return nil, fmt.Errorf("s3 connection refused")
			},
			"ops/manifest.json",
			zap.NewNop(),
		)

		result, changed, err := fetcher.Fetch(context.Background(), "rev-1")
		require.Error(t, err)
		require.Contains(t, err.Error(), "s3 connection refused")
		require.False(t, changed)
		require.Nil(t, result)
	})

	t.Run("passes correct object path", func(t *testing.T) {
		t.Parallel()

		var receivedPath string
		fetcher := NewStorageFetcher(
			func(_ context.Context, objectPath string) (*Manifest, error) {
				receivedPath = objectPath
				return &Manifest{
					Version:    1,
					Revision:   "rev-1",
					Operations: map[string]string{},
				}, nil
			},
			"my-prefix/operations/manifest.json",
			zap.NewNop(),
		)

		_, _, err := fetcher.Fetch(context.Background(), "")
		require.NoError(t, err)
		require.Equal(t, "my-prefix/operations/manifest.json", receivedPath)
	})
}
