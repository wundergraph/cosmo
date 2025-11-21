package datasource

import (
	"context"
	"iter"
	"slices"

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

// ProviderType represents the type of pubsub provider.
type ProviderType string

const (
	ProviderTypeNats  ProviderType = "nats"
	ProviderTypeKafka ProviderType = "kafka"
	ProviderTypeRedis ProviderType = "redis"
)

// StreamEvents is a list of stream events coming from or going to event providers.
type StreamEvents struct {
	evts []StreamEvent
}

// All is an iterator, which can be used to iterate through all events.
func (e StreamEvents) All() iter.Seq2[int, StreamEvent] {
	return slices.All(e.evts)
}

// Len returns the number of events.
func (e StreamEvents) Len() int {
	return len(e.evts)
}

// Unsafe returns the underlying slice of stream events.
// This slice is not thread safe and should not be modified directly.
func (e StreamEvents) Unsafe() []StreamEvent {
	return e.evts
}

func NewStreamEvents(evts []StreamEvent) StreamEvents {
	return StreamEvents{evts: evts}
}

// A StreamEvent is a single event coming from or going to an event provider.
type StreamEvent interface {
	// GetData returns the payload data of the event.
	GetData() []byte
	// Clone returns a mutable copy of the event.
	Clone() MutableStreamEvent
	// Decode efficiently unmarshalls StreamEvent into v.
	// v needs to be a pointer to an object.
	//
	// It ensures unmarshalling happens only once per type of v on this event.
	// It's best suited to be used when multiple routines need to decode the same event.
	Decode(v any) error
}

// A MutableStreamEvent is a stream event that can be modified.
type MutableStreamEvent interface {
	StreamEvent
	// SetData sets the data of the event.
	// It evicts the decode cache used by Decode() to avoid stale cache results.
	SetData([]byte)
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
