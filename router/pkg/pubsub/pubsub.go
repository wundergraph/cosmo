package pubsub

import (
	"context"
	"fmt"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
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

// GetDataSourceFromConfig returns a new plan.DataSource from the given configuration,
// using the registered PubSub providers.
func GetDataSourceFromConfig(
	ctx context.Context,
	in *nodev1.DataSourceConfiguration,
	dsMeta *plan.DataSourceMetadata,
	config config.EventsConfiguration,
	logger *zap.Logger,
	hostName string,
	routerListenAddr string,
) (plan.DataSource, error) {
	var providers []datasource.PubSubProvider

	for _, providerFactory := range GetProviderFactories() {
		provider, err := providerFactory(ctx, in, dsMeta, config, logger, hostName, routerListenAddr)
		if err != nil {
			return nil, err
		}
		if provider != nil {
			providers = append(providers, provider)
		}
	}

	if len(providers) == 0 {
		return nil, fmt.Errorf("no pubsub data sources found for data source %s", in.Id)
	}

	ds, err := plan.NewDataSourceConfiguration(
		in.Id,
		datasource.NewFactory(ctx, config, providers),
		dsMeta,
		providers,
	)
	if err != nil {
		return nil, err
	}

	return ds, nil
}
