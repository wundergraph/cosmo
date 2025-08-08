package datasource

import (
	"context"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type SubscriptionOnStartFn func(ctx *resolve.Context, subConf SubscriptionEventConfiguration) (bool, error)

type OnPublishEventsFn func(ctx context.Context, pubConf PublishEventConfiguration, evts []StreamEvent) ([]StreamEvent, error)

type OnStreamEventsFn func(ctx context.Context, subConf SubscriptionEventConfiguration, evts []StreamEvent) ([]StreamEvent, error)

// Hooks contains hooks for the pubsub providers and data sources
type Hooks struct {
	SubscriptionOnStart []SubscriptionOnStartFn
	OnStreamEvents      []OnStreamEventsFn
	OnPublishEvents     []OnPublishEventsFn
}
