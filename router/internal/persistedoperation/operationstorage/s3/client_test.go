package s3

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

	manifest := map[string]interface{}{
		"version":  1,
		"revision": "rev-1",
		"operations": map[string]string{
			"abc123": "query { employees { id } }",
		},
	}
	plainJSON, err := json.Marshal(manifest)
	require.NoError(t, err)

	t.Run("plain JSON", func(t *testing.T) {
		t.Parallel()

		data, err := decompressAndRead(bytes.NewReader(plainJSON), "manifest.json")
		require.NoError(t, err)
		require.JSONEq(t, string(plainJSON), string(data))
	})

	t.Run("gzip compressed", func(t *testing.T) {
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

	t.Run("zstd compressed", func(t *testing.T) {
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

	t.Run("extension is case insensitive", func(t *testing.T) {
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

	t.Run("invalid gzip data returns error", func(t *testing.T) {
		t.Parallel()

		_, err := decompressAndRead(bytes.NewReader([]byte("not gzip")), "manifest.json.gz")
		require.Error(t, err)
	})

	t.Run("invalid zstd data returns error", func(t *testing.T) {
		t.Parallel()

		_, err := decompressAndRead(bytes.NewReader([]byte("not zstd")), "manifest.json.zst")
		require.Error(t, err)
	})
}
