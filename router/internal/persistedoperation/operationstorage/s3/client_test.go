package s3

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/klauspost/compress/gzip"
	"github.com/klauspost/compress/zstd"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func TestPersistedOperationNotFound(t *testing.T) {
	t.Parallel()

	var (
		mu            sync.Mutex
		requestedPath string
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		requestedPath = r.URL.Path
		mu.Unlock()
		// Mimic the S3 API response for a missing object
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message><Key>` + strings.TrimPrefix(r.URL.Path, "/") + `</Key></Error>`))
	}))
	t.Cleanup(server.Close)

	client, err := NewClient(strings.TrimPrefix(server.URL, "http://"), &Options{
		AccessKeyID:      "access-key",
		SecretAccessKey:  "secret-key",
		Region:           "us-east-1",
		BucketName:       "operations",
		ObjectPathPrefix: "prefix",
		TraceProvider:    sdktrace.NewTracerProvider(),
	})
	require.NoError(t, err)

	content, err := client.PersistedOperation(context.Background(), "my-client", "does-not-exist")
	assert.Nil(t, content)

	mu.Lock()
	assert.Equal(t, "/operations/prefix/does-not-exist.json", requestedPath)
	mu.Unlock()

	var notFound *persistedoperation.PersistentOperationNotFoundError
	require.True(t, errors.As(err, &notFound), "expected PersistentOperationNotFoundError, got %T: %v", err, err)
	assert.Equal(t, "my-client", notFound.ClientName)
	assert.Equal(t, "does-not-exist", notFound.Sha256Hash)
}

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
