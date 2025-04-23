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
	if in.CustomEvents == nil || len(in.CustomEvents.Redis) == 0 {
		return nil, nil
	}

	provider := &Provider{
		logger:           logger,
		executionCtx:     ctx,
		hostName:         hostName,
		routerListenAddr: routerListenAddr,
		eventsConfig:     in.CustomEvents.Redis,
	}

	var found bool
	providerID := ""
	for _, event := range in.CustomEvents.Redis {
		providerID = event.GetEngineEventConfiguration().GetProviderId()
		if providerID == "" {
			continue
		}
		for _, redisConfig := range config.Providers.Redis {
			if strings.EqualFold(redisConfig.ID, providerID) {
				provider.adapter = NewAdapter(logger, redisConfig.URLs, redisConfig.ClusterEnabled)
				found = true
				break
			}
		}
		if found {
			break
		}
	}

	if !found {
		return nil, fmt.Errorf("failed to find redis provider with id: %s", providerID)
	}

	return provider, nil
}

// Provider for Redis
type Provider struct {
	adapter          AdapterInterface
	eventsConfig     []*nodev1.RedisEventConfiguration
	logger           *zap.Logger
	executionCtx     context.Context
	hostName         string
	routerListenAddr string
}

// Startup initializes the adapter
func (p *Provider) Startup(ctx context.Context) error {
	return p.adapter.Startup(ctx)
}

// Shutdown closes the Redis client
func (p *Provider) Shutdown(ctx context.Context) error {
	return p.adapter.Shutdown(ctx)
}

// FindPubSubDataSource finds a matching event configuration based on typeName and fieldName
func (p *Provider) FindPubSubDataSource(typeName string, fieldName string, extractFn datasource.ArgumentTemplateCallback) (datasource.PubSubDataSource, error) {
	for _, config := range p.eventsConfig {
		engineConfig := config.GetEngineEventConfiguration()
		if engineConfig == nil {
			continue
		}

		if engineConfig.TypeName != "" && !strings.EqualFold(engineConfig.TypeName, typeName) {
			continue
		}

		if engineConfig.FieldName != "" && !strings.EqualFold(engineConfig.FieldName, fieldName) {
			continue
		}

		return &PubSubDataSource{
			EventConfiguration: config,
			RedisAdapter:       p.adapter,
		}, nil
	}

	return nil, nil
}
