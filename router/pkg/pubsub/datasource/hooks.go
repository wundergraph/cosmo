package datasource

import (
	"context"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type SubscriptionOnStartFn func(ctx resolve.StartupHookContext, subConf SubscriptionEventConfiguration, eventBuilder EventBuilderFn) error

type OnPublishEventsFn func(ctx context.Context, pubConf PublishEventConfiguration, evts []StreamEvent, eventBuilder EventBuilderFn) ([]StreamEvent, error)

type OnReceiveEventsFn func(subscriptionCtx context.Context, updaterCtx context.Context, subConf SubscriptionEventConfiguration, eventBuilder EventBuilderFn, evts []StreamEvent) ([]StreamEvent, error)

// OnBroadcastEventsFn is called once per received batch, before any per-subscriber fan-out.
// Unlike OnReceiveEventsFn it runs on the broadcast path (not per active subscriber), so it
// does not force the serial per-subscriber delivery path. It has no per-subscriber request
// context. Returned events replace the batch for all subscribers.
type OnBroadcastEventsFn func(ctx context.Context, subConf SubscriptionEventConfiguration, eventBuilder EventBuilderFn, evts []StreamEvent) ([]StreamEvent, error)

// AdapterMiddlewareFn optionally wraps a pubsub Adapter for the given provider before Subscribe is
// called, e.g. to transform events or stage bypass data in the adapter (so the engine only ever
// receives already-normalized data). Return inner unchanged to opt out. Invoked per subscription
// Start with the provider's ID.
type AdapterMiddlewareFn func(providerID string, inner Adapter) Adapter

// SubscriptionOnCreateFn is called before the subscription trigger is created.
// It receives the current subscription config and may return a modified one.
// Returning a non-nil error aborts the subscription.
type SubscriptionOnCreateFn func(ctx context.Context, subConf SubscriptionEventConfiguration) (SubscriptionEventConfiguration, error)

// Hooks contains hooks for the pubsub providers and data sources
type Hooks struct {
	SubscriptionOnCreate SubscriptionOnCreateHooks
	SubscriptionOnStart  SubscriptionOnStartHooks
	OnPublishEvents      OnPublishEventsHooks
	OnReceiveEvents      OnReceiveEventsHooks
	OnBroadcastEvents    OnBroadcastEventsHooks
	// AdapterMiddleware, when set, wraps each provider's Adapter before Subscribe (see AdapterMiddlewareFn).
	AdapterMiddleware AdapterMiddlewareFn
}

// SubscriptionOnCreateHooks contains hooks that run before a subscription trigger is created
type SubscriptionOnCreateHooks struct {
	Handlers []SubscriptionOnCreateFn
}

// SubscriptionOnStartHooks contains hooks with settings for subscription starts
type SubscriptionOnStartHooks struct {
	Handlers []SubscriptionOnStartFn
}

// OnPublishEventsHooks contains hooks with settings for event publishing
type OnPublishEventsHooks struct {
	Handlers []OnPublishEventsFn
}

// OnReceiveEventsHooks contains hooks with settings for event receiving
type OnReceiveEventsHooks struct {
	Handlers              []OnReceiveEventsFn
	MaxConcurrentHandlers int
	Timeout               time.Duration
}

// OnBroadcastEventsHooks contains hooks that run once per received batch on the broadcast path
type OnBroadcastEventsHooks struct {
	Handlers []OnBroadcastEventsFn
}
