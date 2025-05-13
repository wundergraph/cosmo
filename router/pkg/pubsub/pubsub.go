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

// getProviderFactories returns a list of all PubSub implementations
func getProviderFactories() []datasource.ProviderFactory {
	return []datasource.ProviderFactory{
		kafka.GetProvider,
		nats.GetProvider,
	}
}

func GetProvidersDataSources(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string) ([]datasource.PubSubProvider, []plan.DataSource, error) {
	datasources := []plan.DataSource{}
	providers := []datasource.PubSubProvider{}
	for _, providerFactory := range getProviderFactories() {
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
