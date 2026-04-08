package pqlmanifest

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func newTestFetcher(serverURL string) *Fetcher {
	u, _ := url.Parse(serverURL)
	return &Fetcher{
		cdnURL:              u,
		authenticationToken: "test-token",
		federatedGraphID:    "graph-id",
		organizationID:      "org-id",
		httpClient:          &http.Client{},
		logger:              zap.NewNop(),
	}
}

// mustMarshalManifest marshals a Manifest to JSON, panicking on error.
func mustMarshalManifest(m *Manifest) []byte {
	data, err := json.Marshal(m)
	if err != nil {
		panic(err)
	}
	return data
}

// newETagCDNHandler returns an http.Handler that serves a manifest with ETag support.
// It returns 304 when If-None-Match matches the manifest's revision.
func newETagCDNHandler(m *Manifest) http.Handler {
	data := mustMarshalManifest(m)
	etag := `"` + m.Revision + `"`
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("If-None-Match") == etag {
			w.Header().Set("ETag", etag)
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("ETag", etag)
		w.Write(data)
	})
}

func TestFetch_SendsIfNoneMatchHeader(t *testing.T) {
	t.Parallel()
	var receivedHeaders http.Header
	var receivedMethod string
	var receivedBody []byte

	m := &Manifest{
		Version:     1,
		Revision:    "rev-123",
		GeneratedAt: "2025-01-01T00:00:00Z",
		Operations:  map[string]string{"hash1": "query { a }"},
	}
	data := mustMarshalManifest(m)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedHeaders = r.Header
		receivedMethod = r.Method
		receivedBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("ETag", `"rev-123"`)
		w.Write(data)
	}))
	defer server.Close()

	f := newTestFetcher(server.URL)
	result, changed, err := f.Fetch(context.Background(), "rev-123")

	require.NoError(t, err)
	require.True(t, changed)
	require.NotNil(t, result)
	require.Equal(t, m.Revision, result.Revision)
	require.Equal(t, `"rev-123"`, receivedHeaders.Get("If-None-Match"))
	require.Equal(t, "GET", receivedMethod)
	require.Empty(t, receivedBody, "GET request should have no body")
}

func TestFetch_NoIfNoneMatchOnFirstRequest(t *testing.T) {
	t.Parallel()
	var receivedHeaders http.Header

	m := &Manifest{
		Version:     1,
		Revision:    "rev-1",
		GeneratedAt: "2025-01-01T00:00:00Z",
		Operations:  map[string]string{"hash1": "query { a }"},
	}

	server := httptest.NewServer(newETagCDNHandler(m))
	defer server.Close()

	f := newTestFetcher(server.URL)

	// Wrap to capture headers
	var origHandler http.Handler = server.Config.Handler
	server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedHeaders = r.Header
		origHandler.ServeHTTP(w, r)
	})

	result, changed, err := f.Fetch(context.Background(), "")

	require.NoError(t, err)
	require.True(t, changed)
	require.NotNil(t, result)
	require.Equal(t, "", receivedHeaders.Get("If-None-Match"))
}

func TestFetch_Handles304Response(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotModified)
	}))
	defer server.Close()

	f := newTestFetcher(server.URL)
	result, changed, err := f.Fetch(context.Background(), "rev-123")

	require.NoError(t, err)
	require.False(t, changed)
	require.Nil(t, result)
}

func TestFetch_Handles200WithManifest(t *testing.T) {
	t.Parallel()
	m := &Manifest{
		Version:     1,
		Revision:    "rev-456",
		GeneratedAt: "2025-01-01T00:00:00Z",
		Operations:  map[string]string{"hash1": "query { hello }"},
	}

	server := httptest.NewServer(newETagCDNHandler(m))
	defer server.Close()

	f := newTestFetcher(server.URL)
	result, changed, err := f.Fetch(context.Background(), "rev-123")

	require.NoError(t, err)
	require.True(t, changed)
	require.NotNil(t, result)
	require.Equal(t, m.Revision, result.Revision)
	require.Equal(t, m.Operations["hash1"], result.Operations["hash1"])
}

func TestFetch_ETagRoundTrip(t *testing.T) {
	t.Parallel()
	m := &Manifest{
		Version:     1,
		Revision:    "rev-rt",
		GeneratedAt: "2025-01-01T00:00:00Z",
		Operations:  map[string]string{"h1": "query { a }"},
	}

	server := httptest.NewServer(newETagCDNHandler(m))
	defer server.Close()

	f := newTestFetcher(server.URL)

	// First fetch: no revision, should get full manifest
	result, changed, err := f.Fetch(context.Background(), "")
	require.NoError(t, err)
	require.True(t, changed)
	require.NotNil(t, result)
	require.Equal(t, m.Revision, result.Revision)

	// Second fetch: send revision back, should get 304
	result2, changed2, err2 := f.Fetch(context.Background(), result.Revision)
	require.NoError(t, err2)
	require.False(t, changed2)
	require.Nil(t, result2)
}

func TestFetch_UsesGETMethod(t *testing.T) {
	t.Parallel()
	var receivedMethod string

	m := &Manifest{
		Version:    1,
		Revision:   "rev-1",
		Operations: map[string]string{},
	}
	data := mustMarshalManifest(m)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedMethod = r.Method
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
	}))
	defer server.Close()

	f := newTestFetcher(server.URL)
	_, _, err := f.Fetch(context.Background(), "")

	require.NoError(t, err)
	require.Equal(t, "GET", receivedMethod)
}
