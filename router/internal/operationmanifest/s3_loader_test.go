package operationmanifest

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestS3Loader(t *testing.T) {
	t.Parallel()

	manifestJSON := `{"version":1,"revision":"rev-1","generatedAt":"2026-10-01T00:00:00Z","operations":{"get_employees":"query { employees { id } }"}}`

	// newServer serves manifestJSON with ETag "etag-1". When honorIfNoneMatch is set,
	// it answers a matching If-None-Match with 304, like S3. It records the
	// method, path and If-None-Match header of every request.
	newServer := func(t *testing.T, honorIfNoneMatch bool) (*S3Loader, func() []string) {
		var mu sync.Mutex
		var received []string
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			received = append(received, r.Method+" "+r.URL.Path+" "+r.Header.Get("If-None-Match"))
			mu.Unlock()

			w.Header().Set("ETag", `"etag-1"`)
			w.Header().Set("Last-Modified", "Thu, 01 Oct 2026 00:00:00 GMT")
			if honorIfNoneMatch && r.Header.Get("If-None-Match") == `"etag-1"` {
				w.WriteHeader(http.StatusNotModified)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(manifestJSON))
		}))
		t.Cleanup(server.Close)

		loader, err := NewS3Loader(config.S3StorageProvider{
			Endpoint:  strings.TrimPrefix(server.URL, "http://"),
			AccessKey: "access-key",
			SecretKey: "secret-key",
			Region:    "us-east-1",
			Bucket:    "bucket",
		}, "ops/manifest.json")
		require.NoError(t, err)

		return loader, func() []string {
			mu.Lock()
			defer mu.Unlock()
			return append([]string(nil), received...)
		}
	}

	t.Run("returns the manifest when no etag is stored", func(t *testing.T) {
		t.Parallel()

		loader, received := newServer(t, true)

		data, changed, err := loader.Fetch(t.Context(), "")
		require.NoError(t, err)
		require.True(t, changed)
		require.Equal(t, []byte(manifestJSON), data)
		require.Equal(t, []string{"GET /bucket/ops/manifest.json "}, received())
	})

	t.Run("returns unchanged when the store answers the stored etag with 304", func(t *testing.T) {
		t.Parallel()

		loader, received := newServer(t, true)

		_, _, err := loader.Fetch(t.Context(), "")
		require.NoError(t, err)

		data, changed, err := loader.Fetch(t.Context(), "")
		require.NoError(t, err)
		require.False(t, changed)
		require.Nil(t, data)
		require.Equal(t, []string{
			"GET /bucket/ops/manifest.json ",
			`GET /bucket/ops/manifest.json "etag-1"`,
		}, received())
	})

	t.Run("returns the object again when the store ignores if-none-match", func(t *testing.T) {
		t.Parallel()

		loader, received := newServer(t, false)

		_, _, err := loader.Fetch(t.Context(), "")
		require.NoError(t, err)

		data, changed, err := loader.Fetch(t.Context(), "")
		require.NoError(t, err)
		require.True(t, changed)
		require.Equal(t, []byte(manifestJSON), data)

		require.Equal(t, []string{
			"GET /bucket/ops/manifest.json ",
			`GET /bucket/ops/manifest.json "etag-1"`,
		}, received())
	})
}
