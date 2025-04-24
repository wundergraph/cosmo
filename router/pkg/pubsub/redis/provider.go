package redis

import (
	"context"
	"fmt"
	"strings"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"go.uber.org/zap"
)

// GetProvider returns a provider factory for Redis
func GetProvider(ctx context.Context, in *nodev1.DataSourceConfiguration, _ *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string) (datasource.PubSubProvider, error) {
	redisData := in.GetCustomEvents().GetRedis()
	if len(redisData) == 0 {
		return nil, nil
	}

	definedProviders := make(map[string]bool)
	for _, provider := range config.Providers.Redis {
		definedProviders[provider.ID] = true
	}
	usedProviders := make(map[string]bool)
	for _, event := range redisData {
		if _, found := definedProviders[event.EngineEventConfiguration.ProviderId]; !found {
			return nil, fmt.Errorf("failed to find Redis provider with ID %s", event.EngineEventConfiguration.ProviderId)
		}
		usedProviders[event.EngineEventConfiguration.ProviderId] = true
	}

	provider := &PubSubProvider{
		logger:           logger,
		executionCtx:     ctx,
		hostName:         hostName,
		routerListenAddr: routerListenAddr,
		eventsConfig:     redisData,
	}

	providerID := ""
	for _, event := range redisData {
		providerID = event.GetEngineEventConfiguration().GetProviderId()
		if providerID == "" {
			continue
		}
		for _, redisConfig := range config.Providers.Redis {
			if strings.EqualFold(redisConfig.ID, providerID) {
				provider.adapter = NewAdapter(logger, redisConfig.URLs, redisConfig.ClusterEnabled)
				return provider, nil
			}
		}
	}

	return nil, nil
}

// PubSubProvider for Redis
type PubSubProvider struct {
	adapter          AdapterInterface
	eventsConfig     []*nodev1.RedisEventConfiguration
	logger           *zap.Logger
	executionCtx     context.Context
	hostName         string
	routerListenAddr string
}

// Startup initializes the adapter
func (p *PubSubProvider) Startup(ctx context.Context) error {
	return p.adapter.Startup(ctx)
}

// Shutdown closes the Redis client
func (p *PubSubProvider) Shutdown(ctx context.Context) error {
	return p.adapter.Shutdown(ctx)
}

// FindPubSubDataSource finds a matching event configuration based on typeName and fieldName
func (p *PubSubProvider) FindPubSubDataSource(typeName string, fieldName string, extractFn datasource.ArgumentTemplateCallback) (datasource.PubSubDataSource, error) {
	for _, config := range p.eventsConfig {
		if config.GetEngineEventConfiguration().GetTypeName() == typeName && config.GetEngineEventConfiguration().GetFieldName() == fieldName {
			return &PubSubDataSource{
				EventConfiguration: config,
				RedisAdapter:       p.adapter,
			}, nil
		}
	}

	return nil, nil
}
