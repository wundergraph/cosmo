package datasource

import (
	"context"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"go.uber.org/zap"
)

type ProvidersAndDataSourcesBuilder func(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string) ([]PubSubProvider, []plan.DataSource, error)

type ArgumentTemplateCallback func(tpl string) (string, error)

// PubSubProvider is the interface that the PubSub provider must implement
type PubSubProvider interface {
	// ID Get the provider ID as specified in the configuration
	ID() string
	// Startup is the method called when the provider is started
	Startup(ctx context.Context) error
	// Shutdown is the method called when the provider is shut down
	Shutdown(ctx context.Context) error
}

type EngineEventConfiguration interface {
	GetEngineEventConfiguration() *nodev1.EngineEventConfiguration
}

// PubSubProviderBuilder is the interface that the provider builder must implement.
type PubSubProviderBuilder[A any] interface {
	// TypeID Get the provider type id (e.g. "kafka", "nats")
	TypeID() string
	// Providers Build the providers and their adapters
	Providers(usedProviders []string) (map[string]A, []PubSubProvider, error)
	// DataSource Build the data source for the given provider and event configuration
	DataSource(data EngineEventConfiguration, adapters map[string]A) (PubSubDataSource, error)
}
