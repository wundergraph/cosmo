package connectrpc

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestNewServer(t *testing.T) {
	t.Run("creates server with valid config", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ServicesDir:     "testdata",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			ListenAddr:      "localhost:5026",
			Logger:          zap.NewNop(),
		})

		require.NoError(t, err)
		assert.NotNil(t, server)
		assert.Equal(t, "testdata", server.config.ServicesDir)
		assert.Equal(t, "http://localhost:4000/graphql", server.config.GraphQLEndpoint)
	})

	t.Run("adds protocol to endpoint if missing", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ServicesDir:     "testdata",
			GraphQLEndpoint: "localhost:4000/graphql",
		})

		require.NoError(t, err)
		assert.Equal(t, "http://localhost:4000/graphql", server.config.GraphQLEndpoint)
	})

	t.Run("uses default listen address", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ServicesDir:     "testdata",
			GraphQLEndpoint: "http://localhost:4000/graphql",
		})

		require.NoError(t, err)
		assert.Equal(t, "0.0.0.0:5026", server.config.ListenAddr)
	})

	t.Run("uses default timeout", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ServicesDir:     "testdata",
			GraphQLEndpoint: "http://localhost:4000/graphql",
		})

		require.NoError(t, err)
		assert.Equal(t, 30*time.Second, server.config.RequestTimeout)
	})

	t.Run("returns error when services dir is empty", func(t *testing.T) {
		_, err := NewServer(ServerConfig{
			GraphQLEndpoint: "http://localhost:4000/graphql",
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "services directory must be provided")
	})

	t.Run("returns error when graphql endpoint is empty", func(t *testing.T) {
		_, err := NewServer(ServerConfig{
			ServicesDir: "testdata",
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "graphql endpoint cannot be empty")
	})

	t.Run("uses nop logger when nil", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ServicesDir:     "testdata",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Logger:          nil,
		})

		require.NoError(t, err)
		assert.NotNil(t, server.logger)
	})
}

func TestServer_Start(t *testing.T) {
	t.Run("starts server successfully", func(t *testing.T) {
		// Create a mock GraphQL server
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ServicesDir:     "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0", // Use random port
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)

		// Verify components are initialized
		assert.NotNil(t, server.protoLoader)
		assert.NotNil(t, server.rpcHandler)
		assert.NotNil(t, server.vanguardService)
		assert.NotNil(t, server.transcoder)
		assert.NotNil(t, server.httpServer)

		// Cleanup
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})

	t.Run("returns error when services directory is invalid", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ServicesDir:     "/nonexistent/directory",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "failed to discover services")
	})
}

func TestServer_Stop(t *testing.T) {
	t.Run("stops server successfully", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ServicesDir:     "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		err = server.Stop(ctx)
		assert.NoError(t, err)
	})

	t.Run("returns error when server not started", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ServicesDir:     "testdata",
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

func TestServer_Reload(t *testing.T) {
	t.Run("reloads server successfully", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ServicesDir:     "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)

		// Reload
		err = server.Reload()
		assert.NoError(t, err)

		// Verify components are reinitialized
		assert.NotNil(t, server.protoLoader)
		assert.NotNil(t, server.rpcHandler)
		assert.NotNil(t, server.vanguardService)
		assert.NotNil(t, server.transcoder)

		// Cleanup
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})

}

func TestServer_GetServiceCount(t *testing.T) {
	t.Run("returns service count after start", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ServicesDir:     "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		// Before start
		assert.Equal(t, 0, server.GetServiceCount())

		err = server.Start()
		require.NoError(t, err)

		// After start - should have at least 1 service
		assert.GreaterOrEqual(t, server.GetServiceCount(), 1)

		// Cleanup
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})
}

func TestServer_GetServiceNames(t *testing.T) {
	t.Run("returns service names after start", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ServicesDir:     "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		// Before start
		assert.Nil(t, server.GetServiceNames())

		err = server.Start()
		require.NoError(t, err)

		// After start - should have at least 1 service
		names := server.GetServiceNames()
		assert.GreaterOrEqual(t, len(names), 1, "Should have at least one service")
		assert.Contains(t, names, "employee.v1.EmployeeService")

		// Cleanup
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})
}

func TestServer_GetOperationCount(t *testing.T) {
	t.Run("returns operation count", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ServicesDir:     "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)

		// Operation count depends on discovered operations
		count := server.GetOperationCount()
		assert.GreaterOrEqual(t, count, 0)

		// Cleanup
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})
}

func TestServer_InitializeComponents(t *testing.T) {
	t.Run("initializes components", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ServicesDir:     "testdata",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		// Load protos first
		server.protoLoader = NewProtoLoader(zap.NewNop())
		err = server.protoLoader.LoadFromDirectory("testdata/employee_only")
		require.NoError(t, err)

		err = server.initializeComponents()
		require.NoError(t, err)

		assert.NotNil(t, server.rpcHandler)
		assert.NotNil(t, server.operationRegistry)
	})
}