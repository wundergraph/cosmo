package datasource

import (
	"context"
	"fmt"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

type PubSubProvider struct {
	id      string
	typeID  string
	Adapter Adapter
	Logger  *zap.Logger
	hooks   Hooks
}

// applyPublishEventHooks processes events through a chain of hook functions
// Each hook receives the result from the previous hook, creating a proper middleware pipeline
func (p *PubSubProvider) applyPublishEventHooks(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent) (currentEvents []StreamEvent, err error) {
	defer func() {
		if r := recover(); r != nil {
			p.Logger.
				WithOptions(zap.AddStacktrace(zapcore.ErrorLevel)).
				Error("[Recovery from handler panic]",
					zap.Any("error", r),
				)
			switch v := r.(type) {
			case error:
				err = v
			default:
				err = fmt.Errorf("%v", r)
			}
		}
	}()

	currentEvents = events
	for _, hook := range p.hooks.OnPublishEvents {
		currentEvents, err = hook(ctx, cfg, currentEvents)
		if err != nil {
			p.Logger.Error(
				"error applying publish event hooks",
				zap.Error(err),
				zap.String("provider_id", cfg.ProviderID()),
				zap.String("provider_type_id", string(cfg.ProviderType())),
				zap.String("field_name", cfg.RootFieldName()),
			)

			return currentEvents, err
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

func (p *PubSubProvider) Subscribe(ctx context.Context, cfg SubscriptionEventConfiguration, updater SubscriptionEventUpdater) error {
	return p.Adapter.Subscribe(ctx, cfg, updater)
}

func (p *PubSubProvider) Publish(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent) error {
	if len(p.hooks.OnPublishEvents) == 0 {
		return p.Adapter.Publish(ctx, cfg, events)
	}

	processedEvents, hooksErr := p.applyPublishEventHooks(ctx, cfg, events)

	errPublish := p.Adapter.Publish(ctx, cfg, processedEvents)
	if errPublish != nil {
		return errPublish
	}

	return hooksErr
}

func (p *PubSubProvider) SetHooks(hooks Hooks) {
	p.hooks = hooks
}

func NewPubSubProvider(id string, typeID string, adapter Adapter, logger *zap.Logger) *PubSubProvider {
	return &PubSubProvider{
		id:      id,
		typeID:  typeID,
		Adapter: adapter,
		Logger:  logger,
	}
}
