package operationmanifest

import (
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"strings"
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

	t.Run("does not parse a file whose bytes did not change", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		require.NoError(t, os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(manifestJSON), 0o644))
		loader := NewFileLoader(dir, "manifest.json")

		first, changed, err := loader.Fetch(t.Context(), "")
		require.NoError(t, err)
		require.True(t, changed)
		require.Equal(t, "rev-1", first.Revision)

		// Parsing again would return a new manifest. The cached one is returned
		// for a caller that does not hold its revision yet.
		second, changed, err := loader.Fetch(t.Context(), "")
		require.NoError(t, err)
		require.True(t, changed)
		require.Same(t, first, second)

		manifest, changed, err := loader.Fetch(t.Context(), "rev-1")
		require.NoError(t, err)
		require.False(t, changed)
		require.Nil(t, manifest)
	})

	t.Run("parses the file again when its bytes change", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		path := filepath.Join(dir, "manifest.json")
		require.NoError(t, os.WriteFile(path, []byte(manifestJSON), 0o644))
		loader := NewFileLoader(dir, "manifest.json")

		_, changed, err := loader.Fetch(t.Context(), "")
		require.NoError(t, err)
		require.True(t, changed)

		require.NoError(t, os.WriteFile(path, []byte(strings.Replace(manifestJSON, "rev-1", "rev-2", 1)), 0o644))

		manifest, changed, err := loader.Fetch(t.Context(), "rev-1")
		require.NoError(t, err)
		require.True(t, changed)
		require.Equal(t, "rev-2", manifest.Revision)
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
