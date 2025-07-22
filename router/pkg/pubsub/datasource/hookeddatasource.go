package datasource

import (
	"github.com/cespare/xxhash/v2"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type HookedSubscriptionDataSource struct {
	OnSubscriptionStartFns []OnSubscriptionStartFn
	SubscriptionDataSource PubSubSubscriptionDataSource
}

func (h *HookedSubscriptionDataSource) OnSubscriptionStart(ctx *resolve.Context, input []byte) (close bool, err error) {
	for _, fn := range h.OnSubscriptionStartFns {
		events, close, err := fn(ctx, h.SubscriptionDataSource.SubscriptionEventConfiguration(input))
		if err != nil {
			return close, err
		}
		for _, event := range events {
			ctx.EmitSubscriptionUpdate(event.GetData())
		}
		// if close is true, the subscription should be close, so there is no need to call the next hook
		if close {
			return true, nil
		}
	}

	return false, nil
}

func (h *HookedSubscriptionDataSource) Start(ctx *resolve.Context, input []byte, updater resolve.SubscriptionUpdater) error {
	return h.SubscriptionDataSource.Start(ctx, input, NewSubscriptionEventUpdater(updater))
}

func (h *HookedSubscriptionDataSource) UniqueRequestID(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) (err error) {
	return h.SubscriptionDataSource.UniqueRequestID(ctx, input, xxh)
}
