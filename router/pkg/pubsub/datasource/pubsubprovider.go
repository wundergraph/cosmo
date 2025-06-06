package datasource

import (
	"context"

	"go.uber.org/zap"
)

type PubSubProvider struct {
	id      string
	typeID  string
	Adapter ProviderLifecycle
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

func NewPubSubProvider(id string, typeID string, adapter ProviderLifecycle, logger *zap.Logger) *PubSubProvider {
	return &PubSubProvider{
		id:      id,
		typeID:  typeID,
		Adapter: adapter,
		Logger:  logger,
	}
}
