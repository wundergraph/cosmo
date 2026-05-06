package exporter

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
)

type bearerAuthHandler struct {
	graphqlmetricsv1connect.UnimplementedGraphQLMetricsServiceHandler

	mu   sync.Mutex
	auth []string
}

func (h *bearerAuthHandler) PublishAggregatedGraphQLMetrics(
	_ context.Context,
	req *connect.Request[graphqlmetricsv1.PublishAggregatedGraphQLRequestMetricsRequest],
) (*connect.Response[graphqlmetricsv1.PublishAggregatedGraphQLRequestMetricsResponse], error) {
	h.mu.Lock()
	h.auth = append(h.auth, req.Header().Get("Authorization"))
	h.mu.Unlock()
	return connect.NewResponse(&graphqlmetricsv1.PublishAggregatedGraphQLRequestMetricsResponse{}), nil
}

func (h *bearerAuthHandler) snapshot() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]string, len(h.auth))
	copy(out, h.auth)
	return out
}

func newBearerAuthServer(t *testing.T) (*bearerAuthHandler, *httptest.Server) {
	t.Helper()
	handler := &bearerAuthHandler{}
	mux := http.NewServeMux()
	path, h := graphqlmetricsv1connect.NewGraphQLMetricsServiceHandler(handler)
	mux.Handle(path, h)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return handler, srv
}

func publish(t *testing.T, client graphqlmetricsv1connect.GraphQLMetricsServiceClient) {
	t.Helper()
	_, err := client.PublishAggregatedGraphQLMetrics(
		context.Background(),
		connect.NewRequest(&graphqlmetricsv1.PublishAggregatedGraphQLRequestMetricsRequest{}),
	)
	require.NoError(t, err)
}

func TestWithBearerAuth_SetsAuthorizationHeader(t *testing.T) {
	t.Parallel()
	handler, srv := newBearerAuthServer(t)

	client := graphqlmetricsv1connect.NewGraphQLMetricsServiceClient(
		srv.Client(),
		srv.URL,
		WithBearerAuth("secret-token"),
	)

	publish(t, client)
	require.Equal(t, []string{"Bearer secret-token"}, handler.snapshot())
}

// TestWithBearerAuth_AppliesToEveryCall is the "after" half of the before/after
// API-key validation: previously the sink set the Authorization header on
// every call manually; now the interceptor must do the same automatically.
func TestWithBearerAuth_AppliesToEveryCall(t *testing.T) {
	t.Parallel()
	handler, srv := newBearerAuthServer(t)

	client := graphqlmetricsv1connect.NewGraphQLMetricsServiceClient(
		srv.Client(),
		srv.URL,
		WithBearerAuth("secret-token"),
	)

	for range 3 {
		publish(t, client)
	}
	require.Equal(t, []string{
		"Bearer secret-token",
		"Bearer secret-token",
		"Bearer secret-token",
	}, handler.snapshot())
}

// TestWithoutBearerAuth_NoAuthorizationHeader proves the header is set by the
// interceptor and nothing else: a client constructed without WithBearerAuth
// produces no Authorization header. This is the "before" assertion that
// confirms the sink itself never sets the header in the new design.
func TestWithoutBearerAuth_NoAuthorizationHeader(t *testing.T) {
	t.Parallel()
	handler, srv := newBearerAuthServer(t)

	client := graphqlmetricsv1connect.NewGraphQLMetricsServiceClient(
		srv.Client(),
		srv.URL,
	)

	publish(t, client)
	require.Equal(t, []string{""}, handler.snapshot())
}

func TestWithBearerAuth_EmptyToken(t *testing.T) {
	t.Parallel()
	handler, srv := newBearerAuthServer(t)

	client := graphqlmetricsv1connect.NewGraphQLMetricsServiceClient(
		srv.Client(),
		srv.URL,
		WithBearerAuth(""),
	)

	publish(t, client)
	// HTTP transport trims trailing whitespace from header values; the
	// interceptor still sends "Bearer ", but the server observes "Bearer".
	require.Equal(t, []string{"Bearer"}, handler.snapshot())
}
