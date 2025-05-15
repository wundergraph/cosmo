package kafka

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
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

func TestGetProvider(t *testing.T) {
	t.Run("returns nil if no Kafka configuration", func(t *testing.T) {
		ctx := context.Background()
		in := &nodev1.DataSourceConfiguration{
			CustomEvents: &nodev1.DataSourceCustomEvents{},
		}

		dsMeta := &plan.DataSourceMetadata{}
		cfg := config.EventsConfiguration{}
		logger := zaptest.NewLogger(t)

		provider, _, err := BuildProvidersAndDataSources(ctx, in, dsMeta, cfg, logger, "host", "addr")
		require.NoError(t, err)
		require.Nil(t, provider)
	})

	t.Run("errors if provider not found", func(t *testing.T) {
		ctx := context.Background()
		in := &nodev1.DataSourceConfiguration{
			CustomEvents: &nodev1.DataSourceCustomEvents{
				Kafka: []*nodev1.KafkaEventConfiguration{
					{
						EngineEventConfiguration: &nodev1.EngineEventConfiguration{
							ProviderId: "unknown",
						},
					},
				},
			},
		}

		dsMeta := &plan.DataSourceMetadata{}
		cfg := config.EventsConfiguration{
			Providers: config.EventProviders{
				Kafka: []config.KafkaEventSource{
					{ID: "provider1", Brokers: []string{"localhost:9092"}},
				},
			},
		}
		logger := zaptest.NewLogger(t)

		provider, _, err := BuildProvidersAndDataSources(ctx, in, dsMeta, cfg, logger, "host", "addr")
		require.Error(t, err)
		require.Nil(t, provider)
		assert.Contains(t, err.Error(), "provider with ID unknown is not defined")
	})

	t.Run("creates provider with configured adapters", func(t *testing.T) {
		providerId := "test-provider"

		in := &nodev1.DataSourceConfiguration{
			CustomEvents: &nodev1.DataSourceCustomEvents{
				Kafka: []*nodev1.KafkaEventConfiguration{
					{
						EngineEventConfiguration: &nodev1.EngineEventConfiguration{
							ProviderId: providerId,
						},
					},
				},
			},
		}

		cfg := config.EventsConfiguration{
			Providers: config.EventProviders{
				Kafka: []config.KafkaEventSource{
					{ID: providerId, Brokers: []string{"localhost:9092"}},
				},
			},
		}

		logger := zaptest.NewLogger(t)

		// Create a mock adapter for testing
		provider, _, err := BuildProvidersAndDataSources(context.Background(), in, &plan.DataSourceMetadata{}, cfg, logger, "host", "addr")
		require.NoError(t, err)
		require.NotNil(t, provider)

		// Check the returned provider
		kafkaProvider, ok := provider[0].(*PubSubProvider)
		require.True(t, ok)
		assert.NotNil(t, kafkaProvider.Logger)
		assert.NotNil(t, kafkaProvider.Adapter)
	})
}

func TestPubSubProvider_FindPubSubDataSource(t *testing.T) {
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
