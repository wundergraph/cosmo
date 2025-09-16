package datasource

import "github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"

// SubscriptionEventUpdater is a wrapper around the SubscriptionUpdater interface
// that provides a way to send the event struct instead of the raw data
// It is used to give access to the event additional fields to the hooks.
type SubscriptionEventUpdater interface {
	Update(event StreamEvent)
	Complete()
	Close(kind resolve.SubscriptionCloseKind)
}

type subscriptionEventUpdater struct {
	eventUpdater resolve.SubscriptionUpdater
}

func (h *subscriptionEventUpdater) Update(event StreamEvent) {
	h.eventUpdater.Update(event.GetData())
}

func (h *subscriptionEventUpdater) Complete() {
	h.eventUpdater.Complete()
}

func (h *subscriptionEventUpdater) Close(kind resolve.SubscriptionCloseKind) {
	h.eventUpdater.Close(kind)
}

func NewSubscriptionEventUpdater(eventUpdater resolve.SubscriptionUpdater) SubscriptionEventUpdater {
	return &subscriptionEventUpdater{
		eventUpdater: eventUpdater,
	}
}
