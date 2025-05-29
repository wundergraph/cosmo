package datasource

import (
	"context"
)

type ArgumentTemplateCallback func(tpl string) (string, error)

type Lifecycle interface {
	Startup(ctx context.Context) error
	Shutdown(ctx context.Context) error
}

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

// PubSubProviderBuilder is the interface that the provider builder must implement.
type PubSubProviderBuilder[P any, E any] interface {
	// TypeID Get the provider type id (e.g. "kafka", "nats")
	TypeID() string
	// BuildProvider Build the provider and the adapter
	BuildProvider(options P) (PubSubProvider, error)
	// BuildDataSource Build the data source for the given provider and event configuration
	BuildDataSource(data E) (PubSubDataSource, error)
}
