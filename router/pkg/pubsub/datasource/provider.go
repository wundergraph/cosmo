package datasource

import (
	"context"
	"fmt"
	"slices"
	"strconv"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"go.uber.org/zap"
)

type ProviderFactory func(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string) ([]PubSubProvider, []plan.DataSource, error)

type ArgumentTemplateCallback func(tpl string) (string, error)

type PubSubProvider interface {
	Id() string
	Startup(ctx context.Context) error
	Shutdown(ctx context.Context) error
}

type PubSubProviderBuilder[A any] interface {
	Id() string
	Providers(usedProviders []string) (map[string]A, []PubSubProvider, error)
	DataSource(data EngineEventConfiguration, adapters map[string]A) (PubSubDataSource, error)
}

func BuildProviderDataSources[A any](providerBuilder PubSubProviderBuilder[A], ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string, data []EngineEventConfiguration) ([]PubSubProvider, []plan.DataSource, error) {
	if len(data) == 0 {
		return nil, nil, nil
	}

	// Collect all used providers
	var usedProviders []string
	for _, event := range data {
		providerId := event.GetEngineEventConfiguration().GetProviderId()
		if !slices.Contains(usedProviders, providerId) {
			usedProviders = append(usedProviders, providerId)
		}
	}

	// Initialize used providers
	adapters, pubSubProviders, err := providerBuilder.Providers(usedProviders)
	if err != nil {
		return nil, nil, err
	}

	// Verify that all used providers are defined
	definedProviders := make([]string, 0, len(adapters))
	for providerID := range adapters {
		definedProviders = append(definedProviders, providerID)
	}
	for _, event := range data {
		if !slices.Contains(definedProviders, event.GetEngineEventConfiguration().GetProviderId()) {
			return nil, nil, fmt.Errorf(providerBuilder.Id()+" provider with ID %s is not defined", event.GetEngineEventConfiguration().GetProviderId())
		}
	}

	// Create data sources
	var outs []plan.DataSource
	for i, event := range data {
		pubsubDataSource, err := providerBuilder.DataSource(event, adapters)
		if err != nil {
			return nil, nil, err
		}
		out, err := plan.NewDataSourceConfiguration(
			in.Id+"-"+providerBuilder.Id()+"-"+strconv.Itoa(i),
			NewFactory(ctx, pubsubDataSource),
			GetFilteredDataSourceMetadata(event, dsMeta),
			pubsubDataSource,
		)
		if err != nil {
			return nil, nil, err
		}
		outs = append(outs, out)
	}

	return pubSubProviders, outs, nil
}
