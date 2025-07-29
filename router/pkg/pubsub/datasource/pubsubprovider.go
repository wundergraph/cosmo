package datasource

import (
	"context"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

type PubSubProvider struct {
	onPublishEventsFns []OnPublishEventsFn
	onStreamEventsFns  []OnStreamEventsFn
	id                 string
	typeID             string
	Adapter            ProviderBase
	Logger             *zap.Logger
}

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

func (p *PubSubProvider) ID() string {
	return p.id
}

func (p *PubSubProvider) TypeID() string {
	return p.typeID
}

func (p *PubSubProvider) Startup(ctx context.Context) error {
	if err := p.Adapter.Startup(ctx); err != nil {
		return err
	}
	return nil
}

func (p *PubSubProvider) Shutdown(ctx context.Context) error {
	if err := p.Adapter.Shutdown(ctx); err != nil {
		return err
	}
	return nil
}

func (p *PubSubProvider) Subscribe(ctx context.Context, conf SubscriptionEventConfiguration, updater SubscriptionEventUpdater) error {
	hookedUpdater := &hookedUpdater{
		ctx:                            ctx,
		updater:                        updater,
		subscriptionEventConfiguration: conf,
		OnStreamEventsFns:              p.onStreamEventsFns,
	}

	return p.Adapter.Subscribe(ctx, conf, hookedUpdater)
}

func (p *PubSubProvider) Publish(ctx context.Context, conf PublishEventConfiguration, events []StreamEvent) error {
	if len(p.onPublishEventsFns) == 0 {
		return p.Adapter.Publish(ctx, conf, events)
	}

	processedEvents, err := applyPublishEventHooks(ctx, conf, events, p.onPublishEventsFns)
	if err != nil {
		return err
	}

	return p.Adapter.Publish(ctx, conf, processedEvents)
}

func (p *PubSubProvider) SetOnPublishEventsFns(fns []OnPublishEventsFn) {
	p.onPublishEventsFns = fns
}

func (p *PubSubProvider) SetOnStreamEventsFns(fns []OnStreamEventsFn) {
	p.onStreamEventsFns = fns
}

func NewPubSubProvider(id string, typeID string, adapter ProviderBase, logger *zap.Logger) *PubSubProvider {
	return &PubSubProvider{
		id:      id,
		typeID:  typeID,
		Adapter: adapter,
		Logger:  logger,
	}
}
