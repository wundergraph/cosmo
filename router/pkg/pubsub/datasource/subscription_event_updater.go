package datasource

import (
	"context"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// SubscriptionEventUpdater is a wrapper around the SubscriptionUpdater interface
// that provides a way to send the event struct instead of the raw data
// It is used to give access to the event additional fields to the hooks.
type SubscriptionEventUpdater interface {
	Update(events []StreamEvent)
	Complete()
	Close(kind resolve.SubscriptionCloseKind)
	SetOnStreamEventsFns([]OnStreamEventsFn)
}

type subscriptionEventUpdater struct {
	eventUpdater                   resolve.SubscriptionUpdater
	ctx                            context.Context
	subscriptionEventConfiguration SubscriptionEventConfiguration
	onStreamEventsFns              []OnStreamEventsFn
}

func (s *subscriptionEventUpdater) updateEvents(events []StreamEvent) {
	for _, event := range events {
		s.eventUpdater.Update(event.GetData())
	}
}

func (s *subscriptionEventUpdater) Update(events []StreamEvent) {
	if len(s.onStreamEventsFns) == 0 {
		s.updateEvents(events)
		return
	}

	processedEvents, err := applyStreamEventHooks(s.ctx, s.subscriptionEventConfiguration, events, s.onStreamEventsFns)
	if err != nil {
		// TODO: do something with the error - for now, continue with original events
		s.updateEvents(events)
		return
	}

	s.updateEvents(processedEvents)
}

func (s *subscriptionEventUpdater) Complete() {
	s.eventUpdater.Complete()
}

func (s *subscriptionEventUpdater) Close(kind resolve.SubscriptionCloseKind) {
	s.eventUpdater.Close(kind)
}

func (s *subscriptionEventUpdater) SetOnStreamEventsFns(fns []OnStreamEventsFn) {
	s.onStreamEventsFns = fns
}

// applyStreamEventHooks processes events through a chain of hook functions
// Each hook receives the result from the previous hook, creating a proper middleware pipeline
func applyStreamEventHooks(
	ctx context.Context,
	cfg SubscriptionEventConfiguration,
	events []StreamEvent,
	hooks []OnStreamEventsFn) ([]StreamEvent, error) {
	currentEvents := events
	for _, hook := range hooks {
		var err error
		currentEvents, err = hook(ctx, cfg, currentEvents)
		if err != nil {
			return nil, err
		}
	}
	return currentEvents, nil
}

func NewSubscriptionEventUpdater(
	ctx context.Context,
	cfg SubscriptionEventConfiguration,
	onStreamEventsFns []OnStreamEventsFn,
	eventUpdater resolve.SubscriptionUpdater) SubscriptionEventUpdater {
	return &subscriptionEventUpdater{
		ctx:                            ctx,
		subscriptionEventConfiguration: cfg,
		onStreamEventsFns:              onStreamEventsFns,
		eventUpdater:                   eventUpdater,
	}
}
