package connectrpc

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// sharedProtoLoader is a package-level proto loader that's initialized once
// to avoid proto registration conflicts across tests.
//
// This is necessary because the underlying protobuf library (gogo/protobuf or protoregistry)
// uses global state for type registration. Loading the same proto files multiple times
// in parallel tests would cause registration conflicts and race conditions.
// By loading once via sync.Once, we ensure thread-safe initialization.
var (
	sharedProtoLoader     *ProtoLoader
	sharedProtoLoaderOnce sync.Once
	sharedProtoLoaderErr  error
)

// getSharedProtoLoader returns a shared proto loader instance.
// This helper ensures proto files are loaded exactly once and handles errors consistently.
func getSharedProtoLoader(t *testing.T) *ProtoLoader {
	t.Helper()
	sharedProtoLoaderOnce.Do(func() {
		sharedProtoLoader = NewProtoLoader(zap.NewNop())
		sharedProtoLoaderErr = sharedProtoLoader.LoadFromDirectory("samples/services/employee.v1")
	})
	require.NoError(t, sharedProtoLoaderErr, "failed to load shared proto files")
	return sharedProtoLoader
}

// newTestServer creates a test server with a mock GraphQL backend.
// This helper reduces duplication across tests.
func newTestServer(t *testing.T, listenAddr string) (*Server, *httptest.Server) {
	t.Helper()
	
	graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"data":{}}`))
	}))

	server, err := NewServer(ServerConfig{
		ServicesDir:     "samples/services",
		GraphQLEndpoint: graphqlServer.URL,
		ListenAddr:      listenAddr,
		Logger:          zap.NewNop(),
	})
	require.NoError(t, err)

	return server, graphqlServer
}

// TestServerLifecycle_StartStopReload tests the complete lifecycle of the server
func TestServerLifecycle_StartStopReload(t *testing.T) {
	// Ensure protos are loaded once before running tests
	_ = getSharedProtoLoader(t)

	t.Run("complete lifecycle: start -> reload -> stop", func(t *testing.T) {
		server, graphqlServer := newTestServer(t, "localhost:0")
		defer graphqlServer.Close()

		// Start the server
		err := server.Start()
		require.NoError(t, err)
		assert.NotNil(t, server.httpServer)

		// Verify server is running
		assert.Greater(t, server.GetServiceCount(), 0)

		// Reload the server
		err = server.Reload()
		require.NoError(t, err)

		// Verify server still works after reload
		assert.Greater(t, server.GetServiceCount(), 0)

		// Stop the server
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		err = server.Stop(ctx)
		require.NoError(t, err)
	})

	t.Run("multiple reloads without errors", func(t *testing.T) {
		server, graphqlServer := newTestServer(t, "localhost:0")
		defer graphqlServer.Close()

		err := server.Start()
		require.NoError(t, err)

		// Perform multiple reloads
		for i := 0; i < 3; i++ {
			err = server.Reload()
			require.NoError(t, err, "reload %d failed", i+1)
			assert.NotNil(t, server.transcoder, "transcoder should be initialized after reload %d", i+1)
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})

	t.Run("stop without start returns error", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ServicesDir:     "samples/services",
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
		server, graphqlServer := newTestServer(t, "localhost:0")
		defer graphqlServer.Close()

		var wg sync.WaitGroup
		errors := make([]error, 3)

		// Try to start server concurrently
		for i := 0; i < 3; i++ {
			wg.Add(1)
			go func(idx int) {
				defer wg.Done()
				errors[idx] = server.Start()
			}(i)
		}

		wg.Wait()

		// At least one should succeed (server allows concurrent starts)
		successCount := 0
		for _, err := range errors {
			if err == nil {
				successCount++
			}
		}
		assert.GreaterOrEqual(t, successCount, 1, "at least one start should succeed")

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})
}

// TestServerLifecycle_VanguardIntegration tests Vanguard transcoder integration
func TestServerLifecycle_VanguardIntegration(t *testing.T) {
	t.Run("vanguard transcoder is initialized on start", func(t *testing.T) {
		server, graphqlServer := newTestServer(t, "localhost:0")
		defer graphqlServer.Close()

		// Before start
		assert.Nil(t, server.transcoder)
		assert.Nil(t, server.vanguardService)

		err := server.Start()
		require.NoError(t, err)

		// After start
		assert.NotNil(t, server.transcoder, "transcoder should be initialized")
		assert.NotNil(t, server.vanguardService, "vanguard service should be initialized")

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})

}

// TestServerLifecycle_ErrorScenarios tests various error scenarios
func TestServerLifecycle_ErrorScenarios(t *testing.T) {
	// Ensure protos are loaded once before running tests
	_ = getSharedProtoLoader(t)

	t.Run("start fails with invalid proto directory", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ServicesDir:     "/nonexistent/path",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "failed to discover services")
	})

	t.Run("reload fails with invalid proto directory", func(t *testing.T) {
		server, graphqlServer := newTestServer(t, "localhost:0")
		defer graphqlServer.Close()

		err := server.Start()
		require.NoError(t, err)

		// Change proto dirs to invalid path
		server.config.ServicesDir = "/nonexistent/path"

		err = server.Reload()
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "failed to discover services")

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})

}

// TestServerLifecycle_ComponentInitialization tests component initialization
func TestServerLifecycle_ComponentInitialization(t *testing.T) {
	t.Run("server initializes correct components", func(t *testing.T) {
		server, graphqlServer := newTestServer(t, "localhost:0")
		defer graphqlServer.Close()

		err := server.Start()
		require.NoError(t, err)

		// Verify components are initialized
		assert.NotNil(t, server.operationRegistry, "operation registry should be initialized")
		assert.NotNil(t, server.rpcHandler, "rpc handler should be initialized")

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})

	t.Run("http server is configured correctly", func(t *testing.T) {
		server, graphqlServer := newTestServer(t, "localhost:50052")
		defer graphqlServer.Close()

		err := server.Start()
		require.NoError(t, err)

		// Verify HTTP server configuration - existence and basic setup
		assert.NotNil(t, server.httpServer)
		assert.Equal(t, "localhost:50052", server.httpServer.Addr)
		assert.NotNil(t, server.httpServer.Handler)
		// Verify timeouts are set (non-zero) but don't pin exact values
		assert.Greater(t, server.httpServer.ReadTimeout, time.Duration(0), "ReadTimeout should be configured")
		assert.Greater(t, server.httpServer.WriteTimeout, time.Duration(0), "WriteTimeout should be configured")
		assert.Greater(t, server.httpServer.IdleTimeout, time.Duration(0), "IdleTimeout should be configured")

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})
}

// TestServerLifecycle_StateTransitions tests state transitions
func TestServerLifecycle_StateTransitions(t *testing.T) {
	t.Run("service names remain consistent through reload", func(t *testing.T) {
		server, graphqlServer := newTestServer(t, "localhost:0")
		defer graphqlServer.Close()

		err := server.Start()
		require.NoError(t, err)

		namesBeforeReload := server.GetServiceNames()
		require.NotEmpty(t, namesBeforeReload)

		err = server.Reload()
		require.NoError(t, err)

		namesAfterReload := server.GetServiceNames()
		assert.ElementsMatch(t, namesBeforeReload, namesAfterReload, "service names should remain consistent")

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})
}

// TestServerLifecycle_GracefulShutdown tests graceful shutdown behavior
func TestServerLifecycle_GracefulShutdown(t *testing.T) {
	t.Run("stop respects context deadline", func(t *testing.T) {
		server, graphqlServer := newTestServer(t, "localhost:0")
		defer graphqlServer.Close()

		err := server.Start()
		require.NoError(t, err)

		// Use a reasonable timeout
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		startTime := time.Now()
		err = server.Stop(ctx)
		duration := time.Since(startTime)

		assert.NoError(t, err)
		assert.Less(t, duration, 10*time.Second, "stop should complete within timeout")
	})
}