package operationmanifest

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/klauspost/compress/gzip"
	"github.com/klauspost/compress/zstd"
	"github.com/stretchr/testify/require"
)

func TestDecompressAndRead(t *testing.T) {
	t.Parallel()

	manifest := map[string]any{
		"version":  1,
		"revision": "rev-1",
		"operations": map[string]string{
			"abc123": "query { employees { id } }",
		},
	}
	plainJSON, err := json.Marshal(manifest)
	require.NoError(t, err)

	t.Run("returns plain content as is", func(t *testing.T) {
		t.Parallel()

		data, err := decompressAndRead(bytes.NewReader(plainJSON), "manifest.json")
		require.NoError(t, err)
		require.JSONEq(t, string(plainJSON), string(data))
	})

	t.Run("decompresses gzip content", func(t *testing.T) {
		t.Parallel()

		var buf bytes.Buffer
		gw := gzip.NewWriter(&buf)
		_, err := gw.Write(plainJSON)
		require.NoError(t, err)
		require.NoError(t, gw.Close())

		data, err := decompressAndRead(bytes.NewReader(buf.Bytes()), "manifest.json.gz")
		require.NoError(t, err)
		require.JSONEq(t, string(plainJSON), string(data))
	})

	t.Run("decompresses zstd content", func(t *testing.T) {
		t.Parallel()

		var buf bytes.Buffer
		zw, err := zstd.NewWriter(&buf)
		require.NoError(t, err)
		_, err = zw.Write(plainJSON)
		require.NoError(t, err)
		require.NoError(t, zw.Close())

		data, err := decompressAndRead(bytes.NewReader(buf.Bytes()), "manifest.json.zst")
		require.NoError(t, err)
		require.JSONEq(t, string(plainJSON), string(data))
	})

	t.Run("matches the extension case insensitively", func(t *testing.T) {
		t.Parallel()

		var buf bytes.Buffer
		gw := gzip.NewWriter(&buf)
		_, err := gw.Write(plainJSON)
		require.NoError(t, err)
		require.NoError(t, gw.Close())

		data, err := decompressAndRead(bytes.NewReader(buf.Bytes()), "manifest.json.GZ")
		require.NoError(t, err)
		require.JSONEq(t, string(plainJSON), string(data))
	})

	t.Run("returns an error for invalid gzip data", func(t *testing.T) {
		t.Parallel()

		_, err := decompressAndRead(bytes.NewReader([]byte("not gzip")), "manifest.json.gz")
		require.Error(t, err)
	})

	t.Run("returns an error for invalid zstd data", func(t *testing.T) {
		t.Parallel()

		_, err := decompressAndRead(bytes.NewReader([]byte("not zstd")), "manifest.json.zst")
		require.Error(t, err)
	})
}
