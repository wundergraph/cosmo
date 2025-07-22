package datasource

import (
	"github.com/cespare/xxhash/v2"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type HookedSubscriptionDataSource struct {
	OnSubscriptionStartFns []OnSubscriptionStartFn
	SubscriptionDataSource PubSubSubscriptionDataSource
}

func (h *HookedSubscriptionDataSource) OnSubscriptionStart(ctx *resolve.Context, input []byte) (err error) {
	for _, fn := range h.OnSubscriptionStartFns {
		events, err := fn(ctx, h.SubscriptionDataSource.SubscriptionEventConfiguration(input))
		if err != nil {
			return err
		}
		for _, event := range events {
			ctx.EmitSubscriptionUpdate(event.GetData())
		}
	}

	return nil
}

func (h *HookedSubscriptionDataSource) Start(ctx *resolve.Context, input []byte, updater resolve.SubscriptionUpdater) error {
	return h.SubscriptionDataSource.Start(ctx, input, NewSubscriptionEventUpdater(updater))
}

func (h *HookedSubscriptionDataSource) UniqueRequestID(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) (err error) {
	return h.SubscriptionDataSource.UniqueRequestID(ctx, input, xxh)
}
