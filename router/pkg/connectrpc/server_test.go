package connectrpc

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestNewServer(t *testing.T) {
	t.Run("creates server with valid config", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ServicesDir:     "testdata/services",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			ListenAddr:      "localhost:5026",
			Logger:          zap.NewNop(),
		})

		require.NoError(t, err)
		assert.NotNil(t, server)
		assert.Equal(t, "testdata/services", server.config.ServicesDir)
		assert.Equal(t, "http://localhost:4000/graphql", server.config.GraphQLEndpoint)
	})

	t.Run("uses default listen address", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ServicesDir:     "testdata/services",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Logger:          zap.NewNop(),
		})

		require.NoError(t, err)
		assert.Equal(t, "0.0.0.0:5026", server.config.ListenAddr)
	})

	t.Run("uses default timeout", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ServicesDir:     "testdata/services",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Logger:          zap.NewNop(),
		})

		require.NoError(t, err)
		assert.Equal(t, 30*time.Second, server.config.RequestTimeout)
	})

	t.Run("returns error when services dir is empty", func(t *testing.T) {
		_, err := NewServer(ServerConfig{
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Logger:          zap.NewNop(),
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "services directory must be provided")
	})

	t.Run("returns error when graphql endpoint is empty", func(t *testing.T) {
		_, err := NewServer(ServerConfig{
			ServicesDir: "testdata/services",
			Logger:      zap.NewNop(),
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "graphql endpoint cannot be empty")
	})

	t.Run("returns error when logger is nil", func(t *testing.T) {
		_, err := NewServer(ServerConfig{
			ServicesDir:     "testdata/services",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Logger:          nil,
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "logger is required")
	})
}
