package core

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/health"
	"go.uber.org/zap"
)

func TestNewServer_PortBindingError(t *testing.T) {
	// Bind a port first
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()

	// Get the address that was bound
	addr := listener.Addr().String()

	// Try to create a server on the same port - this should fail immediately
	logger := zap.NewNop()
	hc := health.New(&health.Options{Logger: logger})

	_, err = newServer(&httpServerOptions{
		addr:               addr,
		logger:             logger,
		healthcheck:        hc,
		baseURL:            "http://" + addr,
		maxHeaderBytes:     1024,
		healthCheckPath:    "/health",
		livenessCheckPath:  "/health/live",
		readinessCheckPath: "/health/ready",
	})

	// Should return an error immediately, not succeed
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "failed to bind to address")
}

func TestNewServer_PortBindingSuccess(t *testing.T) {
	// Find an available port
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	addr := listener.Addr().String()
	listener.Close() // Close it so we can use it

	// Try to create a server on the available port - this should succeed
	logger := zap.NewNop()
	hc := health.New(&health.Options{Logger: logger})

	server, err := newServer(&httpServerOptions{
		addr:               addr,
		logger:             logger,
		healthcheck:        hc,
		baseURL:            "http://" + addr,
		maxHeaderBytes:     1024,
		healthCheckPath:    "/health",
		livenessCheckPath:  "/health/live",
		readinessCheckPath: "/health/ready",
	})

	// Should succeed
	assert.NoError(t, err)
	assert.NotNil(t, server)

	// Clean up
	if server != nil {
		server.Shutdown(t.Context())
	}
}

func TestRouter_Start_PortBindingError(t *testing.T) {
	// Bind a port first
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()

	// Get the address that was bound
	addr := listener.Addr().String()

	// Create a router with static config that uses the already-bound port
	router, err := NewRouter(
		t.Context(),
		WithStaticExecutionConfig(&nodev1.RouterConfig{
			Version: "1.0.0",
		}),
		WithListenerAddr(addr),
	)
	require.NoError(t, err)

	// Try to start the router - should fail immediately with port binding error
	err = router.Start(t.Context())
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "failed to create server")
}

// startTestServer starts a real server on an ephemeral port and returns it with its base URL.
func startTestServer(t *testing.T) (*server, string) {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	addr := listener.Addr().String()
	require.NoError(t, listener.Close())

	logger := zap.NewNop()
	srv, err := newServer(&httpServerOptions{
		addr:               addr,
		logger:             logger,
		healthcheck:        health.New(&health.Options{Logger: logger}),
		baseURL:            "http://" + addr,
		maxHeaderBytes:     1024,
		healthCheckPath:    "/health",
		livenessCheckPath:  "/health/live",
		readinessCheckPath: "/health/ready",
	})
	require.NoError(t, err)

	go func() { _ = srv.listenAndServe() }()
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })

	return srv, "http://" + addr
}

// getReused performs a GET and reports whether the connection was reused.
func getReused(t *testing.T, client *http.Client, url string) (*http.Response, bool) {
	t.Helper()

	var reused bool
	trace := &httptrace.ClientTrace{GotConn: func(info httptrace.GotConnInfo) { reused = info.Reused }}
	req, err := http.NewRequestWithContext(httptrace.WithClientTrace(t.Context(), trace), http.MethodGet, url, nil)
	require.NoError(t, err)

	resp, err := client.Do(req)
	require.NoError(t, err)
	_, _ = io.Copy(io.Discard, resp.Body)
	require.NoError(t, resp.Body.Close())

	return resp, reused
}

// TestServer_KeepAliveWhenNotDraining verifies that responses keep the connection alive and
// allow its reuse until StartDraining is called.
func TestServer_KeepAliveWhenNotDraining(t *testing.T) {
	srv, base := startTestServer(t)
	client := &http.Client{Transport: &http.Transport{}}
	t.Cleanup(client.CloseIdleConnections)

	resp1, _ := getReused(t, client, base+"/health")
	resp2, reused := getReused(t, client, base+"/health")

	assert.False(t, srv.IsDraining())
	assert.False(t, resp1.Close)
	assert.False(t, resp2.Close)
	assert.True(t, reused)
}

// TestServer_DrainingSetsConnectionClose verifies that after StartDraining every response carries
// "Connection: close" and the client cannot reuse the connection.
func TestServer_DrainingSetsConnectionClose(t *testing.T) {
	srv, base := startTestServer(t)
	client := &http.Client{Transport: &http.Transport{}}
	t.Cleanup(client.CloseIdleConnections)

	srv.StartDraining()

	resp1, _ := getReused(t, client, base+"/health")
	resp2, reused := getReused(t, client, base+"/health")

	assert.True(t, srv.IsDraining())
	assert.True(t, resp1.Close)
	assert.True(t, resp2.Close)
	assert.False(t, reused)
}

// TestServer_DrainingSkipsUpgrade verifies that draining does not add "Connection: close" to
// upgrade requests (e.g. WebSocket handshakes).
func TestServer_DrainingSkipsUpgrade(t *testing.T) {
	srv, base := startTestServer(t)
	client := &http.Client{Transport: &http.Transport{}}
	t.Cleanup(client.CloseIdleConnections)

	srv.StartDraining()

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, base+"/health", nil)
	require.NoError(t, err)
	req.Header.Set("Connection", "upgrade")
	req.Header.Set("Upgrade", "websocket")

	resp, err := client.Do(req)
	require.NoError(t, err)
	require.NoError(t, resp.Body.Close())

	assert.False(t, resp.Close, "upgrade request must not force connection close")
}
