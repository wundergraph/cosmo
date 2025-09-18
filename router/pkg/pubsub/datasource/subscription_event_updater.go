package datasource

import (
	"context"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

// SubscriptionEventUpdater is a wrapper around the SubscriptionUpdater interface
// that provides a way to send the event struct instead of the raw data
// It is used to give access to the event additional fields to the hooks.
type SubscriptionEventUpdater interface {
	Update(events []StreamEvent) error
	Complete()
	Close(kind resolve.SubscriptionCloseKind)
	SetHooks(hooks Hooks)
}

type subscriptionEventUpdater struct {
	eventUpdater                   resolve.SubscriptionUpdater
	ctx                            context.Context
	subscriptionEventConfiguration SubscriptionEventConfiguration
	hooks                          Hooks
	logger                         *zap.Logger
}

func (s *subscriptionEventUpdater) updateEvents(events []StreamEvent) {
	for _, event := range events {
		s.eventUpdater.Update(event.GetData())
	}
}

func (s *subscriptionEventUpdater) Update(events []StreamEvent) error {
	if len(s.hooks.OnReceiveEvents) == 0 {
		s.updateEvents(events)
		return nil
	}

	processedEvents, err := applyStreamEventHooks(s.ctx, s.subscriptionEventConfiguration, events, s.hooks.OnReceiveEvents)
	// updates the events even if the hooks fail
	// if a hook doesn't want to send the events, it should return no events!
	s.updateEvents(processedEvents)
	if err != nil {
		// Check if the error is a StreamHookError and should close the subscription
		// We use type assertion to check for the CloseSubscription method without importing core
		if hookErr, ok := err.(ErrorWithCloseSubscription); ok {
			if hookErr.CloseSubscription() {
				// If CloseSubscription is true, return the error to close the subscription
				return err
			}
		}
		// For all other errors, just log them and continue
		if s.logger != nil {
			s.logger.Error(
				"An error occurred while processing stream events hooks",
				zap.Error(err),
				zap.String("provider_type", string(s.subscriptionEventConfiguration.ProviderType())),
				zap.String("provider_id", s.subscriptionEventConfiguration.ProviderID()),
				zap.String("field_name", s.subscriptionEventConfiguration.RootFieldName()),
			)
		}
	}

	return nil
}

func (s *subscriptionEventUpdater) Complete() {
	s.eventUpdater.Complete()
}

func (s *subscriptionEventUpdater) Close(kind resolve.SubscriptionCloseKind) {
	s.eventUpdater.Close(kind)
}

func (s *subscriptionEventUpdater) SetHooks(hooks Hooks) {
	s.hooks = hooks
}

// applyStreamEventHooks processes events through a chain of hook functions
// Each hook receives the result from the previous hook, creating a proper middleware pipeline
func applyStreamEventHooks(
	ctx context.Context,
	cfg SubscriptionEventConfiguration,
	events []StreamEvent,
	hooks []OnReceiveEventsFn) ([]StreamEvent, error) {
	currentEvents := events
	for _, hook := range hooks {
		var err error
		currentEvents, err = hook(ctx, cfg, currentEvents)
		if err != nil {
			return currentEvents, err
		}
	}
	return currentEvents, nil
}

func NewSubscriptionEventUpdater(
	ctx context.Context,
	cfg SubscriptionEventConfiguration,
	hooks Hooks,
	eventUpdater resolve.SubscriptionUpdater,
	logger *zap.Logger,
) SubscriptionEventUpdater {
	return &subscriptionEventUpdater{
		ctx:                            ctx,
		subscriptionEventConfiguration: cfg,
		hooks:                          hooks,
		eventUpdater:                   eventUpdater,
		logger:                         logger,
	}
}
