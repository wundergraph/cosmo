package kafka

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
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
	t.Run("errors if provider ID is empty", func(t *testing.T) {
		ctx := context.Background()
		cfg := config.KafkaEventSource{}
		logger := zaptest.NewLogger(t)

		builder := NewPubSubProviderBuilder(ctx, logger, "host", "addr")
		require.NotNil(t, builder)
		provider, err := builder.BuildProvider(cfg)
		require.Error(t, err)
		require.Nil(t, provider)
		assert.Contains(t, err.Error(), "provider ID is empty")
	})

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
		kafkaProvider, ok := provider.(*PubSubProvider)
		require.True(t, ok)
		assert.NotNil(t, kafkaProvider.Logger)
		assert.NotNil(t, kafkaProvider.Adapter)
	})
}

func TestPubSubProvider(t *testing.T) {
	mocked := &mockAdapter{}

	provider := &PubSubProvider{
		Logger:  zap.NewNop(),
		Adapter: mocked,
	}

	t.Run("calling Shutdown calls adapter Shutdown", func(t *testing.T) {
		mocked.On("Shutdown", context.Background()).Return(nil)
		err := provider.Shutdown(context.Background())
		require.NoError(t, err)
		mocked.AssertCalled(t, "Shutdown", context.Background())
	})

	t.Run("calling Startup calls adapter Startup", func(t *testing.T) {
		mocked.On("Startup", context.Background()).Return(nil)
		err := provider.Startup(context.Background())
		require.NoError(t, err)
		mocked.AssertCalled(t, "Startup", context.Background())
	})
}
