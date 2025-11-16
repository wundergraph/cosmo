package datasource

import (
	"context"
	"sync"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

const (
	timeoutGracePeriod = 50 * time.Millisecond
	defaultTimeout     = 5 * time.Second
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
	eventBuilder                   EventBuilderFn
	semaphore                      chan struct{}
	timeout                        time.Duration
}

func (s *subscriptionEventUpdater) Update(events []StreamEvent) {
	if len(s.hooks.OnReceiveEvents.Handlers) == 0 {
		for _, event := range events {
			s.eventUpdater.Update(event.GetData())
		}
		return
	}

	subscriptions := s.eventUpdater.Subscriptions()
	wg := sync.WaitGroup{}
	updaterCtx, cancel := context.WithDeadline(context.Background(), time.Now().Add(s.timeout))
	defer cancel()

	done := make(chan struct{})

	go func() {
		for subCtx, subId := range subscriptions {
			s.semaphore <- struct{}{} // Acquire slot, blocks if all slots are taken
			wg.Add(1)
			go s.updateSubscription(subCtx, updaterCtx, &wg, subId, events)
		}

		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		s.logger.Debug("All subscription updates completed")
		// All subscriptions completed successfully
	case <-time.After(s.timeout + timeoutGracePeriod):
		// Timeout exceeded, some subscription updates may still be running.
		// We can't stop them but we will also not wait for them, basically abandoning them.
		// They will continue to hold their semaphore slots until they complete,
		// which means the next Update() call will have fewer available slots.
		// Also since we will process the next batch of events while having abandoned updaters,
		// those updaters might eventually push their events to the subscription late,
		// which means events might arrive out of order.
		s.logger.Warn("Timeout exceeded during subscription updates, events may arrive out of order")
	}
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

func (s *subscriptionEventUpdater) updateSubscription(subscriptionCtx context.Context, updaterCtx context.Context, wg *sync.WaitGroup, subID resolve.SubscriptionIdentifier, events []StreamEvent) {
	defer wg.Done()
	defer func() {
		if r := recover(); r != nil {
			s.recoverPanic(subID, r)
		}
		<-s.semaphore // release the slot when done
	}()

	hooks := s.hooks.OnReceiveEvents.Handlers

	// modify events with hooks
	var err error
	for i := range hooks {
		events, err = hooks[i](subscriptionCtx, updaterCtx, s.subscriptionEventConfiguration, s.eventBuilder, events)
		if err != nil {
			break
		}
	}

	// send events to the subscription,
	// regardless if there was an error during hook processing.
	// If no events should be sent, hook must return no events.
	for _, event := range events {
		if event == nil {
			continue
		}
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

func NewSubscriptionEventUpdater(
	cfg SubscriptionEventConfiguration,
	hooks Hooks,
	eventUpdater resolve.SubscriptionUpdater,
	logger *zap.Logger,
	eventBuilder EventBuilderFn,
) SubscriptionEventUpdater {
	limit := max(hooks.OnReceiveEvents.MaxConcurrentHandlers, 1)
	timeout := hooks.OnReceiveEvents.Timeout
	if timeout == 0 {
		timeout = defaultTimeout
	}

	return &subscriptionEventUpdater{
		subscriptionEventConfiguration: cfg,
		hooks:                          hooks,
		eventUpdater:                   eventUpdater,
		logger:                         logger,
		eventBuilder:                   eventBuilder,
		semaphore:                      make(chan struct{}, limit),
		timeout:                        timeout,
	}
}
