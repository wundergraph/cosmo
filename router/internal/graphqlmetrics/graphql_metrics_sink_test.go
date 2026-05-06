package graphqlmetrics

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/require"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1/graphqlmetricsv1connect"
	"go.uber.org/zap"
)

type recordingHandler struct {
	graphqlmetricsv1connect.UnimplementedGraphQLMetricsServiceHandler

	mu        sync.Mutex
	auth      []string
	aggregate []*graphqlmetricsv1.PublishAggregatedGraphQLRequestMetricsRequest
}

func (h *recordingHandler) PublishAggregatedGraphQLMetrics(
	_ context.Context,
	req *connect.Request[graphqlmetricsv1.PublishAggregatedGraphQLRequestMetricsRequest],
) (*connect.Response[graphqlmetricsv1.PublishAggregatedGraphQLRequestMetricsResponse], error) {
	h.mu.Lock()
	h.auth = append(h.auth, req.Header().Get("Authorization"))
	h.aggregate = append(h.aggregate, req.Msg)
	h.mu.Unlock()
	return connect.NewResponse(&graphqlmetricsv1.PublishAggregatedGraphQLRequestMetricsResponse{}), nil
}

func newRecordingServer(t *testing.T) (*recordingHandler, string) {
	t.Helper()
	handler := &recordingHandler{}
	mux := http.NewServeMux()
	path, h := graphqlmetricsv1connect.NewGraphQLMetricsServiceHandler(handler)
	mux.Handle(path, h)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return handler, srv.URL
}

// TestSink_Export_DoesNotSetAuthHeader confirms the sink no longer manages
// the Authorization header. Auth is now applied by exporter.WithBearerAuth at
// the Connect-client layer; a client constructed without it must yield an
// empty Authorization on the wire even when the sink runs Export.
func TestSink_Export_DoesNotSetAuthHeader(t *testing.T) {
	t.Parallel()
	handler, url := newRecordingServer(t)

	client := graphqlmetricsv1connect.NewGraphQLMetricsServiceClient(http.DefaultClient, url)
	sink := NewGraphQLMetricsSink(GraphQLMetricsSinkConfig{Client: client, Logger: zap.NewNop()})

	batch := []*graphqlmetricsv1.SchemaUsageInfo{
		{
			OperationInfo: &graphqlmetricsv1.OperationInfo{Hash: "h", Name: "Q", Type: graphqlmetricsv1.OperationType_QUERY},
			ClientInfo:    &graphqlmetricsv1.ClientInfo{Name: "c", Version: "v"},
		},
	}
	require.NoError(t, sink.Export(context.Background(), batch))

	handler.mu.Lock()
	defer handler.mu.Unlock()
	require.Equal(t, []string{""}, handler.auth)
}

func TestSink_Export_AggregatesBeforeSending(t *testing.T) {
	t.Parallel()
	handler, url := newRecordingServer(t)

	client := graphqlmetricsv1connect.NewGraphQLMetricsServiceClient(http.DefaultClient, url)
	sink := NewGraphQLMetricsSink(GraphQLMetricsSinkConfig{Client: client, Logger: zap.NewNop()})

	// Two identical SchemaUsageInfo items must aggregate down to one entry
	// with RequestCount == 2 (the whole point of AggregateSchemaUsageInfoBatch).
	usage := func() *graphqlmetricsv1.SchemaUsageInfo {
		return &graphqlmetricsv1.SchemaUsageInfo{
			OperationInfo: &graphqlmetricsv1.OperationInfo{Hash: "same", Name: "Q", Type: graphqlmetricsv1.OperationType_QUERY},
			ClientInfo:    &graphqlmetricsv1.ClientInfo{Name: "c", Version: "v"},
			SchemaInfo:    &graphqlmetricsv1.SchemaInfo{Version: "1"},
			RequestInfo:   &graphqlmetricsv1.RequestInfo{StatusCode: 200},
		}
	}
	require.NoError(t, sink.Export(context.Background(), []*graphqlmetricsv1.SchemaUsageInfo{usage(), usage()}))

	handler.mu.Lock()
	defer handler.mu.Unlock()
	require.Len(t, handler.aggregate, 1)
	require.Len(t, handler.aggregate[0].Aggregation, 1)
	require.Equal(t, uint64(2), handler.aggregate[0].Aggregation[0].RequestCount)
}

func TestSink_Export_EmptyBatchIsNoOp(t *testing.T) {
	t.Parallel()
	handler, url := newRecordingServer(t)

	client := graphqlmetricsv1connect.NewGraphQLMetricsServiceClient(http.DefaultClient, url)
	sink := NewGraphQLMetricsSink(GraphQLMetricsSinkConfig{Client: client, Logger: zap.NewNop()})

	require.NoError(t, sink.Export(context.Background(), nil))
	require.NoError(t, sink.Export(context.Background(), []*graphqlmetricsv1.SchemaUsageInfo{}))

	handler.mu.Lock()
	defer handler.mu.Unlock()
	require.Empty(t, handler.aggregate, "empty batches must not hit the wire")
}
