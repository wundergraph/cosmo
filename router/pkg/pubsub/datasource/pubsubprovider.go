package datasource

import (
	"context"

	"go.uber.org/zap"
)

type PubSubProvider struct {
	onPublishEventsFns []OnPublishEventsFn
	onStreamEventsFns  []OnStreamEventsFn
	id                 string
	typeID             string
	Adapter            Adapter
	Logger             *zap.Logger
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
	return p.Adapter.Subscribe(ctx, conf, updater)
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

func NewPubSubProvider(id string, typeID string, adapter Adapter, logger *zap.Logger) *PubSubProvider {
	return &PubSubProvider{
		id:      id,
		typeID:  typeID,
		Adapter: adapter,
		Logger:  logger,
	}
}
