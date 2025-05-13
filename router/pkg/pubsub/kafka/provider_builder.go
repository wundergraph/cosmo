package kafka

import (
	"context"
	"fmt"
	"slices"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"
)

var _ datasource.PubSubProviderBuilder[AdapterInterface] = &PubSubProviderBuilder{}

type PubSubProviderBuilder struct {
	ctx              context.Context
	config           config.EventsConfiguration
	logger           *zap.Logger
	hostName         string
	routerListenAddr string
}

func (p *PubSubProviderBuilder) Id() string {
	return providerId
}

func (p *PubSubProviderBuilder) DataSource(data datasource.EngineEventConfiguration, adapters map[string]AdapterInterface) (datasource.PubSubDataSource, error) {
	kafkaEvent, ok := data.(*nodev1.KafkaEventConfiguration)
	if !ok {
		return nil, fmt.Errorf("failed to cast data to KafkaEventConfiguration")
	}
	providerId := kafkaEvent.GetEngineEventConfiguration().GetProviderId()
	return &PubSubDataSource{
		EventConfiguration: kafkaEvent,
		KafkaAdapter:       adapters[providerId],
	}, nil
}

func (p *PubSubProviderBuilder) Providers(usedProviders []string) (map[string]AdapterInterface, []datasource.PubSubProvider, error) {
	adapters := make(map[string]AdapterInterface)
	pubSubProviders := []datasource.PubSubProvider{}

	// create providers
	for _, provider := range p.config.Providers.Kafka {
		if usedProviders != nil && !slices.Contains(usedProviders, provider.ID) {
			continue
		}
		adapter, pubSubProvider, err := buildProvider(p.ctx, provider, p.logger)
		if err != nil {
			return nil, nil, err
		}
		adapters[provider.ID] = adapter
		pubSubProviders = append(pubSubProviders, pubSubProvider)
	}

	return adapters, pubSubProviders, nil
}

func buildProvider(ctx context.Context, provider config.KafkaEventSource, logger *zap.Logger) (AdapterInterface, datasource.PubSubProvider, error) {
	options, err := buildKafkaOptions(provider)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to build options for Kafka provider with ID \"%s\": %w", provider.ID, err)
	}
	adapter, err := NewAdapter(ctx, logger, options)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create adapter for Kafka provider with ID \"%s\": %w", provider.ID, err)
	}
	pubSubProvider := &PubSubProvider{
		id:      provider.ID,
		Adapter: adapter,
		Logger:  logger,
	}

	return adapter, pubSubProvider, nil
}
