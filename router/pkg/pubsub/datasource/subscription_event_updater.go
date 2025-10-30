package datasource

import (
	"context"
	"sync"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// SubscriptionEventUpdater is a wrapper around the SubscriptionUpdater interface
// that provides a way to send the event struct instead of the raw data
// It is used to give access to the event additional fields to the hooks.
type SubscriptionEventUpdater interface {
	Update(events []StreamEvent)
	Complete()
	Close(kind resolve.SubscriptionCloseKind)
	SetHooks(hooks Hooks)
}

type subscriptionEventUpdater struct {
	eventUpdater                   resolve.SubscriptionUpdater
	subscriptionEventConfiguration SubscriptionEventConfiguration
	hooks                          Hooks
	logger                         *zap.Logger
}

func (s *subscriptionEventUpdater) Update(events []StreamEvent) {
	if len(s.hooks.OnReceiveEvents) == 0 {
		for _, event := range events {
			s.eventUpdater.Update(event.GetData())
		}
		return
	}

	subscriptions := s.eventUpdater.Subscriptions()
	limit := max(s.hooks.MaxConcurrentOnReceiveHandlers, 1)
	semaphore := make(chan struct{}, limit)
	wg := sync.WaitGroup{}
	errCh := make(chan error, len(subscriptions))

	for ctx, subId := range subscriptions {
		semaphore <- struct{}{} // Acquire a slot
		wg.Add(1)
		go s.updateSubscription(ctx, &wg, errCh, semaphore, subId, events)
	}

	doneLogging := make(chan struct{})
	go func() {
		s.deduplicateAndLogErrors(errCh, len(subscriptions))
		doneLogging <- struct{}{}
	}()

	wg.Wait()
	close(semaphore)
	close(errCh)
	<-doneLogging
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

func (s *subscriptionEventUpdater) updateSubscription(ctx context.Context, wg *sync.WaitGroup, errCh chan error, semaphore chan struct{}, subID resolve.SubscriptionIdentifier, events []StreamEvent) {
	defer wg.Done()
	defer func() {
		if r := recover(); r != nil {
			s.recoverPanic(subID, r)
		}
		<-semaphore // release the slot when done
	}()

	hooks := s.hooks.OnReceiveEvents

	// modify events with hooks
	var err error
	for i := range hooks {
		events, err = hooks[i](ctx, s.subscriptionEventConfiguration, events)
		if err != nil {
			errCh <- err
		}
	}

	// send events to the subscription,
	// regardless if there was an error during hook processing.
	// If no events should be sent, hook must return no events.
	for _, event := range events {
		s.eventUpdater.UpdateSubscription(subID, event.GetData())
	}

	// In case there was an error we close the affected subscription.
	if err != nil {
		s.eventUpdater.CloseSubscription(resolve.SubscriptionCloseKindNormal, subID)
	}
}

func (s *subscriptionEventUpdater) recoverPanic(subID resolve.SubscriptionIdentifier, err any) {
	s.logger.
		WithOptions(zap.AddStacktrace(zapcore.ErrorLevel)).
		Error("[Recovery from handler panic]",
			zap.Int64("subscription_id", subID.SubscriptionID),
			zap.Any("error", err),
		)

	s.eventUpdater.CloseSubscription(resolve.SubscriptionCloseKindDownstreamServiceError, subID)
}

// deduplicateAndLogErrors collects errors from errCh
// and deduplicates them based on their err.Error() value.
// Afterwards it uses s.logger to log the message.
func (s *subscriptionEventUpdater) deduplicateAndLogErrors(errCh chan error, size int) {
	if s.logger == nil {
		return
	}

	errs := make(map[string]int, size)
	for err := range errCh {
		amount, found := errs[err.Error()]
		if found {
			errs[err.Error()] = amount + 1
			continue
		}
		errs[err.Error()] = 1
	}

	for err, amount := range errs {
		s.logger.Error(
			"some handlers have thrown an error",
			zap.String("error", err),
			zap.Int("amount_handlers", amount),
			zap.String("provider_type", string(s.subscriptionEventConfiguration.ProviderType())),
			zap.String("provider_id", s.subscriptionEventConfiguration.ProviderID()),
			zap.String("field_name", s.subscriptionEventConfiguration.RootFieldName()),
		)
	}
}

func NewSubscriptionEventUpdater(
	cfg SubscriptionEventConfiguration,
	hooks Hooks,
	eventUpdater resolve.SubscriptionUpdater,
	logger *zap.Logger,
) SubscriptionEventUpdater {
	return &subscriptionEventUpdater{
		subscriptionEventConfiguration: cfg,
		hooks:                          hooks,
		eventUpdater:                   eventUpdater,
		logger:                         logger,
	}
}
