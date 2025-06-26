package redis

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap/zaptest"
)

func TestBuildRedisOptions(t *testing.T) {
	t.Run("basic configuration", func(t *testing.T) {
		cfg := config.RedisEventSource{
			URLs: []string{"redis://localhost:6379"},
		}

		// Test that the provider can be built
		logger := zaptest.NewLogger(t)
		ctx := context.Background()
		builder := NewProviderBuilder(ctx, logger, "host", "addr")
		provider, err := builder.BuildProvider(cfg)

		require.NoError(t, err)
		require.NotNil(t, provider)
		assert.Equal(t, cfg.ID, provider.ID())
		assert.Equal(t, providerTypeID, provider.TypeID())
	})

	t.Run("with cluster enabled", func(t *testing.T) {
		cfg := config.RedisEventSource{
			ID:   "redis-with-cluster",
			URLs: []string{"redis://localhost:6379"},
		}

		// Test that the provider can be built
		logger := zaptest.NewLogger(t)
		ctx := context.Background()
		builder := NewProviderBuilder(ctx, logger, "host", "addr")
		provider, err := builder.BuildProvider(cfg)

		require.NoError(t, err)
		require.NotNil(t, provider)
		assert.Equal(t, cfg.ID, provider.ID())
		assert.Equal(t, providerTypeID, provider.TypeID())
	})
}

func TestPubSubProviderBuilderFactory(t *testing.T) {
	t.Run("creates provider with configured adapters", func(t *testing.T) {
		providerId := "test-provider"

		cfg := config.RedisEventSource{
			ID:   providerId,
			URLs: []string{"redis://localhost:6379"},
		}

		logger := zaptest.NewLogger(t)

		ctx := context.Background()

		builder := NewProviderBuilder(ctx, logger, "host", "addr")
		require.NotNil(t, builder)
		provider, err := builder.BuildProvider(cfg)
		require.NoError(t, err)

		// Check the returned provider
		redisProvider, ok := provider.(*datasource.PubSubProvider)
		require.True(t, ok)
		assert.NotNil(t, redisProvider.Logger)
		assert.NotNil(t, redisProvider.Adapter)
	})
}
