package datasource

import (
	"context"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type SubscriptionOnStartFn func(ctx resolve.StartupHookContext, subConf SubscriptionEventConfiguration, eventBuilder EventBuilderFn) error

type OnPublishEventsFn func(ctx context.Context, pubConf PublishEventConfiguration, evts []StreamEvent, eventBuilder EventBuilderFn) ([]StreamEvent, error)

type OnReceiveEventsFn func(ctx context.Context, subConf SubscriptionEventConfiguration, eventBuilder EventBuilderFn, evts []StreamEvent) ([]StreamEvent, error)

// Hooks contains hooks for the pubsub providers and data sources
type Hooks struct {
	SubscriptionOnStart            []SubscriptionOnStartFn
	OnReceiveEvents                []OnReceiveEventsFn
	OnPublishEvents                []OnPublishEventsFn
	MaxConcurrentOnReceiveHandlers int
}
