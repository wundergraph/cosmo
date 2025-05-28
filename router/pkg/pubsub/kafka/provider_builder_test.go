package kafka

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap/zaptest"
)

// mockAdapter is a mock of AdapterInterface
type mockAdapter struct {
	mock.Mock
}

func (m *mockAdapter) Subscribe(ctx context.Context, event SubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {
	args := m.Called(ctx, event, updater)
	return args.Error(0)
}

func (m *mockAdapter) Publish(ctx context.Context, event PublishEventConfiguration) error {
	args := m.Called(ctx, event)
	return args.Error(0)
}

func (m *mockAdapter) Startup(ctx context.Context) error {
	args := m.Called(ctx)
	return args.Error(0)
}

func (m *mockAdapter) Shutdown(ctx context.Context) error {
	args := m.Called(ctx)
	return args.Error(0)
}

func TestBuildKafkaOptions(t *testing.T) {
	t.Run("basic configuration", func(t *testing.T) {
		cfg := config.KafkaEventSource{
			Brokers: []string{"localhost:9092"},
		}

		opts, err := buildKafkaOptions(cfg)
		require.NoError(t, err)
		require.NotEmpty(t, opts)
	})

	t.Run("with TLS", func(t *testing.T) {
		cfg := config.KafkaEventSource{
			Brokers: []string{"localhost:9092"},
			TLS: &config.KafkaTLSConfiguration{
				Enabled: true,
			},
		}

		opts, err := buildKafkaOptions(cfg)
		require.NoError(t, err)
		require.NotEmpty(t, opts)
		// Can't directly check for TLS options, but we can verify more options are present
		require.Equal(t, len(opts), 4)
	})

	t.Run("with auth", func(t *testing.T) {
		username := "user"
		password := "pass"
		cfg := config.KafkaEventSource{
			Brokers: []string{"localhost:9092"},
			Authentication: &config.KafkaAuthentication{
				SASLPlain: config.KafkaSASLPlainAuthentication{
					Username: &username,
					Password: &password,
				},
			},
		}

		opts, err := buildKafkaOptions(cfg)
		require.NoError(t, err)
		require.NotEmpty(t, opts)
		// Can't directly check for SASL options, but we can verify more options are present
		require.Greater(t, len(opts), 1)
	})
}

func TestPubSubProviderBuilderFactory(t *testing.T) {
	t.Run("creates provider with configured adapters", func(t *testing.T) {
		providerId := "test-provider"

		cfg := config.KafkaEventSource{
			ID:      providerId,
			Brokers: []string{"localhost:9092"},
		}

		logger := zaptest.NewLogger(t)

		ctx := context.Background()

		builder := NewPubSubProviderBuilder(ctx, logger, "host", "addr")
		require.NotNil(t, builder)
		provider, err := builder.BuildProvider(cfg)
		require.NoError(t, err)

		// Check the returned provider
		kafkaProvider, ok := provider.(*datasource.PubSubProviderImpl)
		require.True(t, ok)
		assert.NotNil(t, kafkaProvider.Logger)
		assert.NotNil(t, kafkaProvider.Adapter)
	})
}
