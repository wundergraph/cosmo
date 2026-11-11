package operationmanifest

import (
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestFileLoader(t *testing.T) {
	t.Parallel()

	manifestJSON := `{"version":1,"revision":"rev-1","generatedAt":"2026-10-01T00:00:00Z","operations":{"get_employees":"query { employees { id } }"}}`

	t.Run("returns the manifest below the root directory", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		require.NoError(t, os.MkdirAll(filepath.Join(dir, "ops"), 0o755))
		require.NoError(t, os.WriteFile(filepath.Join(dir, "ops", "manifest.json"), []byte(manifestJSON), 0o644))

		data, changed, err := NewFileLoader(dir, "ops/manifest.json").Fetch(t.Context(), "")
		require.NoError(t, err)
		require.True(t, changed)
		require.Equal(t, []byte(manifestJSON), data)
	})

	t.Run("decompresses a gzip manifest", func(t *testing.T) {
		t.Parallel()

		var buf bytes.Buffer
		gw := gzip.NewWriter(&buf)
		_, err := gw.Write([]byte(manifestJSON))
		require.NoError(t, err)
		require.NoError(t, gw.Close())

		dir := t.TempDir()
		require.NoError(t, os.WriteFile(filepath.Join(dir, "manifest.json.gz"), buf.Bytes(), 0o644))

		data, changed, err := NewFileLoader(dir, "manifest.json.gz").Fetch(t.Context(), "")
		require.NoError(t, err)
		require.True(t, changed)
		require.Equal(t, []byte(manifestJSON), data)
	})

	t.Run("returns an error when the manifest file is missing", func(t *testing.T) {
		t.Parallel()

		data, changed, err := NewFileLoader(t.TempDir(), "manifest.json").Fetch(t.Context(), "")
		require.ErrorIs(t, err, os.ErrNotExist)
		require.False(t, changed)
		require.Nil(t, data)
	})
}
