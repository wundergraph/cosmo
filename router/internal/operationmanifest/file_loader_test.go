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

		manifest, changed, err := NewFileLoader(dir, "ops/manifest.json").Fetch(t.Context(), "")
		require.NoError(t, err)
		require.True(t, changed)
		require.Equal(t, &Manifest{
			Version:     1,
			Revision:    "rev-1",
			GeneratedAt: "2026-10-01T00:00:00Z",
			Operations:  map[string]string{"get_employees": "query { employees { id } }"},
		}, manifest)
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

		manifest, changed, err := NewFileLoader(dir, "manifest.json.gz").Fetch(t.Context(), "")
		require.NoError(t, err)
		require.True(t, changed)
		require.Equal(t, "rev-1", manifest.Revision)
	})

	t.Run("returns unchanged when the revision matches", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		require.NoError(t, os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(manifestJSON), 0o644))

		manifest, changed, err := NewFileLoader(dir, "manifest.json").Fetch(t.Context(), "rev-1")
		require.NoError(t, err)
		require.False(t, changed)
		require.Nil(t, manifest)
	})

	t.Run("returns an error when the manifest file is missing", func(t *testing.T) {
		t.Parallel()

		manifest, changed, err := NewFileLoader(t.TempDir(), "manifest.json").Fetch(t.Context(), "")
		require.ErrorIs(t, err, os.ErrNotExist)
		require.False(t, changed)
		require.Nil(t, manifest)
	})

	t.Run("returns an error when the manifest is malformed", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		require.NoError(t, os.WriteFile(filepath.Join(dir, "manifest.json"), []byte("{bad"), 0o644))

		manifest, changed, err := NewFileLoader(dir, "manifest.json").Fetch(t.Context(), "")
		require.ErrorContains(t, err, "failed to parse manifest")
		require.False(t, changed)
		require.Nil(t, manifest)
	})
}
