package datasource

import (
	"context"
	"sync"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"golang.org/x/sync/semaphore"
)

const defaultTimeout = 5 * time.Second

// SubscriptionEventUpdater is a wrapper around the SubscriptionUpdater interface
// that provides a way to send the event struct instead of the raw data
// It is used to give access to the event additional fields to the hooks.
type SubscriptionEventUpdater interface {
	Update(events []StreamEvent)
	Complete()
	Done()
	SetHooks(hooks Hooks)
}

type subscriptionEventUpdater struct {
	eventUpdater                   resolve.SubscriptionUpdater
	subscriptionEventConfiguration SubscriptionEventConfiguration
	hooks                          Hooks
	onReiveEventsTimeout           time.Duration
	beforeEventsDispatchTimeout    time.Duration
	logger                         *zap.Logger
	eventBuilder                   EventBuilderFn
	semaphore                      *semaphore.Weighted
}

func (s *subscriptionEventUpdater) Update(events []StreamEvent) {
	events, ok := s.runBeforeEventsDispatchHooks(events)
	if !ok {
		return
	}

	if len(s.hooks.OnReceiveEvents.Handlers) == 0 {
		for _, event := range events {
			if event == nil {
				continue
			}
			s.eventUpdater.Update(event.GetData())
		}
		return
	}

	subscriptions := s.eventUpdater.Subscriptions()
	wg := sync.WaitGroup{}
	updaterCtx, cancel := context.WithDeadline(context.Background(), time.Now().Add(s.onReiveEventsTimeout))
	defer cancel()

	done := make(chan struct{})

	go func() {
		for subCtx, subId := range subscriptions {
			if err := s.semaphore.Acquire(updaterCtx, 1); err != nil {
				// Context cancelled or timed out, stop acquiring
				break
			}
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
	case <-updaterCtx.Done():
		// Timeout exceeded, some subscription updates may still be running.
		// We can't stop them but we will also not wait for them, basically abandoning them.
		// They will continue to hold their semaphore slots until they complete,
		// which means the next Update() call will have fewer available slots.
		// Also since we will process the next batch of events while having abandoned updaters,
		// those updaters might eventually push their events to the subscription late,
		// which means events might arrive out of order.
		s.logger.
			With(zap.String("handler_name", "OnReceiveEvents")).
			Warn("Subscription update timeout exceeded because handler execution took too long. " +
				"Consider increasing events.handler.on_receive_events.handler_timeout and/or " +
				"max_concurrent_handlers or reduce handler execution time." +
				"Events may arrive out of order.")
	}
}

// runBeforeEventsDispatchHooks runs the BeforeEventsDispatch hooks once per received batch,
// before any per-subscriber fan-out. It returns the (possibly transformed) events and
// false if a hook failed and the batch should be dropped.
func (s *subscriptionEventUpdater) runBeforeEventsDispatchHooks(events []StreamEvent) ([]StreamEvent, bool) {
	if len(s.hooks.BeforeEventsDispatch.Handlers) == 0 {
		return events, true
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.beforeEventsDispatchTimeout)
	defer cancel()

	type hookResult struct {
		events []StreamEvent
		ok     bool
	}
	done := make(chan hookResult, 1)

	go func() {
		res := hookResult{nil, false}
		defer func() {
			if r := recover(); r != nil {
				s.logger.
					WithOptions(zap.AddStacktrace(zapcore.ErrorLevel)).
					Error("[Recovery from handler panic]",
						zap.String("handler_name", "BeforeEventsDispatch"),
						zap.Any("error", r),
					)
				res = hookResult{nil, false}
			}
			done <- res
		}()

		evts := events
		for i := range s.hooks.BeforeEventsDispatch.Handlers {
			var err error
			evts, err = s.hooks.BeforeEventsDispatch.Handlers[i](ctx, s.subscriptionEventConfiguration, s.eventBuilder, evts)
			if err != nil {
				s.logger.
					With(zap.Int("handler_index", i)).
					Warn("BeforeEventsDispatch handler failed, dropping event batch", zap.Error(err))
				return
			}
		}
		res = hookResult{evts, true}
	}()

	select {
	case res := <-done:
		return res.events, res.ok
	case <-ctx.Done():
		s.logger.Warn("BeforeEventsDispatch handler timeout exceeded, dropping event batch. " +
			"Consider increasing events.handler.before_events_dispatch.handler_timeout or reduce handler execution time.")
		return nil, false
	}
}

func (s *subscriptionEventUpdater) Complete() {
	s.eventUpdater.Complete()
}

func (s *subscriptionEventUpdater) Done() {
	s.eventUpdater.Done()
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
		s.semaphore.Release(1)
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
		s.eventUpdater.CloseSubscription(subID)
	}
}

func (s *subscriptionEventUpdater) recoverPanic(subID resolve.SubscriptionIdentifier, err any) {
	s.logger.
		WithOptions(zap.AddStacktrace(zapcore.ErrorLevel)).
		Error("[Recovery from handler panic]",
			zap.String("handler_name", "OnReceiveEvents"),
			zap.Int64("subscription_id", subID.SubscriptionID),
			zap.Any("error", err),
		)

	s.eventUpdater.CloseSubscription(subID)
}

func NewSubscriptionEventUpdater(
	cfg SubscriptionEventConfiguration,
	hooks Hooks,
	eventUpdater resolve.SubscriptionUpdater,
	logger *zap.Logger,
	eventBuilder EventBuilderFn,
) SubscriptionEventUpdater {
	limit := max(hooks.OnReceiveEvents.MaxConcurrentHandlers, 1)
	onReceiveEventsTimeout := hooks.OnReceiveEvents.Timeout
	if onReceiveEventsTimeout == 0 {
		onReceiveEventsTimeout = defaultTimeout
	}
	beforeEventsDispatchTimeout := hooks.BeforeEventsDispatch.Timeout
	if beforeEventsDispatchTimeout == 0 {
		beforeEventsDispatchTimeout = defaultTimeout
	}

	return &subscriptionEventUpdater{
		subscriptionEventConfiguration: cfg,
		hooks:                          hooks,
		eventUpdater:                   eventUpdater,
		logger:                         logger,
		eventBuilder:                   eventBuilder,
		semaphore:                      semaphore.NewWeighted(int64(limit)),
		onReiveEventsTimeout:           onReceiveEventsTimeout,
		beforeEventsDispatchTimeout:    beforeEventsDispatchTimeout,
	}
}
