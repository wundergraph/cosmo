package redis

import (
	"context"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"
)

const providerTypeID = "redis"

// ProviderBuilder builds Redis PubSub providers
type PubSubProviderBuilder struct {
	ctx              context.Context
	logger           *zap.Logger
	hostName         string
	routerListenAddr string
	adapters         map[string]AdapterInterface
}

// NewProviderBuilder creates a new Redis PubSub provider builder
func NewPubSubProviderBuilder(
	ctx context.Context,
	logger *zap.Logger,
	hostName string,
	routerListenAddr string,
) *PubSubProviderBuilder {
	return &PubSubProviderBuilder{
		ctx:              ctx,
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
func (b *PubSubProviderBuilder) BuildProvider(provider config.RedisEventSource) (datasource.PubSubProvider, error) {
	adapter := NewAdapter(b.logger, provider.URLs)
	pubSubProvider := datasource.NewPubSubProviderImpl(provider.ID, providerTypeID, adapter, b.logger)
	b.adapters[provider.ID] = adapter

	return pubSubProvider, nil
}

// DataSource creates a Redis PubSub data source for the given event configuration
func (b *PubSubProviderBuilder) BuildDataSource(event *nodev1.RedisEventConfiguration) (datasource.PubSubDataSource, error) {
	providerId := event.GetEngineEventConfiguration().GetProviderId()
	return &PubSubDataSource{
		EventConfiguration: event,
		RedisAdapter:       b.adapters[providerId],
	}, nil
}
