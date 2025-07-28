package datasource

import (
	"context"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type hookedUpdater struct {
	ctx                            context.Context
	updater                        SubscriptionEventUpdater
	subscriptionEventConfiguration SubscriptionEventConfiguration
	OnStreamEventsFns              []OnStreamEventsFn
}

func (h *hookedUpdater) Update(events []StreamEvent) {
	var newEvents []StreamEvent
	var err error
	if len(h.OnStreamEventsFns) == 0 {
		h.updater.Update(events)
		return
	}

	for _, fn := range h.OnStreamEventsFns {
		newEvents, err = fn(h.ctx, h.subscriptionEventConfiguration, events)
		if err != nil {
			// TODO: do something with the error
			continue
		}
	}

	h.updater.Update(newEvents)
}

func (h *hookedUpdater) Complete() {
	h.updater.Complete()
}

func (h *hookedUpdater) Close(kind resolve.SubscriptionCloseKind) {
	h.updater.Close(kind)
}

func NewHookedProvider(provider Provider, onStreamEventsFns []OnStreamEventsFn, onPublishEventsFns []OnPublishEventsFn) Provider {
	return &HookedProvider{
		OnStreamEventsFns:  onStreamEventsFns,
		OnPublishEventsFns: onPublishEventsFns,
		Provider:           provider,
	}
}

type HookedProvider struct {
	Provider
	OnPublishEventsFns []OnPublishEventsFn
	OnStreamEventsFns  []OnStreamEventsFn
}

func (h *HookedProvider) Subscribe(ctx context.Context, cfg SubscriptionEventConfiguration, updater SubscriptionEventUpdater) error {
	hookedUpdater := &hookedUpdater{
		ctx:                            ctx,
		updater:                        updater,
		subscriptionEventConfiguration: cfg,
		OnStreamEventsFns:              h.OnStreamEventsFns,
	}

	return h.Provider.Subscribe(ctx, cfg, hookedUpdater)
}

func (h *HookedProvider) Publish(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent) error {
	var newEvents []StreamEvent
	var err error
	if len(h.OnPublishEventsFns) == 0 {
		return h.Provider.Publish(ctx, cfg, events)
	}

	for _, fn := range h.OnPublishEventsFns {
		newEvents, err = fn(ctx, cfg, events)
		if err != nil {
			return err
		}
	}

	return h.Provider.Publish(ctx, cfg, newEvents)
}

func (h *HookedProvider) ID() string {
	return h.Provider.ID()
}

func (h *HookedProvider) TypeID() string {
	return h.Provider.TypeID()
}

func (h *HookedProvider) Startup(ctx context.Context) error {
	return h.Provider.Startup(ctx)
}

func (h *HookedProvider) Shutdown(ctx context.Context) error {
	return h.Provider.Shutdown(ctx)
}
