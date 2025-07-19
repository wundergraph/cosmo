package datasource

import (
	"github.com/cespare/xxhash/v2"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type HookedSubscriptionDataSource struct {
	OnSubscriptionStartFns []OnSubscriptionStartFn
	SubscriptionDataSource PubSubSubscriptionDataSource
}

func (h *HookedSubscriptionDataSource) Start(ctx *resolve.Context, input []byte, updater resolve.SubscriptionUpdater) error {
	subscriptionEventUpdater := NewSubscriptionEventUpdater(updater)
	for _, fn := range h.OnSubscriptionStartFns {
		events, err := fn(ctx, h.SubscriptionDataSource.SubscriptionEventConfiguration(input))
		if err != nil {
			return err
		}
		for _, event := range events {
			subscriptionEventUpdater.Update(event)
		}
	}
	return h.SubscriptionDataSource.Start(ctx, input, subscriptionEventUpdater)
}

func (h *HookedSubscriptionDataSource) UniqueRequestID(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) (err error) {
	return h.SubscriptionDataSource.UniqueRequestID(ctx, input, xxh)
}
