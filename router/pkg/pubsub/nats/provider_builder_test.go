package nats

import (
	"context"
	"io"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
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

func (m *mockAdapter) Publish(ctx context.Context, event PublishAndRequestEventConfiguration) error {
	args := m.Called(ctx, event)
	return args.Error(0)
}

func (m *mockAdapter) Request(ctx context.Context, event PublishAndRequestEventConfiguration, w io.Writer) error {
	args := m.Called(ctx, event, w)
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

func TestTransformEventConfig(t *testing.T) {
	t.Run("publish event", func(t *testing.T) {
		cfg := &nodev1.NatsEventConfiguration{
			EngineEventConfiguration: &nodev1.EngineEventConfiguration{
				Type: nodev1.EventType_PUBLISH,
			},
			Subjects: []string{"original.subject"},
		}

		// Simple transform function that adds "transformed." prefix
		transformFn := func(s string) (string, error) {
			return "transformed." + s, nil
		}

		transformedCfg, err := transformEventConfig(cfg, transformFn)
		require.NoError(t, err)
		require.Equal(t, []string{"transformed.original.subject"}, transformedCfg.Subjects)
	})

	t.Run("subscribe event", func(t *testing.T) {
		cfg := &nodev1.NatsEventConfiguration{
			EngineEventConfiguration: &nodev1.EngineEventConfiguration{
				Type: nodev1.EventType_SUBSCRIBE,
			},
			Subjects: []string{"original.subject1", "original.subject2"},
		}

		// Simple transform function that adds "transformed." prefix
		transformFn := func(s string) (string, error) {
			return "transformed." + s, nil
		}

		transformedCfg, err := transformEventConfig(cfg, transformFn)
		require.NoError(t, err)
		// Since the function sorts the subjects
		require.Equal(t, []string{"transformed.original.subject1", "transformed.original.subject2"}, transformedCfg.Subjects)
	})

	t.Run("invalid subject", func(t *testing.T) {
		cfg := &nodev1.NatsEventConfiguration{
			EngineEventConfiguration: &nodev1.EngineEventConfiguration{
				Type: nodev1.EventType_PUBLISH,
			},
			Subjects: []string{"invalid subject with spaces"},
		}

		transformFn := func(s string) (string, error) {
			return s, nil
		}

		_, err := transformEventConfig(cfg, transformFn)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "invalid subject")
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

		builder := NewPubSubProviderBuilder(ctx, logger, "host", "addr")
		require.NotNil(t, builder)
		provider, err := builder.BuildProvider(cfg)
		require.NoError(t, err)

		// Check the returned provider
		natsProvider, ok := provider.(*PubSubProvider)
		require.True(t, ok)
		assert.NotNil(t, natsProvider.Logger)
		assert.NotNil(t, natsProvider.Adapter)
	})
}

func TestPubSubProvider_FindPubSubDataSource(t *testing.T) {
	mockNats := &mockAdapter{}

	provider := &PubSubProvider{
		Logger:  zap.NewNop(),
		Adapter: mockNats,
	}

	t.Run("calling Startup", func(t *testing.T) {
		mockNats.On("Startup", context.Background()).Return(nil)
		err := provider.Startup(context.Background())
		require.NoError(t, err)
		mockNats.AssertCalled(t, "Startup", context.Background())
	})

	t.Run("calling Shutdown", func(t *testing.T) {
		mockNats.On("Shutdown", context.Background()).Return(nil)
		err := provider.Shutdown(context.Background())
		require.NoError(t, err)
		mockNats.AssertCalled(t, "Shutdown", context.Background())
	})
}
