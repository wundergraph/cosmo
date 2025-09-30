package nats

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap/zaptest"
)

func TestBuildNatsOptions(t *testing.T) {
	t.Run("basic configuration", func(t *testing.T) {
		cfg := config.NatsEventSource{
			ID:  "test-nats",
			URL: "nats://localhost:4222",
		}
		logger := zaptest.NewLogger(t)

		opts, err := buildNatsOptions(cfg, logger)
		require.NoError(t, err)
		require.NotEmpty(t, opts)
	})

	t.Run("with token authentication", func(t *testing.T) {
		token := "test-token"
		cfg := config.NatsEventSource{
			ID:  "test-nats",
			URL: "nats://localhost:4222",
			Authentication: &config.NatsAuthentication{
				NatsTokenBasedAuthentication: config.NatsTokenBasedAuthentication{
					Token: &token,
				},
			},
		}
		logger := zaptest.NewLogger(t)

		opts, err := buildNatsOptions(cfg, logger)
		require.NoError(t, err)
		require.NotEmpty(t, opts)
		// Can't directly check for token options, but we can verify options are present
		require.Greater(t, len(opts), 7) // Basic options (7) + token option
	})

	t.Run("with user/password authentication", func(t *testing.T) {
		username := "user"
		password := "pass"
		cfg := config.NatsEventSource{
			ID:  "test-nats",
			URL: "nats://localhost:4222",
			Authentication: &config.NatsAuthentication{
				UserInfo: config.NatsCredentialsAuthentication{
					Username: &username,
					Password: &password,
				},
			},
		}
		logger := zaptest.NewLogger(t)

		opts, err := buildNatsOptions(cfg, logger)
		require.NoError(t, err)
		require.NotEmpty(t, opts)
		// Can't directly check for auth options, but we can verify options are present
		require.Greater(t, len(opts), 7) // Basic options (7) + user info option
	})
}

func TestPubSubProviderBuilderFactory(t *testing.T) {
	t.Run("creates provider with configured adapters", func(t *testing.T) {
		providerId := "test-provider"

		cfg := config.NatsEventSource{
			ID:  providerId,
			URL: "nats://localhost:4222",
		}

		logger := zaptest.NewLogger(t)

		ctx := context.Background()

		builder := NewProviderBuilder(ctx, logger, "host", "addr")
		require.NotNil(t, builder)
		provider, err := builder.BuildProvider(cfg)
		require.NoError(t, err)

		// Check the returned provider
		natsProvider, ok := provider.(*datasource.PubSubProvider)
		require.True(t, ok)
		assert.NotNil(t, natsProvider.Logger)
		assert.NotNil(t, natsProvider.Adapter)
	})
}
