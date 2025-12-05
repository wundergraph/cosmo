package integration

import (
	"context"
	"sync"
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
			ServicesDir:     "../testdata/connectrpc/services",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		ctx := context.Background()
		err = server.Stop(ctx)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "server is not started")
	})

	t.Run("concurrent start attempts succeed", func(t *testing.T) {
		ts := NewTestConnectRPCServer(t, ConnectRPCServerOptions{})

		var wg sync.WaitGroup
		errors := make([]error, 3)

		// Try to start server concurrently
		for i := 0; i < 3; i++ {
			wg.Add(1)
			go func(idx int) {
				defer wg.Done()
				errors[idx] = ts.Server.Start()
			}(i)
		}

		wg.Wait()

		// At least one should succeed
		successCount := 0
		for _, err := range errors {
			if err == nil {
				successCount++
			}
		}
		assert.GreaterOrEqual(t, successCount, 1, "at least one start should succeed")
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

// TestConnectRPC_Server_GetServiceInfo tests service info retrieval
func TestConnectRPC_Server_GetServiceInfo(t *testing.T) {
	t.Parallel()

	t.Run("returns consistent service count and names", func(t *testing.T) {
		ts := NewTestConnectRPCServer(t, ConnectRPCServerOptions{})

		// Services are loaded during NewServer, so they should be available immediately
		count := ts.GetServiceCount()
		names := ts.GetServiceNames()
		
		assert.GreaterOrEqual(t, count, 1, "should have at least one service after NewServer")
		assert.Len(t, names, count, "service names length should match count")
		assert.NotEmpty(t, names, "service names should not be empty")

		err := ts.Start()
		require.NoError(t, err)

		// After start - verify count and names remain consistent
		countAfterStart := ts.GetServiceCount()
		namesAfterStart := ts.GetServiceNames()
		
		assert.Equal(t, count, countAfterStart, "service count should remain the same after Start")
		assert.ElementsMatch(t, names, namesAfterStart, "service names should remain the same after Start")
	})
}