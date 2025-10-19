package datasource

import (
	"context"
	"sync"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
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

	maxConcurrency := 2
	semaphore := make(chan struct{}, maxConcurrency)
	for range maxConcurrency {
		semaphore <- struct{}{}
	}

	var (
		wg    = sync.WaitGroup{}
		errCh = make(chan error, len(s.eventUpdater.Subscriptions()))
	)

	for ctx, subId := range s.eventUpdater.Subscriptions() {
		<-semaphore // wait for a slot to be available
		eventsCopy := copyEvents(events)
		wg.Add(1)
		go s.updateSubscription(ctx, &wg, errCh, semaphore, subId, eventsCopy)
	}

	go s.deduplicateAndLogErrors(errCh, len(s.eventUpdater.Subscriptions()))

	wg.Wait()
	close(errCh)
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

// applyReceiveEventHooks processes events through a chain of hook functions
// Each hook receives the result from the previous hook, creating a proper middleware pipeline
func applyReceiveEventHooks(
	ctx context.Context,
	cfg SubscriptionEventConfiguration,
	events []StreamEvent,
	hooks []OnReceiveEventsFn) ([]StreamEvent, error) {
	// Copy the events to avoid modifying the original slice
	currentEvents := make([]StreamEvent, len(events))
	for i, event := range events {
		currentEvents[i] = event.Clone()
	}
	// Apply each hook in sequence, passing the result of one as the input to the next
	// If any hook returns an error, stop processing and return the error
	for _, hook := range hooks {
		var err error
		currentEvents, err = hook(ctx, cfg, currentEvents)
		if err != nil {
			return currentEvents, err
		}
	}
	return currentEvents, nil
}

func copyEvents(in []StreamEvent) []StreamEvent {
	out := make([]StreamEvent, len(in))
	for i := range in {
		out[i] = in[i].Clone()
	}
	return out
}

func (s *subscriptionEventUpdater) updateSubscription(ctx context.Context, wg *sync.WaitGroup, errCh chan error, semaphore chan struct{}, subID resolve.SubscriptionIdentifier, events []StreamEvent) {
	defer wg.Done()
	defer func() {
		semaphore <- struct{}{} // release the slot when done
	}()

	hooks := s.hooks.OnReceiveEvents

	// modify events with hooks
	var err error
	for i := range hooks {
		events, err = hooks[i](ctx, s.subscriptionEventConfiguration, events)
		if err != nil {
			errCh <- err
			s.eventUpdater.CloseSubscription(resolve.SubscriptionCloseKindNormal, subID)
		}
	}

	// send events to the subscription,
	// regardless if there was an error during hook processing.
	// If no events should be sent, hook must return no events.
	for _, event := range events {
		s.eventUpdater.UpdateSubscription(subID, event.GetData())
	}
}

// deduplicateAndLogErrors collects errors from errCh
// and deduplicates them based on their err.Error() value.
// Afterwards it uses s.logger to log the message.
func (s *subscriptionEventUpdater) deduplicateAndLogErrors(errCh chan error, size int) {
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
		s.logger.Warn(
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
