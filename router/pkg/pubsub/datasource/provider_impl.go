package datasource

import (
	"context"

	"go.uber.org/zap"
)

type PubSubProviderImpl struct {
	id      string
	typeID  string
	Adapter Lifecycle
	Logger  *zap.Logger
}

func (p *PubSubProviderImpl) ID() string {
	return p.id
}

func (p *PubSubProviderImpl) TypeID() string {
	return p.typeID
}

func (p *PubSubProviderImpl) Startup(ctx context.Context) error {
	if err := p.Adapter.Startup(ctx); err != nil {
		return err
	}
	return nil
}

func (p *PubSubProviderImpl) Shutdown(ctx context.Context) error {
	if err := p.Adapter.Shutdown(ctx); err != nil {
		return err
	}
	return nil
}

func NewPubSubProviderImpl(id string, typeID string, adapter Lifecycle, logger *zap.Logger) *PubSubProviderImpl {
	return &PubSubProviderImpl{
		id:      id,
		typeID:  typeID,
		Adapter: adapter,
		Logger:  logger,
	}
}
