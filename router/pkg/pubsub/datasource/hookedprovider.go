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
	if len(h.OnStreamEventsFns) == 0 {
		h.updater.Update(events)
		return
	}

	processedEvents, err := applyStreamEventHooks(h.ctx, h.subscriptionEventConfiguration, events, h.OnStreamEventsFns)
	if err != nil {
		// TODO: do something with the error - for now, continue with original events
		h.updater.Update(events)
		return
	}

	h.updater.Update(processedEvents)
}

func (h *hookedUpdater) Complete() {
	h.updater.Complete()
}

func (h *hookedUpdater) Close(kind resolve.SubscriptionCloseKind) {
	h.updater.Close(kind)
}

// applyStreamEventHooks processes events through a chain of hook functions
// Each hook receives the result from the previous hook, creating a proper middleware pipeline
func applyStreamEventHooks(ctx context.Context, cfg SubscriptionEventConfiguration, events []StreamEvent, hooks []OnStreamEventsFn) ([]StreamEvent, error) {
	currentEvents := events
	for _, hook := range hooks {
		var err error
		currentEvents, err = hook(ctx, cfg, currentEvents)
		if err != nil {
			return nil, err
		}
	}
	return currentEvents, nil
}

// applyPublishEventHooks processes events through a chain of hook functions
// Each hook receives the result from the previous hook, creating a proper middleware pipeline
func applyPublishEventHooks(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent, hooks []OnPublishEventsFn) ([]StreamEvent, error) {
	currentEvents := events
	for _, hook := range hooks {
		var err error
		currentEvents, err = hook(ctx, cfg, currentEvents)
		if err != nil {
			return nil, err
		}
	}
	return currentEvents, nil
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
	if len(h.OnPublishEventsFns) == 0 {
		return h.Provider.Publish(ctx, cfg, events)
	}

	processedEvents, err := applyPublishEventHooks(ctx, cfg, events, h.OnPublishEventsFns)
	if err != nil {
		return err
	}

	return h.Provider.Publish(ctx, cfg, processedEvents)
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
