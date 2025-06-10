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
type ProviderBuilder struct {
	ctx              context.Context
	logger           *zap.Logger
	hostName         string
	routerListenAddr string
	adapters         map[string]Adapter
}

// NewProviderBuilder creates a new Redis PubSub provider builder
func NewProviderBuilder(
	ctx context.Context,
	logger *zap.Logger,
	hostName string,
	routerListenAddr string,
) *ProviderBuilder {
	return &ProviderBuilder{
		ctx:              ctx,
		logger:           logger,
		hostName:         hostName,
		routerListenAddr: routerListenAddr,
		adapters:         make(map[string]Adapter),
	}
}

// TypeID returns the provider type ID
func (b *ProviderBuilder) TypeID() string {
	return providerTypeID
}

// DataSource creates a Redis PubSub data source for the given event configuration
func (b *ProviderBuilder) BuildEngineDataSourceFactory(event *nodev1.RedisEventConfiguration) (datasource.EngineDataSourceFactory, error) {
	providerId := event.GetEngineEventConfiguration().GetProviderId()
	return &EngineDataSourceFactory{
		RedisAdapter: b.adapters[providerId],
		fieldName:    event.GetEngineEventConfiguration().GetFieldName(),
		eventType:    EventTypePublish,
		channels:     event.GetChannels(),
		providerId:   providerId,
	}, nil
}

// Providers returns the Redis PubSub providers for the given provider IDs
func (b *ProviderBuilder) BuildProvider(provider config.RedisEventSource) (datasource.Provider, error) {
	adapter := NewProviderAdapter(b.ctx, b.logger, provider.URLs, provider.ClusterEnabled)
	pubSubProvider := datasource.NewPubSubProvider(provider.ID, providerTypeID, adapter, b.logger)
	b.adapters[provider.ID] = adapter

	return pubSubProvider, nil
}
