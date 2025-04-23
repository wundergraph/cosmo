package redis

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

func (m *mockAdapter) Publish(ctx context.Context, event PublishAndRequestEventConfiguration) error {
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

func TestGetProvider(t *testing.T) {
	t.Run("returns nil if no Redis configuration", func(t *testing.T) {
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
				Redis: []*nodev1.RedisEventConfiguration{
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
				Redis: []config.RedisEventSource{
					{ID: "provider1", URLs: []string{"redis://localhost:6379"}},
				},
			},
		}
		logger := zaptest.NewLogger(t)

		provider, err := GetProvider(ctx, in, dsMeta, cfg, logger, "host", "addr")
		require.Error(t, err)
		require.Nil(t, provider)
		assert.Contains(t, err.Error(), "failed to find redis provider with id")
	})

	t.Run("creates provider with configured adapters", func(t *testing.T) {
		providerId := "test-provider"

		in := &nodev1.DataSourceConfiguration{
			CustomEvents: &nodev1.DataSourceCustomEvents{
				Redis: []*nodev1.RedisEventConfiguration{
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
				Redis: []config.RedisEventSource{
					{ID: providerId, URLs: []string{"redis://localhost:6379"}},
				},
			},
		}

		logger := zaptest.NewLogger(t)

		// Create mock adapter for testing
		provider, err := GetProvider(context.Background(), in, &plan.DataSourceMetadata{}, cfg, logger, "host", "addr")
		require.NoError(t, err)
		require.NotNil(t, provider)

		// Check the returned provider
		redisProvider, ok := provider.(*Provider)
		require.True(t, ok)
		assert.NotNil(t, redisProvider.logger)
		assert.NotNil(t, redisProvider.adapter)
	})
}

func TestProvider_FindPubSubDataSource(t *testing.T) {
	mock := &mockAdapter{}
	providerId := "test-provider"
	typeName := "TestType"
	fieldName := "testField"

	provider := &Provider{
		adapter: mock,
		eventsConfig: []*nodev1.RedisEventConfiguration{
			{
				EngineEventConfiguration: &nodev1.EngineEventConfiguration{
					TypeName:   typeName,
					FieldName:  fieldName,
					ProviderId: providerId,
				},
			},
		},
		logger: zap.NewNop(),
	}

	t.Run("find matching datasource", func(t *testing.T) {
		ds, err := provider.FindPubSubDataSource(typeName, fieldName, nil)
		require.NoError(t, err)
		require.NotNil(t, ds)

		// Check the returned datasource
		redisDs, ok := ds.(*PubSubDataSource)
		require.True(t, ok)
		assert.Equal(t, mock, redisDs.RedisAdapter)
		assert.Equal(t, provider.eventsConfig[0], redisDs.EventConfiguration)
	})

	t.Run("return nil if no match", func(t *testing.T) {
		ds, err := provider.FindPubSubDataSource("OtherType", fieldName, nil)
		require.NoError(t, err)
		require.Nil(t, ds)
	})
}
