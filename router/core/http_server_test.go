package core

import (
	"net"
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
