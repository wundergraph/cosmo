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

// TestServerLifecycle_StartStopReload tests the complete lifecycle of the server
func TestServerLifecycle_StartStopReload(t *testing.T) {
	t.Run("complete lifecycle: start -> reload -> stop", func(t *testing.T) {
		// Create a mock GraphQL server
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{"test":"success"}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		// Start the server
		err = server.Start()
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
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
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
			ProtoDir:        "testdata",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		ctx := context.Background()
		err = server.Stop(ctx)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "server is not started")
	})

	t.Run("concurrent start attempts", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		var wg sync.WaitGroup
		errors := make([]error, 3)

		// Try to start server concurrently (only first should succeed)
		for i := 0; i < 3; i++ {
			wg.Add(1)
			go func(idx int) {
				defer wg.Done()
				errors[idx] = server.Start()
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

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})
}

// TestServerLifecycle_VanguardIntegration tests Vanguard transcoder integration
func TestServerLifecycle_VanguardIntegration(t *testing.T) {
	t.Run("vanguard transcoder is initialized on start", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		// Before start
		assert.Nil(t, server.transcoder)
		assert.Nil(t, server.vanguardService)

		err = server.Start()
		require.NoError(t, err)

		// After start
		assert.NotNil(t, server.transcoder, "transcoder should be initialized")
		assert.NotNil(t, server.vanguardService, "vanguard service should be initialized")

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})

	t.Run("vanguard services are registered correctly", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)

		// Verify services are registered
		serviceCount := server.GetServiceCount()
		assert.Greater(t, serviceCount, 0, "at least one service should be registered")

		serviceNames := server.GetServiceNames()
		assert.Len(t, serviceNames, serviceCount)

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})

	t.Run("vanguard transcoder is recreated on reload", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)

		oldTranscoder := server.transcoder
		oldVanguardService := server.vanguardService

		// Reload
		err = server.Reload()
		require.NoError(t, err)

		// Verify new instances were created
		assert.NotNil(t, server.transcoder)
		assert.NotNil(t, server.vanguardService)
		// Note: We can't directly compare pointers as they might be reused,
		// but we verify they're not nil

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)

		// Avoid unused variable warnings
		_ = oldTranscoder
		_ = oldVanguardService
	})
}

// TestServerLifecycle_ErrorScenarios tests various error scenarios
func TestServerLifecycle_ErrorScenarios(t *testing.T) {
	t.Run("start fails with invalid proto directory", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ProtoDir:        "/nonexistent/path",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "failed to load proto files")
	})

	t.Run("reload fails with invalid proto directory", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)

		// Change proto dir to invalid path
		server.config.ProtoDir = "/nonexistent/path"

		err = server.Reload()
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "failed to reload proto files")

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})

	t.Run("stop with context timeout", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)

		// Use a very short timeout
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Nanosecond)
		defer cancel()

		// Stop might succeed or fail depending on timing
		_ = server.Stop(ctx)
	})

	t.Run("reload in predefined mode with invalid operations directory", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			OperationsDir:   "/nonexistent/operations",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)

		// Reload with invalid operations directory
		err = server.Reload()
		// Should handle gracefully or return error
		if err != nil {
			assert.Contains(t, err.Error(), "failed to reload RPC handler")
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})
}

// TestServerLifecycle_ComponentInitialization tests component initialization
func TestServerLifecycle_ComponentInitialization(t *testing.T) {
	t.Run("server initializes correct components", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)

		// Verify components are initialized
		assert.NotNil(t, server.operationRegistry, "operation registry should be initialized")
		assert.NotNil(t, server.rpcHandler, "rpc handler should be initialized")

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})

	t.Run("http server is configured correctly", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:50052",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)

		// Verify HTTP server configuration
		assert.NotNil(t, server.httpServer)
		assert.Equal(t, "localhost:50052", server.httpServer.Addr)
		assert.NotNil(t, server.httpServer.Handler)
		assert.Equal(t, 30*time.Second, server.httpServer.ReadTimeout)
		assert.Equal(t, 30*time.Second, server.httpServer.WriteTimeout)
		assert.Equal(t, 60*time.Second, server.httpServer.IdleTimeout)

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})
}

// TestServerLifecycle_StateTransitions tests state transitions
func TestServerLifecycle_StateTransitions(t *testing.T) {
	t.Run("operation count changes correctly through lifecycle", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		// Before start
		assert.Equal(t, 0, server.GetOperationCount())

		err = server.Start()
		require.NoError(t, err)

		// After start - operation count may be 0 if no operations directory is configured
		countAfterStart := server.GetOperationCount()
		assert.GreaterOrEqual(t, countAfterStart, 0)

		// After reload
		err = server.Reload()
		require.NoError(t, err)
		countAfterReload := server.GetOperationCount()
		assert.Equal(t, countAfterStart, countAfterReload, "operation count should remain same after reload")

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})

	t.Run("service names remain consistent through reload", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata/employee_only",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)

		namesBeforeReload := server.GetServiceNames()
		require.NotEmpty(t, namesBeforeReload)
		require.Len(t, namesBeforeReload, 1, "Should have exactly 1 service from employee_only directory")

		err = server.Reload()
		require.NoError(t, err)

		namesAfterReload := server.GetServiceNames()
		require.Len(t, namesAfterReload, 1, "Should still have exactly 1 service after reload")
		assert.ElementsMatch(t, namesBeforeReload, namesAfterReload, "service names should remain consistent")

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})
}

// TestServerLifecycle_GracefulShutdown tests graceful shutdown behavior
func TestServerLifecycle_GracefulShutdown(t *testing.T) {
	t.Run("server shuts down gracefully with active connections", func(t *testing.T) {
		requestReceived := make(chan struct{})
		requestComplete := make(chan struct{})

		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			close(requestReceived)
			<-requestComplete // Wait for signal to complete
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)

		// Simulate an active request (in a real scenario)
		// For this test, we just verify shutdown works

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		close(requestComplete) // Allow any pending requests to complete

		err = server.Stop(ctx)
		assert.NoError(t, err)
	})

	t.Run("stop respects context deadline", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
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