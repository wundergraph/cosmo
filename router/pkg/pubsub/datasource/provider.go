package datasource

import (
	"context"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

type PubSubProviderBuilderFactory func(ctx context.Context, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string) PubSubProviderBuilder

type ArgumentTemplateCallback func(tpl string) (string, error)

// PubSubProvider is the interface that the PubSub provider must implement
type PubSubProvider interface {
	// ID Get the provider ID as specified in the configuration
	ID() string
	// TypeID Get the provider type id (e.g. "kafka", "nats")
	TypeID() string
	// Startup is the method called when the provider is started
	Startup(ctx context.Context) error
	// Shutdown is the method called when the provider is shut down
	Shutdown(ctx context.Context) error
}

type EngineEventConfiguration interface {
	GetEngineEventConfiguration() *nodev1.EngineEventConfiguration
}

// PubSubProviderBuilder is the interface that the provider builder must implement.
type PubSubProviderBuilder interface {
	// TypeID Get the provider type id (e.g. "kafka", "nats")
	TypeID() string
	// Providers Build the providers and their adapters; if ids are empty, all providers are built
	Providers(ids []string) ([]PubSubProvider, error)
	// DataSource Build the data source for the given provider and event configuration
	DataSource(data EngineEventConfiguration) (PubSubDataSource, error)
	// EngineEventConfigurations Get the engine event configurations for the given data source configuration
	EngineEventConfigurations(in *nodev1.DataSourceConfiguration) []EngineEventConfiguration
}
