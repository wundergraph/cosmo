package redis

import (
	"context"
	"fmt"
	"slices"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"
)

// ProviderBuilder builds Redis PubSub providers
type PubSubProviderBuilder struct {
	ctx              context.Context
	logger           *zap.Logger
	config           []config.RedisEventSource
	hostName         string
	routerListenAddr string
	adapters         map[string]AdapterInterface
}

// NewProviderBuilder creates a new Redis PubSub provider builder
func NewPubSubProviderBuilder(
	ctx context.Context,
	config []config.RedisEventSource,
	logger *zap.Logger,
	hostName string,
	routerListenAddr string,
) *PubSubProviderBuilder {
	return &PubSubProviderBuilder{
		ctx:              ctx,
		config:           config,
		logger:           logger,
		hostName:         hostName,
		routerListenAddr: routerListenAddr,
		adapters:         make(map[string]AdapterInterface),
	}
}

// TypeID returns the provider type ID
func (b *PubSubProviderBuilder) TypeID() string {
	return providerTypeID
}

// Providers returns the Redis PubSub providers for the given provider IDs
func (b *PubSubProviderBuilder) Providers(ids []string) ([]datasource.PubSubProvider, error) {
	b.adapters = make(map[string]AdapterInterface)
	var providers []datasource.PubSubProvider

	if len(ids) == 0 {
		return providers, nil
	}

	// Create providers for each requested ID
	for _, provider := range b.config {
		if !slices.Contains(ids, provider.ID) {
			continue
		}

		adapter := NewAdapter(b.logger, provider.URLs)
		if err := adapter.Startup(b.ctx); err != nil {
			return nil, fmt.Errorf("failed to start Redis adapter for provider with ID \"%s\": %w", provider.ID, err)
		}

		pubSubProvider := &Provider{
			id:      provider.ID,
			adapter: adapter,
		}
		b.adapters[provider.ID] = adapter
		providers = append(providers, pubSubProvider)
	}

	// Check that all requested providers were found
	for _, id := range ids {
		if _, ok := b.adapters[id]; !ok {
			return nil, fmt.Errorf("%s provider with ID %s is not defined", b.TypeID(), id)
		}
	}

	return providers, nil
}

// DataSource creates a Redis PubSub data source for the given event configuration
func (b *PubSubProviderBuilder) DataSource(data datasource.EngineEventConfiguration) (datasource.PubSubDataSource, error) {
	redisEvent, ok := data.(*nodev1.RedisEventConfiguration)
	if !ok {
		return nil, fmt.Errorf("failed to cast data to RedisEventConfiguration")
	}
	providerId := redisEvent.GetEngineEventConfiguration().GetProviderId()
	return &PubSubDataSource{
		EventConfiguration: redisEvent,
		RedisAdapter:       b.adapters[providerId],
	}, nil
}

// EngineEventConfigurations returns an empty slice since Redis is not yet in proto
func (b *PubSubProviderBuilder) EngineEventConfigurations(in *nodev1.DataSourceConfiguration) []datasource.EngineEventConfiguration {
	redisData := make([]datasource.EngineEventConfiguration, 0, len(in.GetCustomEvents().GetRedis()))
	for _, redisEvent := range in.GetCustomEvents().GetRedis() {
		redisData = append(redisData, redisEvent)
	}

	return redisData
}

// PubSubProviderBuilderFactory creates a Redis PubSub provider builder
func PubSubProviderBuilderFactory(
	ctx context.Context,
	config config.EventsConfiguration,
	logger *zap.Logger,
	hostName string,
	routerListenAddr string,
) datasource.PubSubProviderBuilder {
	return &PubSubProviderBuilder{
		ctx:              ctx,
		config:           config.Providers.Redis,
		logger:           logger,
		hostName:         hostName,
		routerListenAddr: routerListenAddr,
	}
}
