package pubsub

import (
	"context"

	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/nats"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

var additionalProviders []datasource.ProviderFactory

// RegisterAdditionalProvider registers an additional PubSub provider
func RegisterAdditionalProvider(provider datasource.ProviderFactory) {
	additionalProviders = append(additionalProviders, provider)
}

// GetProviderFactories returns a list of all PubSub implementations
func GetProviderFactories() []datasource.ProviderFactory {
	return append([]datasource.ProviderFactory{
		kafka.GetProvider,
		nats.GetProvider,
	}, additionalProviders...)
}

func GetProviderDataSources(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string) ([]datasource.PubSubProvider, []plan.DataSource, error) {
	datasources := []plan.DataSource{}
	providers := []datasource.PubSubProvider{}
	for _, providerFactory := range GetProviderFactories() {
		providerProviders, providerDataSources, err := providerFactory(
			ctx,
			in,
			dsMeta,
			config,
			logger,
			hostName,
			routerListenAddr,
		)
		if err != nil {
			return nil, nil, err
		}
		providers = append(providers, providerProviders...)
		datasources = append(datasources, providerDataSources...)
	}
	return providers, datasources, nil
}
