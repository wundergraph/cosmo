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
	logger                         *zap.Logger
	eventBuilder                   EventBuilderFn
	semaphore                      *semaphore.Weighted
	timeout                        time.Duration
	atomicUpdate                   bool
}

func (s *subscriptionEventUpdater) updateAtomically(events []StreamEvent) {
	subscriptions := s.eventUpdater.Subscriptions()

	for _, event := range events {
		subData := make(map[resolve.SubscriptionIdentifier][]byte, len(subscriptions))

		for subCtx, subId := range subscriptions {
			var (
				hooks     = s.hooks.OnReceiveEvents.Handlers
				err       error
				subEvents = []StreamEvent{event}
			)

			for i := range s.hooks.OnReceiveEvents.Handlers {
				// TODO: replace context.Background() with something proper
				// TODO: check if this mutates global events variable
				// TODO: This executes the hook once for each event --> maybe better: execute hook once for all events and rekey the map from sub to event
				subEvents, err = hooks[i](subCtx, context.Background(), s.subscriptionEventConfiguration, s.eventBuilder, subEvents)
				if err != nil {
					// TODO: check wether to ignore or to fail and most likely don't swallow err
					continue
				}
			}

			if len(subEvents) == 0 {
				// hook decided that this sub shall not get the event
				continue
			}

			subData[subId] = subEvents[0].GetData() // TODO: ensure subEvents len is 1 but we probably can't know this as the hook could invent events
		}

		// at this point we have all modified event data for every subscriber of this event
		// call the new update method
		s.eventUpdater.BlockUpdate(subData)
	}
}

func (s *subscriptionEventUpdater) Update(events []StreamEvent) {
	// case 1: no hook, use single update
	if len(s.hooks.OnReceiveEvents.Handlers) == 0 {
		for _, event := range events {
			s.eventUpdater.Update(event.GetData())
		}
		return
	}

	// case 2: has hook, atomic update
	// we need to go through each event and update all subscribers, then move to the next event
	if s.atomicUpdate {
		s.updateAtomically(events)
		return
	}

	// case 3: has hook, no atomic update
	subscriptions := s.eventUpdater.Subscriptions()
	wg := sync.WaitGroup{}
	updaterCtx, cancel := context.WithDeadline(context.Background(), time.Now().Add(s.timeout))
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
		s.logger.Warn("Subscription update timeout exceeded because handler execution took too long. " +
			"Consider increasing events.handler.on_receive_events.handler_timeout and/or max_concurrent_handlers or reduce handler execution time." +
			"Events may arrive out of order.")
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
		semaphore:                      semaphore.NewWeighted(int64(limit)),
		timeout:                        timeout,
		atomicUpdate:                   true, // TODO: make configurable
	}
}
