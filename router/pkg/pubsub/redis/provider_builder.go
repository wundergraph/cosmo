package redis

import (
	"context"
	"fmt"

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
	}
}

// TypeID returns the provider type ID
func (b *ProviderBuilder) TypeID() string {
	return providerTypeID
}

// DataSource creates a Redis PubSub data source for the given event configuration
func (b *ProviderBuilder) BuildEngineDataSourceFactory(data *nodev1.RedisEventConfiguration, providers map[string]datasource.Provider) (datasource.EngineDataSourceFactory, error) {
	providerId := data.GetEngineEventConfiguration().GetProviderId()
	provider, ok := providers[providerId]
	if !ok {
		return nil, fmt.Errorf("failed to get adapter for provider %s with ID %s", b.TypeID(), providerId)
	}

	var eventType EventType
	switch data.GetEngineEventConfiguration().GetType() {
	case nodev1.EventType_PUBLISH:
		eventType = EventTypePublish
	case nodev1.EventType_SUBSCRIBE:
		eventType = EventTypeSubscribe
	default:
		return nil, fmt.Errorf("unsupported event type: %s", data.GetEngineEventConfiguration().GetType())
	}

	return &EngineDataSourceFactory{
		fieldName:    data.GetEngineEventConfiguration().GetFieldName(),
		eventType:    eventType,
		channels:     data.GetChannels(),
		providerId:   providerId,
		RedisAdapter: provider,
		logger:       b.logger,
	}, nil
}

// Providers returns the Redis PubSub providers for the given provider IDs
func (b *ProviderBuilder) BuildProvider(provider config.RedisEventSource, providerOpts datasource.ProviderOpts) (datasource.Provider, error) {
	adapter := NewProviderAdapter(b.ctx, b.logger, provider.URLs, provider.ClusterEnabled, providerOpts)
	eventBuilder := func(data []byte) datasource.MutableStreamEvent {
		return &MutableEvent{Data: data}
	}

	pubSubProvider := datasource.NewPubSubProvider(provider.ID, providerTypeID, adapter, b.logger, eventBuilder)

	return pubSubProvider, nil
}
