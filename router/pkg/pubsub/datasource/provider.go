package datasource

import (
	"context"
)

type ArgumentTemplateCallback func(tpl string) (string, error)

type ProviderLifecycle interface {
	// Startup is the method called when the provider is started
	Startup(ctx context.Context) error
	// Shutdown is the method called when the provider is shut down
	Shutdown(ctx context.Context) error
}

// Provider is the interface that the PubSub provider must implement
type Provider interface {
	ProviderLifecycle
	// ID Get the provider ID as specified in the configuration
	ID() string
	// TypeID Get the provider type id (e.g. "kafka", "nats")
	TypeID() string
}

// ProviderBuilder is the interface that the provider builder must implement.
type ProviderBuilder[P, E any] interface {
	// TypeID Get the provider type id (e.g. "kafka", "nats")
	TypeID() string
	// BuildProvider Build the provider and the adapter
	BuildProvider(options P) (Provider, error)
	// BuildEngineDataSourceFactory Build the data source for the given provider and event configuration
	BuildEngineDataSourceFactory(data E) (EngineDataSourceFactory, error)
}
