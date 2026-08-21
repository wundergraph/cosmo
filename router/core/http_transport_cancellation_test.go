package core

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestHTTPTransportHonorsRequestCancellation documents the cancellation
// contract relied on by subscription hydration. The router's concrete HTTP
// transport must return when its request context expires; otherwise a shared
// subscription trigger can remain blocked after the hydration timeout.
func TestHTTPTransportHonorsRequestCancellation(t *testing.T) {
	requestStarted := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(requestStarted)
		<-r.Context().Done()
	}))
	t.Cleanup(server.Close)

	ctx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL, nil)
	require.NoError(t, err)

	transport := newHTTPTransport(DefaultTransportRequestOptions(), nil, nil, "products", nil)
	t.Cleanup(transport.CloseIdleConnections)

	done := make(chan error, 1)
	go func() {
		_, roundTripErr := transport.RoundTrip(req)
		done <- roundTripErr
	}()

	select {
	case <-requestStarted:
	case <-time.After(time.Second):
		t.Fatal("request did not reach the test server")
	}
	cancel()

	select {
	case roundTripErr := <-done:
		require.Error(t, roundTripErr)
		require.True(t, errors.Is(roundTripErr, context.Canceled), roundTripErr)
	case <-time.After(time.Second):
		t.Fatal("router HTTP transport did not return after request cancellation")
	}
}
