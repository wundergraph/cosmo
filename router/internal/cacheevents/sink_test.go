package cacheevents

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/require"
	cacheeventsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/cacheevents/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/cacheevents/v1/cacheeventsv1connect"
	"go.uber.org/zap"
)

type recordingHandler struct {
	cacheeventsv1connect.UnimplementedCacheEventsServiceHandler

	mu      sync.Mutex
	auth    []string
	batches [][]*cacheeventsv1.CacheEvent
}

func (h *recordingHandler) PublishEntityCacheEvents(
	_ context.Context,
	req *connect.Request[cacheeventsv1.PublishEntityCacheEventsRequest],
) (*connect.Response[cacheeventsv1.PublishEntityCacheEventsResponse], error) {
	h.mu.Lock()
	h.auth = append(h.auth, req.Header().Get("Authorization"))
	h.batches = append(h.batches, req.Msg.GetEvents())
	h.mu.Unlock()
	return connect.NewResponse(&cacheeventsv1.PublishEntityCacheEventsResponse{}), nil
}

func newRecordingServer(t *testing.T) (*recordingHandler, string) {
	t.Helper()
	handler := &recordingHandler{}
	mux := http.NewServeMux()
	path, h := cacheeventsv1connect.NewCacheEventsServiceHandler(handler)
	mux.Handle(path, h)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return handler, srv.URL
}

// TestSink_Export_DoesNotSetAuthHeader is the sink-level "before/after"
// assertion: the sink no longer sets Authorization itself. Auth is the
// Connect interceptor's responsibility now (see internal/exporter.WithBearerAuth).
// A client constructed without WithBearerAuth must produce an empty header.
func TestSink_Export_DoesNotSetAuthHeader(t *testing.T) {
	t.Parallel()
	handler, url := newRecordingServer(t)

	client := cacheeventsv1connect.NewCacheEventsServiceClient(http.DefaultClient, url)
	sink := NewSink(SinkConfig{Client: client, Logger: zap.NewNop()})

	batch := []*cacheeventsv1.CacheEvent{{EventType: cacheeventsv1.EventType_L1_READ}}
	require.NoError(t, sink.Export(context.Background(), batch))

	handler.mu.Lock()
	defer handler.mu.Unlock()
	require.Equal(t, []string{""}, handler.auth)
}

func TestSink_Export_ForwardsBatch(t *testing.T) {
	t.Parallel()
	handler, url := newRecordingServer(t)

	client := cacheeventsv1connect.NewCacheEventsServiceClient(http.DefaultClient, url)
	sink := NewSink(SinkConfig{Client: client, Logger: zap.NewNop()})

	batch := []*cacheeventsv1.CacheEvent{
		{EventType: cacheeventsv1.EventType_L1_READ, EntityType: "User"},
		{EventType: cacheeventsv1.EventType_L2_WRITE, EntityType: "Product"},
	}
	require.NoError(t, sink.Export(context.Background(), batch))

	handler.mu.Lock()
	defer handler.mu.Unlock()
	require.Len(t, handler.batches, 1)
	require.Len(t, handler.batches[0], 2)
	require.Equal(t, cacheeventsv1.EventType_L1_READ, handler.batches[0][0].EventType)
	require.Equal(t, "User", handler.batches[0][0].EntityType)
	require.Equal(t, cacheeventsv1.EventType_L2_WRITE, handler.batches[0][1].EventType)
	require.Equal(t, "Product", handler.batches[0][1].EntityType)
}

func TestSink_Export_EmptyBatchIsNoOp(t *testing.T) {
	t.Parallel()
	handler, url := newRecordingServer(t)

	client := cacheeventsv1connect.NewCacheEventsServiceClient(http.DefaultClient, url)
	sink := NewSink(SinkConfig{Client: client, Logger: zap.NewNop()})

	require.NoError(t, sink.Export(context.Background(), nil))
	require.NoError(t, sink.Export(context.Background(), []*cacheeventsv1.CacheEvent{}))

	handler.mu.Lock()
	defer handler.mu.Unlock()
	require.Empty(t, handler.batches, "empty batches must not hit the wire")
}
