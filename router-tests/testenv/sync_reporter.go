package testenv

import (
	"context"

	"github.com/wundergraph/cosmo/router/pkg/statistics"
	"go.uber.org/zap"
)

// EventKind represents the type of engine statistics event.
type EventKind int

const (
	EventSubscriptionUpdateSent EventKind = iota
	EventSubscriptionCountInc
	EventSubscriptionCountDec
	EventTriggerCountInc
	EventTriggerCountDec
	EventConnectionsInc
	EventConnectionsDec
)

// Event represents a single engine statistics event emitted by SyncReporter.
type Event struct {
	Kind  EventKind
	Count int
}

// SyncReporter wraps EngineStats and emits channel-based events for test
// synchronization. It satisfies statistics.EngineStatistics via delegation
// to the inner EngineStats, while additionally emitting events on a buffered
// channel that tests can select on directly.
type SyncReporter struct {
	inner  *statistics.EngineStats
	events chan Event
}

var _ statistics.EngineStatistics = (*SyncReporter)(nil)

// NewSyncReporter creates a SyncReporter wrapping a real EngineStats.
// The inner EngineStats has periodic reporting disabled (test-only).
func NewSyncReporter(ctx context.Context, logger *zap.Logger) *SyncReporter {
	return &SyncReporter{
		inner:  statistics.NewEngineStats(ctx, logger, false),
		events: make(chan Event, 256),
	}
}

// Events returns the read-only events channel for tests to receive on.
func (sr *SyncReporter) Events() <-chan Event {
	return sr.events
}

func (sr *SyncReporter) emit(e Event) {
	select {
	case sr.events <- e:
	default:
	}
}

func (sr *SyncReporter) GetReport() *statistics.UsageReport {
	return sr.inner.GetReport()
}

func (sr *SyncReporter) Wait(ctx context.Context, predicate func(*statistics.UsageReport) bool) *statistics.UsageReport {
	return sr.inner.Wait(ctx, predicate)
}

func (sr *SyncReporter) SubscriptionUpdateSent() {
	sr.inner.SubscriptionUpdateSent()
	sr.emit(Event{Kind: EventSubscriptionUpdateSent})
}

func (sr *SyncReporter) ConnectionsInc() {
	sr.inner.ConnectionsInc()
	sr.emit(Event{Kind: EventConnectionsInc, Count: 1})
}

func (sr *SyncReporter) ConnectionsDec() {
	sr.inner.ConnectionsDec()
	sr.emit(Event{Kind: EventConnectionsDec, Count: 1})
}

func (sr *SyncReporter) SubscriptionCountInc(count int) {
	sr.inner.SubscriptionCountInc(count)
	sr.emit(Event{Kind: EventSubscriptionCountInc, Count: count})
}

func (sr *SyncReporter) SubscriptionCountDec(count int) {
	sr.inner.SubscriptionCountDec(count)
	sr.emit(Event{Kind: EventSubscriptionCountDec, Count: count})
}

func (sr *SyncReporter) TriggerCountInc(count int) {
	sr.inner.TriggerCountInc(count)
	sr.emit(Event{Kind: EventTriggerCountInc, Count: count})
}

func (sr *SyncReporter) TriggerCountDec(count int) {
	sr.inner.TriggerCountDec(count)
	sr.emit(Event{Kind: EventTriggerCountDec, Count: count})
}

// WaitForEvent drains events until one matching kind is received, or ctx is cancelled.
func (sr *SyncReporter) WaitForEvent(ctx context.Context, kind EventKind) bool {
	for {
		select {
		case ev := <-sr.events:
			if ev.Kind == kind {
				return true
			}
		case <-ctx.Done():
			return false
		}
	}
}

// WaitForEvents drains events until count events of the specified kind are received.
func (sr *SyncReporter) WaitForEvents(ctx context.Context, kind EventKind, count int) int {
	received := 0
	for received < count {
		select {
		case ev := <-sr.events:
			if ev.Kind == kind {
				received++
			}
		case <-ctx.Done():
			return received
		}
	}
	return received
}
