package s3

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
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

	var requestedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestedPath = r.URL.Path
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

	content, err := client.PersistedOperation(t.Context(), "my-client", "does-not-exist")
	assert.Nil(t, content)
	assert.Equal(t, "/operations/prefix/does-not-exist.json", requestedPath)

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

// TestPersistedOperationIDRoundTrip checks the object key after the S3 SDK's
// URL encoding, including percent sequences that must remain literal.
func TestPersistedOperationIDRoundTrip(t *testing.T) {
	t.Parallel()
	for _, id := range []string{"get_employee-1.2.3", " !\"#$%&'()*+,-.:;<=>?@[]^_{}|~ ", "%2F", "%252F", ".", "..", strings.Repeat(".", 250)} {
		t.Run(id, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/operations/prefix/"+id+".json", r.URL.Path)
				assert.Equal(t, "", r.URL.RawQuery)
				w.Header().Set("Last-Modified", "Mon, 05 Oct 2026 12:00:00 GMT")
				assert.NoError(t, json.NewEncoder(w).Encode(map[string]any{"version": 1, "body": "query { a }"}))
			}))
			defer server.Close()
			provider := sdktrace.NewTracerProvider()
			defer provider.Shutdown(t.Context())
			client, err := NewClient(strings.TrimPrefix(server.URL, "http://"), &Options{
				AccessKeyID: "access-key", SecretAccessKey: "secret-key",
				Region: "us-east-1", BucketName: "operations", ObjectPathPrefix: "prefix", TraceProvider: provider,
			})
			require.NoError(t, err)
			body, err := client.PersistedOperation(t.Context(), "web", id)
			require.NoError(t, err)
			assert.Equal(t, "query { a }", string(body))
		})
	}
}
