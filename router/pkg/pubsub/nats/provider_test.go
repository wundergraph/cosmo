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
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
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

func TestGetProvider(t *testing.T) {
	t.Run("returns nil if no NATS configuration", func(t *testing.T) {
		ctx := context.Background()
		in := &nodev1.DataSourceConfiguration{
			CustomEvents: &nodev1.DataSourceCustomEvents{},
		}

		dsMeta := &plan.DataSourceMetadata{}
		cfg := config.EventsConfiguration{}
		logger := zaptest.NewLogger(t)

		provider, err := GetProvider(ctx, in, dsMeta, cfg, logger, "host", "addr")
		require.NoError(t, err)
		require.Nil(t, provider)
	})

	t.Run("errors if provider not found", func(t *testing.T) {
		ctx := context.Background()
		in := &nodev1.DataSourceConfiguration{
			CustomEvents: &nodev1.DataSourceCustomEvents{
				Nats: []*nodev1.NatsEventConfiguration{
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
				Nats: []config.NatsEventSource{
					{ID: "provider1", URL: "nats://localhost:4222"},
				},
			},
		}
		logger := zaptest.NewLogger(t)

		provider, err := GetProvider(ctx, in, dsMeta, cfg, logger, "host", "addr")
		require.Error(t, err)
		require.Nil(t, provider)
		assert.Contains(t, err.Error(), "failed to find Nats provider with ID")
	})
}

func TestPubSubProvider_FindPubSubDataSource(t *testing.T) {
	mockNats := &mockAdapter{}
	providerId := "test-provider"
	typeName := "TestType"
	fieldName := "testField"

	provider := &PubSubProvider{
		EventConfiguration: []*nodev1.NatsEventConfiguration{
			{
				EngineEventConfiguration: &nodev1.EngineEventConfiguration{
					TypeName:   typeName,
					FieldName:  fieldName,
					ProviderId: providerId,
					Type:       nodev1.EventType_PUBLISH,
				},
				Subjects: []string{"test.subject"},
			},
		},
		Logger: zap.NewNop(),
		Providers: map[string]AdapterInterface{
			providerId: mockNats,
		},
	}

	t.Run("find matching datasource", func(t *testing.T) {
		// Identity transform function
		transformFn := func(s string) (string, error) {
			return s, nil
		}

		ds, err := provider.FindPubSubDataSource(typeName, fieldName, transformFn)
		require.NoError(t, err)
		require.NotNil(t, ds)

		// Check the returned datasource
		natsDs, ok := ds.(*PubSubDataSource)
		require.True(t, ok)
		assert.Equal(t, mockNats, natsDs.NatsAdapter)
		assert.Equal(t, provider.EventConfiguration[0], natsDs.EventConfiguration)
	})

	t.Run("return nil if no match", func(t *testing.T) {
		ds, err := provider.FindPubSubDataSource("OtherType", fieldName, nil)
		require.NoError(t, err)
		require.Nil(t, ds)
	})

	t.Run("handle error in transform function", func(t *testing.T) {
		// Function that returns error
		errorFn := func(s string) (string, error) {
			return "", assert.AnError
		}

		ds, err := provider.FindPubSubDataSource(typeName, fieldName, errorFn)
		require.Error(t, err)
		require.Nil(t, ds)
	})

	t.Run("handle error in transform function", func(t *testing.T) {
		// Function that returns error
		errorFn := func(s string) (string, error) {
			return "", assert.AnError
		}

		ds, err := provider.FindPubSubDataSource(typeName, fieldName, errorFn)
		require.Error(t, err)
		require.Nil(t, ds)
	})

	t.Run("handle error in transform function with invalid subject", func(t *testing.T) {
		// Function that returns error
		errorFn := func(s string) (string, error) {
			return " ", nil
		}

		ds, err := provider.FindPubSubDataSource(typeName, fieldName, errorFn)
		require.Error(t, err)
		require.Nil(t, ds)
	})
}
