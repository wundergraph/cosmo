package datasource

import (
	"github.com/cespare/xxhash/v2"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type HookedSubscriptionDataSource struct {
	OnSubscriptionStartFns []OnSubscriptionStartFn
	SubscriptionDataSource SubscriptionDataSourceWithConfiguration
}

func (h *HookedSubscriptionDataSource) Start(ctx *resolve.Context, input []byte, updater resolve.SubscriptionUpdater) error {
	for _, fn := range h.OnSubscriptionStartFns {
		err, events := fn(ctx, h.SubscriptionDataSource.SubscriptionEventConfiguration(input))
		if err != nil {
			return err
		}
		for _, event := range events {
			updater.Update(event.GetData())
		}
	}
	return h.SubscriptionDataSource.Start(ctx, input, updater)
}

func (h *HookedSubscriptionDataSource) UniqueRequestID(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) (err error) {
	return h.SubscriptionDataSource.UniqueRequestID(ctx, input, xxh)
}
