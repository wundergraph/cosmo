package nats

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

func (p *PubSubProviderBuilder) GetMatcher(data []datasource.EngineEventConfiguration, adapters map[string]AdapterInterface) datasource.PubSubDataSourceMatcherFn {
	return func(typeName string, fieldName string, extractFn datasource.ArgumentTemplateCallback) (datasource.PubSubDataSource, error) {
		for _, event := range data {
			natsEvent, ok := event.(*nodev1.NatsEventConfiguration)
			if !ok {
				continue
			}

			if natsEvent.GetEngineEventConfiguration().GetTypeName() == typeName && natsEvent.GetEngineEventConfiguration().GetFieldName() == fieldName {
				transformedEventConfig, err := transformEventConfig(natsEvent, extractFn)
				if err != nil {
					return nil, fmt.Errorf("failed to transform event configuration for typeName: %s, fieldName: %s: %w", typeName, fieldName, err)
				}
				providerId := natsEvent.GetEngineEventConfiguration().GetProviderId()
				return &PubSubDataSource{
					EventConfiguration: transformedEventConfig,
					NatsAdapter:        adapters[providerId],
				}, nil
			}
		}
		return nil, fmt.Errorf("failed to find Nats event configuration for typeName: %s, fieldName: %s", typeName, fieldName)
	}
}

func (p *PubSubProviderBuilder) BuildProviders(usedProviders []string) (map[string]AdapterInterface, []datasource.PubSubProvider, error) {
	adapters := make(map[string]AdapterInterface)
	pubSubProviders := []datasource.PubSubProvider{}

	// create providers
	for _, provider := range p.config.Providers.Nats {
		if usedProviders != nil && !slices.Contains(usedProviders, provider.ID) {
			continue
		}
		adapter, pubSubProvider, err := buildProvider(p.ctx, provider, p.config, p.logger, p.hostName, p.routerListenAddr)
		if err != nil {
			return nil, nil, err
		}
		adapters[provider.ID] = adapter
		pubSubProviders = append(pubSubProviders, pubSubProvider)
	}

	return adapters, pubSubProviders, nil
}

func buildProvider(ctx context.Context, provider config.NatsEventSource, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string) (AdapterInterface, datasource.PubSubProvider, error) {
	options, err := buildNatsOptions(provider, logger)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to build options for Nats provider with ID \"%s\": %w", provider.ID, err)
	}
	adapter, err := NewAdapter(ctx, logger, provider.URL, options, hostName, routerListenAddr)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create adapter for Nats provider with ID \"%s\": %w", provider.ID, err)
	}
	pubSubProvider := &PubSubProvider{
		id:      provider.ID,
		Adapter: adapter,
		Logger:  logger,
	}

	return adapter, pubSubProvider, nil
}
