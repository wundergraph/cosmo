package connectrpc

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"go.uber.org/zap"
)

func TestNewServer(t *testing.T) {
	t.Run("creates server with valid config", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			ListenAddr:      "localhost:50051",
			Mode:            HandlerModeDynamic,
			Logger:          zap.NewNop(),
		})

		require.NoError(t, err)
		assert.NotNil(t, server)
		assert.Equal(t, "testdata", server.config.ProtoDir)
		assert.Equal(t, "http://localhost:4000/graphql", server.config.GraphQLEndpoint)
		assert.Equal(t, HandlerModeDynamic, server.config.Mode)
	})

	t.Run("adds protocol to endpoint if missing", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: "localhost:4000/graphql",
			Mode:            HandlerModeDynamic,
		})

		require.NoError(t, err)
		assert.Equal(t, "http://localhost:4000/graphql", server.config.GraphQLEndpoint)
	})

	t.Run("uses default listen address", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata/employee_only",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Mode:            HandlerModeDynamic,
		})

		require.NoError(t, err)
		assert.Equal(t, "0.0.0.0:50051", server.config.ListenAddr)
	})

	t.Run("uses default mode", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: "http://localhost:4000/graphql",
		})

		require.NoError(t, err)
		assert.Equal(t, HandlerModeDynamic, server.config.Mode)
	})

	t.Run("uses default timeout", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: "http://localhost:4000/graphql",
		})

		require.NoError(t, err)
		assert.Equal(t, 30*time.Second, server.config.RequestTimeout)
	})

	t.Run("returns error when proto dir is empty", func(t *testing.T) {
		_, err := NewServer(ServerConfig{
			GraphQLEndpoint: "http://localhost:4000/graphql",
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "proto directory cannot be empty")
	})

	t.Run("returns error when graphql endpoint is empty", func(t *testing.T) {
		_, err := NewServer(ServerConfig{
			ProtoDir: "testdata",
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "graphql endpoint cannot be empty")
	})

	t.Run("uses nop logger when nil", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Logger:          nil,
		})

		require.NoError(t, err)
		assert.NotNil(t, server.logger)
	})
}

func TestServer_Start(t *testing.T) {
	t.Run("starts server successfully in dynamic mode", func(t *testing.T) {
		// Create a mock GraphQL server
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0", // Use random port
			Mode:            HandlerModeDynamic,
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)

		// Verify components are initialized
		assert.NotNil(t, server.protoLoader)
		assert.NotNil(t, server.operationBuilder)
		assert.NotNil(t, server.rpcHandler)
		assert.NotNil(t, server.vanguardService)
		assert.NotNil(t, server.transcoder)
		assert.NotNil(t, server.httpServer)

		// Cleanup
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})

	t.Run("starts server successfully in predefined mode", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Mode:            HandlerModePredefined,
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)

		// Verify components are initialized
		assert.NotNil(t, server.protoLoader)
		assert.NotNil(t, server.operationRegistry)
		assert.NotNil(t, server.rpcHandler)
		assert.NotNil(t, server.vanguardService)

		// Cleanup
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})

	t.Run("returns error when proto directory is invalid", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ProtoDir:        "/nonexistent/directory",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "failed to load proto files")
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
			ProtoDir:        "testdata",
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
}

func TestServer_Reload(t *testing.T) {
	t.Run("reloads server successfully", func(t *testing.T) {
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

		// Reload with nil schema (dynamic mode doesn't need schema)
		err = server.Reload(nil)
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

	t.Run("reloads with schema in predefined mode", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Mode:            HandlerModePredefined,
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)

		// Create a simple schema
		schema := &ast.Document{}

		err = server.Reload(schema)
		assert.NoError(t, err)

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
			ProtoDir:        "testdata/employee_only",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		// Before start
		assert.Equal(t, 0, server.GetServiceCount())

		err = server.Start()
		require.NoError(t, err)

		// After start - should have exactly 1 service from employee_only directory
		assert.Equal(t, 1, server.GetServiceCount())

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
			ProtoDir:        "testdata/employee_only",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		// Before start
		assert.Nil(t, server.GetServiceNames())

		err = server.Start()
		require.NoError(t, err)

		// After start - should have exactly 1 service from employee_only directory
		names := server.GetServiceNames()
		assert.Len(t, names, 1, "Should have exactly one service from employee_only directory")
		assert.Contains(t, names, "employee.v1.EmployeeService")

		// Cleanup
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})
}

func TestServer_GetMode(t *testing.T) {
	t.Run("returns correct mode", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Mode:            HandlerModeDynamic,
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		// Before start
		assert.Equal(t, HandlerMode(""), server.GetMode())

		err = server.Start()
		require.NoError(t, err)

		// After start
		assert.Equal(t, HandlerModeDynamic, server.GetMode())

		// Cleanup
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})
}

func TestServer_GetOperationCount(t *testing.T) {
	t.Run("returns operation count in dynamic mode", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Mode:            HandlerModeDynamic,
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)

		// Should return count of methods in proto services
		count := server.GetOperationCount()
		assert.Greater(t, count, 0)

		// Cleanup
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})
}

func TestServer_InitializeComponents(t *testing.T) {
	t.Run("initializes dynamic mode components", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Mode:            HandlerModeDynamic,
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		// Load protos first
		server.protoLoader = NewProtoLoader(zap.NewNop())
		err = server.protoLoader.LoadFromDirectory("testdata")
		require.NoError(t, err)

		err = server.initializeComponents()
		require.NoError(t, err)

		assert.NotNil(t, server.operationBuilder)
		assert.NotNil(t, server.rpcHandler)
		assert.NotNil(t, server.operationRegistry, "operation registry should be initialized in dynamic mode")
		assert.Greater(t, server.operationRegistry.Count(), 0, "operation registry should be pre-populated")
	})

	t.Run("initializes predefined mode components", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Mode:            HandlerModePredefined,
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		// Load protos first
		server.protoLoader = NewProtoLoader(zap.NewNop())
		err = server.protoLoader.LoadFromDirectory("testdata")
		require.NoError(t, err)

		err = server.initializeComponents()
		require.NoError(t, err)

		assert.NotNil(t, server.operationRegistry)
		assert.NotNil(t, server.rpcHandler)
		assert.Nil(t, server.operationBuilder)
	})

	t.Run("returns error for invalid mode", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ProtoDir:        "testdata",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		// Set invalid mode
		server.config.Mode = "invalid"

		// Load protos first
		server.protoLoader = NewProtoLoader(zap.NewNop())
		err = server.protoLoader.LoadFromDirectory("testdata")
		require.NoError(t, err)

		err = server.initializeComponents()
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid handler mode")
	})
}