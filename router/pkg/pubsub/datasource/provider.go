package datasource

import (
	"context"

	"github.com/wundergraph/cosmo/router/pkg/metric"
)

type ArgumentTemplateCallback func(tpl string) (string, error)

// Lifecycle is the interface that the provider must implement
// to allow the router to start and stop the provider
type Lifecycle interface {
	// Startup is the method called when the provider is started
	Startup(ctx context.Context) error
	// Shutdown is the method called when the provider is shut down
	Shutdown(ctx context.Context) error
}

// Adapter is the interface that the provider must implement
// to implement the basic functionality
type Adapter interface {
	Lifecycle
	Subscribe(ctx context.Context, cfg SubscriptionEventConfiguration, updater SubscriptionEventUpdater) error
	Publish(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent) error
}

// Provider is the interface that the PubSub provider must implement
type Provider interface {
	Adapter
	// ID Get the provider ID as specified in the configuration
	ID() string
	// TypeID Get the provider type id (e.g. "kafka", "nats")
	TypeID() string
	// SetHooks Set the hooks
	SetHooks(Hooks)
}

// ProviderBuilder is the interface that the provider builder must implement.
type ProviderBuilder[P, E any] interface {
	// TypeID Get the provider type id (e.g. "kafka", "nats")
	TypeID() string
	// BuildProvider Build the provider and the adapter
	BuildProvider(options P, providerOpts ProviderOpts) (Provider, error)
	// BuildEngineDataSourceFactory Build the data source for the given provider and event configuration
	BuildEngineDataSourceFactory(data E, providers map[string]Provider) (EngineDataSourceFactory, error)
}

// ProviderType represents the type of pubsub provider
type ProviderType string

const (
	ProviderTypeNats  ProviderType = "nats"
	ProviderTypeKafka ProviderType = "kafka"
	ProviderTypeRedis ProviderType = "redis"
)

// StreamEvents is a slice which contains original stream events.
// Be careful when modifying this as it might be shared with other
// handlers and can cause unwanted side effects and race conditions.
// Use Clone() to avoid this.
type StreamEvents []StreamEvent

// Clone returns a deep copy of s.
func (s StreamEvents) Clone() StreamEvents {
	res := make(StreamEvents, len(s))
	for i := range s {
		res[i] = s[i].Clone()
	}
	return res
}

// StreamEvent is a generic interface for all stream events
// Each provider will have its own event type that implements this interface
// there could be other common fields in the future, but for now we only have data
type StreamEvent interface {
	GetData() []byte
	Clone() StreamEvent
}

// SubscriptionEventConfiguration is the interface that all subscription event configurations must implement
type SubscriptionEventConfiguration interface {
	ProviderID() string
	ProviderType() ProviderType
	RootFieldName() string // the root field name of the subscription in the schema
}

// PublishEventConfiguration is the interface that all publish event configurations must implement
type PublishEventConfiguration interface {
	ProviderID() string
	ProviderType() ProviderType
	RootFieldName() string // the root field name of the mutation in the schema
}

type ProviderOpts struct {
	StreamMetricStore metric.StreamMetricStore
}
