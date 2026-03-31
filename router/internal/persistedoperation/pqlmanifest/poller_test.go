package pqlmanifest

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestPoller_FetchInitial(t *testing.T) {
	t.Parallel()
	m := &Manifest{
		Version:     1,
		Revision:    "rev-1",
		GeneratedAt: "2025-01-01T00:00:00Z",
		Operations:  map[string]string{"h1": "query { a }"},
	}

	server := httptest.NewServer(newETagCDNHandler(m))
	defer server.Close()

	f := newTestFetcher(server.URL)
	l := zap.NewNop()
	s := NewStore(l)
	poller := NewPoller(f, s, 10*time.Second, 1*time.Second, zap.NewNop())

	err := poller.FetchInitial(context.Background())
	require.NoError(t, err)

	require.True(t, s.IsLoaded())
	require.Equal(t, m.Revision, s.Revision())
	require.Equal(t, len(m.Operations), s.OperationCount())
}

func TestPoller_FetchInitialError(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	f := newTestFetcher(server.URL)
	s := NewStore(zap.NewNop())
	poller := NewPoller(f, s, 10*time.Second, 1*time.Second, zap.NewNop())

	err := poller.FetchInitial(context.Background())
	require.Error(t, err)
	require.False(t, s.IsLoaded())
}

func TestPoller_PollUpdatesManifest(t *testing.T) {
	t.Parallel()
	manifestV1 := &Manifest{
		Version:     1,
		Revision:    "rev-1",
		GeneratedAt: "2025-01-01T00:00:00Z",
		Operations:  map[string]string{"h1": "query { a }"},
	}
	manifestV2 := &Manifest{
		Version:     1,
		Revision:    "rev-2",
		GeneratedAt: "2025-01-02T00:00:00Z",
		Operations:  map[string]string{"h1": "query { a }", "h2": "query { b }"},
	}

	var currentManifest atomic.Value
	currentManifest.Store(manifestV1)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		m := currentManifest.Load().(*Manifest)
		etag := `"` + m.Revision + `"`
		if r.Header.Get("If-None-Match") == etag {
			w.Header().Set("ETag", etag)
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("ETag", etag)
		data, _ := json.Marshal(m)
		w.Write(data)
	}))
	defer server.Close()

	f := newTestFetcher(server.URL)
	s := NewStore(zap.NewNop())
	poller := NewPoller(f, s, 50*time.Millisecond, 1*time.Millisecond, zap.NewNop())

	// Initial fetch
	err := poller.FetchInitial(context.Background())
	require.NoError(t, err)

	require.Equal(t, manifestV1.Revision, s.Revision())
	require.Equal(t, len(manifestV1.Operations), s.OperationCount())

	// Start polling
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go poller.Poll(ctx)

	// Wait a few poll cycles — manifest should stay at rev-1 (304s)
	time.Sleep(150 * time.Millisecond)
	require.Equal(t, manifestV1.Revision, s.Revision())

	// Update server to serve rev-2
	currentManifest.Store(manifestV2)

	// Wait for poller to pick up the change
	require.Eventually(t, func() bool {
		return s.Revision() == manifestV2.Revision
	}, 2*time.Second, 10*time.Millisecond)

	require.Equal(t, len(manifestV2.Operations), s.OperationCount())
}

func TestPoller_PollStopsOnContextCancel(t *testing.T) {
	t.Parallel()
	var fetchCount atomic.Int32

	m := &Manifest{
		Version:     1,
		Revision:    "rev-1",
		GeneratedAt: "2025-01-01T00:00:00Z",
		Operations:  map[string]string{},
	}
	data := mustMarshalManifest(m)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fetchCount.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
	}))
	defer server.Close()

	f := newTestFetcher(server.URL)
	s := NewStore(zap.NewNop())
	poller := NewPoller(f, s, 50*time.Millisecond, 1*time.Millisecond, zap.NewNop())

	ctx, cancel := context.WithCancel(context.Background())
	go poller.Poll(ctx)

	// Let it poll a few times
	time.Sleep(200 * time.Millisecond)
	cancel()

	countAtCancel := fetchCount.Load()
	// Wait and verify no more fetches happen
	time.Sleep(200 * time.Millisecond)
	require.Equal(t, countAtCancel, fetchCount.Load(), "poller should stop fetching after context cancel")
}

func TestPoller_PollContinuesOnFetchError(t *testing.T) {
	t.Parallel()
	var requestCount atomic.Int32

	m := &Manifest{
		Version:     1,
		Revision:    "rev-1",
		GeneratedAt: "2025-01-01T00:00:00Z",
		Operations:  map[string]string{"h1": "query { a }"},
	}
	data := mustMarshalManifest(m)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := requestCount.Add(1)
		if count <= 2 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
	}))
	defer server.Close()

	f := newTestFetcher(server.URL)
	s := NewStore(zap.NewNop())
	poller := NewPoller(f, s, 50*time.Millisecond, 1*time.Millisecond, zap.NewNop())

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go poller.Poll(ctx)

	require.Eventually(t, func() bool {
		return s.IsLoaded() && s.Revision() == m.Revision
	}, 5*time.Second, 10*time.Millisecond)
}
