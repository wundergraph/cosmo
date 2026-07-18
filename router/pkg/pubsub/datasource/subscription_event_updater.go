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
	waitForHooks                   bool
}

func (s *subscriptionEventUpdater) computeSubscriberEvents(events []StreamEvent) map[resolve.SubscriptionIdentifier][]StreamEvent {
	subscriptions := s.eventUpdater.Subscriptions()
	hooks := s.hooks.OnReceiveEvents.Handlers

	outputs := make(map[resolve.SubscriptionIdentifier][]StreamEvent, len(subscriptions))

	for subCtx, subID := range subscriptions {
		// Give this subscriber its own copy of the source events so in-place
		// mutations by a hook stay isolated to this chain.
		subEvents := make([]StreamEvent, len(events))
		for i, event := range events {
			subEvents[i] = event.Clone()
		}

		var err error
		for i := range hooks {
			// TODO: replace context.Background() with something proper
			subEvents, err = hooks[i](subCtx, context.Background(), s.subscriptionEventConfiguration, s.eventBuilder, subEvents)
			if err != nil {
				break
			}
		}
		if err != nil {
			// TODO: decide whether to CloseSubscription here or swallow the error
			continue
		}

		if len(subEvents) == 0 {
			// hook decided that this subscriber shall not receive any event
			continue
		}

		outputs[subID] = subEvents
	}

	return outputs
}

func (s *subscriptionEventUpdater) buildUpdateRounds(outputs map[resolve.SubscriptionIdentifier][]StreamEvent) []map[resolve.SubscriptionIdentifier][]byte {
	maxLen := 0
	for _, subEvents := range outputs {
		if len(subEvents) > maxLen {
			maxLen = len(subEvents)
		}
	}

	rounds := make([]map[resolve.SubscriptionIdentifier][]byte, maxLen)
	for r := range rounds {
		subData := make(map[resolve.SubscriptionIdentifier][]byte, len(outputs))
		for subID, subEvents := range outputs {
			if r < len(subEvents) {
				event := subEvents[r]
				if event != nil {
					subData[subID] = event.GetData()
				}
			}
		}
		rounds[r] = subData
	}

	return rounds
}

func (s *subscriptionEventUpdater) updateInBulks(events []StreamEvent) {
	eventOutputs := s.computeSubscriberEvents(events)
	updateRounds := s.buildUpdateRounds(eventOutputs)

	for _, round := range updateRounds {
		s.eventUpdater.UpdateBulk(round)
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
	if s.waitForHooks {
		s.updateInBulks(events)
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
		waitForHooks:                   hooks.OnReceiveEvents.WaitForHooks,
	}
}
