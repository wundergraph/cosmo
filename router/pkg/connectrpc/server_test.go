package connectrpc

import (
	"context"
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

func TestServer_GetServiceInfo(t *testing.T) {
	t.Run("returns consistent service count and names", func(t *testing.T) {
		server, graphqlServer := newTestServer(t, "localhost:0")
		defer graphqlServer.Close()

		// Before start
		assert.Equal(t, 0, server.GetServiceCount())
		assert.Empty(t, server.GetServiceNames())

		err := server.Start()
		require.NoError(t, err)

		// After start - verify count and names are consistent
		count := server.GetServiceCount()
		names := server.GetServiceNames()
		
		assert.GreaterOrEqual(t, count, 1, "should have at least one service")
		assert.Len(t, names, count, "service names length should match count")
		assert.NotEmpty(t, names, "service names should not be empty")

		// Cleanup
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	})
}