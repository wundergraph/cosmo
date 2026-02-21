package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/connectrpc"
	"go.uber.org/zap"
)

// TestConnectRPC_ServerLifecycle_StartStopReload tests the complete lifecycle of the server
func TestConnectRPC_ServerLifecycle_StartStopReload(t *testing.T) {
	t.Parallel()

	t.Run("complete lifecycle: start -> reload -> stop", func(t *testing.T) {
		ts := NewTestConnectRPCServer(t, ConnectRPCServerOptions{})

		// Start the server
		err := ts.Start()
		require.NoError(t, err)

		// Verify server is running
		assert.Greater(t, ts.GetServiceCount(), 0)

		// Reload the server
		err = ts.Reload()
		require.NoError(t, err)

		// Verify server still works after reload
		assert.Greater(t, ts.GetServiceCount(), 0)

		// Stop is handled by cleanup
	})

	t.Run("stop without start returns error", func(t *testing.T) {
		server, err := connectrpc.NewServer(connectrpc.ServerConfig{
			ServicesDir:     "../../router/pkg/connectrpc/testdata/services",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		ctx := context.Background()
		err = server.Stop(ctx)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "server is not started")
	})
}

// TestConnectRPC_ServerLifecycle_ErrorScenarios tests various error scenarios
func TestConnectRPC_ServerLifecycle_ErrorScenarios(t *testing.T) {
	t.Parallel()

	t.Run("NewServer fails with invalid proto directory", func(t *testing.T) {
		_, err := connectrpc.NewServer(connectrpc.ServerConfig{
			ServicesDir:     "/nonexistent/path",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Logger:          zap.NewNop(),
		})
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "failed to discover services")
	})
}

// TestConnectRPC_ServerLifecycle_StateTransitions tests state transitions
func TestConnectRPC_ServerLifecycle_StateTransitions(t *testing.T) {
	t.Parallel()

	t.Run("service names remain consistent through reload", func(t *testing.T) {
		ts := NewTestConnectRPCServer(t, ConnectRPCServerOptions{})

		err := ts.Start()
		require.NoError(t, err)

		namesBeforeReload := ts.GetServiceNames()
		require.NotEmpty(t, namesBeforeReload)

		err = ts.Reload()
		require.NoError(t, err)

		namesAfterReload := ts.GetServiceNames()
		assert.ElementsMatch(t, namesBeforeReload, namesAfterReload, "service names should remain consistent")
	})
}

// TestConnectRPC_ServerLifecycle_GracefulShutdown tests graceful shutdown behavior
func TestConnectRPC_ServerLifecycle_GracefulShutdown(t *testing.T) {
	t.Parallel()

	t.Run("stop respects context deadline", func(t *testing.T) {
		ts := NewTestConnectRPCServer(t, ConnectRPCServerOptions{})

		err := ts.Start()
		require.NoError(t, err)

		// Use a reasonable timeout
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		startTime := time.Now()
		err = ts.Server.Stop(ctx)
		duration := time.Since(startTime)

		assert.NoError(t, err)
		assert.Less(t, duration, 10*time.Second, "stop should complete within timeout")
	})
}