package datasource

import (
	"context"

	"go.uber.org/zap"
)

type PubSubProvider struct {
	id      string
	typeID  string
	Adapter ProviderBase
	Logger  *zap.Logger
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
	return p.Adapter.Publish(ctx, conf, events)
}

func NewPubSubProvider(id string, typeID string, adapter ProviderBase, logger *zap.Logger) *PubSubProvider {
	return &PubSubProvider{
		id:      id,
		typeID:  typeID,
		Adapter: adapter,
		Logger:  logger,
	}
}
