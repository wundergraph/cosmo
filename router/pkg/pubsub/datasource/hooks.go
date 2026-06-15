package datasource

import (
	"context"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type SubscriptionOnStartFn func(ctx resolve.StartupHookContext, subConf SubscriptionEventConfiguration, eventBuilder EventBuilderFn) error

type OnPublishEventsFn func(ctx context.Context, pubConf PublishEventConfiguration, evts []StreamEvent, eventBuilder EventBuilderFn) ([]StreamEvent, error)

type OnReceiveEventsFn func(subscriptionCtx context.Context, updaterCtx context.Context, subConf SubscriptionEventConfiguration, eventBuilder EventBuilderFn, evts []StreamEvent) ([]StreamEvent, error)

// SubscriptionBeforeTriggerFn is called before the subscription trigger is created.
// It receives the current subscription config and may return a modified one.
// A returned error fails the subscription and is propagated to the client.
type SubscriptionBeforeTriggerFn func(ctx context.Context, subConf SubscriptionEventConfiguration) (SubscriptionEventConfiguration, error)

// Hooks contains hooks for the pubsub providers and data sources
type Hooks struct {
	SubscriptionOnStart       SubscriptionOnStartHooks
	OnPublishEvents           OnPublishEventsHooks
	OnReceiveEvents           OnReceiveEventsHooks
	SubscriptionBeforeTrigger SubscriptionBeforeTriggerHooks
}

// SubscriptionBeforeTriggerHooks contains hooks that run before a subscription trigger is created
type SubscriptionBeforeTriggerHooks struct {
	Handlers []SubscriptionBeforeTriggerFn
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
