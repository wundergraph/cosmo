package datasource

import (
	"context"
	"fmt"
	"slices"
	"sync/atomic"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

type PubSubProvider struct {
	id           string
	typeID       string
	Adapter      Adapter
	Logger       *zap.Logger
	hooks        Hooks
	eventBuilder EventBuilderFn
	// unavailable is set when the provider could not be started (e.g. the broker is
	// unreachable) and the router was configured to start anyway. Once set, Subscribe
	// and Publish return an error instead of using the underlying adapter, so the
	// affected fields fail gracefully rather than crashing the router.
	unavailable atomic.Bool
}

// applyPublishEventHooks processes events through a chain of hook functions
// Each hook receives the result from the previous hook, creating a proper middleware pipeline
func (p *PubSubProvider) applyPublishEventHooks(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent) (currentEvents []StreamEvent, err error) {
	defer func() {
		if r := recover(); r != nil {
			p.Logger.
				WithOptions(zap.AddStacktrace(zapcore.ErrorLevel)).
				Error("[Recovery from handler panic]", zap.Any("error", r))

			switch v := r.(type) {
			case error:
				err = v
			default:
				err = fmt.Errorf("%v", r)
			}
		}
	}()

	currentEvents = events

	for _, hook := range p.hooks.OnPublishEvents.Handlers {
		currentEvents, err = hook(ctx, cfg, currentEvents, p.eventBuilder)
		if err != nil {
			break
		}
	}

	currentEvents = slices.DeleteFunc(currentEvents, func(event StreamEvent) bool {
		return event == nil
	})

	return currentEvents, err
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

// MarkUnavailable flags the provider as unavailable. It is called when the provider
// failed to start and the router was configured (events.skip_unavailable_providers)
// to keep running. Subsequent Subscribe/Publish calls return an error instead of
// using the underlying adapter, which may not have an established connection.
func (p *PubSubProvider) MarkUnavailable() {
	p.unavailable.Store(true)
}

// UnavailableError returns a non-nil error if the provider has been marked unavailable.
// Data sources that reach into the underlying adapter directly (e.g. NATS request/reply)
// should call this before using it, so a provider that failed to start is not used.
func (p *PubSubProvider) UnavailableError() error {
	if p.unavailable.Load() {
		return NewError(fmt.Sprintf("event provider %q (%s) is unavailable", p.id, p.typeID), nil)
	}
	return nil
}

func (p *PubSubProvider) Shutdown(ctx context.Context) error {
	// A provider marked unavailable failed to start, so it has no connection to tear down.
	// Skip the adapter: its connection fields may still be written by an in-flight Startup
	// goroutine, and reading them here would race that write.
	if p.unavailable.Load() {
		return nil
	}
	if err := p.Adapter.Shutdown(ctx); err != nil {
		return err
	}
	return nil
}

func (p *PubSubProvider) Subscribe(ctx context.Context, cfg SubscriptionEventConfiguration, updater SubscriptionEventUpdater) error {
	if err := p.UnavailableError(); err != nil {
		return err
	}
	return p.Adapter.Subscribe(ctx, cfg, updater)
}

func (p *PubSubProvider) Publish(ctx context.Context, cfg PublishEventConfiguration, events []StreamEvent) error {
	if err := p.UnavailableError(); err != nil {
		return err
	}

	if len(p.hooks.OnPublishEvents.Handlers) == 0 {
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

func NewPubSubProvider(id string, typeID string, adapter Adapter, logger *zap.Logger, eventBuilder EventBuilderFn) *PubSubProvider {
	if logger == nil {
		logger = zap.NewNop()
	}

	return &PubSubProvider{
		id:           id,
		typeID:       typeID,
		Adapter:      adapter,
		Logger:       logger,
		eventBuilder: eventBuilder,
	}
}
