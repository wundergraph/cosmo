package testenv

import (
	"context"
	"sync"

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

// SyncReporter is a test-only EngineStatistics implementation. It keeps
// snapshot-based wait semantics local to router-tests while also emitting
// buffered events for publish-retry helpers.
type SyncReporter struct {
	cond   *sync.Cond
	report statistics.UsageReport
	events chan Event
}

var _ statistics.EngineStatistics = (*SyncReporter)(nil)

// NewSyncReporter creates a SyncReporter for router-tests.
func NewSyncReporter(_ context.Context, _ *zap.Logger) *SyncReporter {
	return &SyncReporter{
		cond:   sync.NewCond(&sync.Mutex{}),
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
	sr.cond.L.Lock()
	defer sr.cond.L.Unlock()
	return sr.snapshotLocked()
}

func (sr *SyncReporter) Wait(ctx context.Context, predicate func(*statistics.UsageReport) bool) *statistics.UsageReport {
	report := sr.GetReport()
	if predicate(report) {
		return report
	}

	done := make(chan *statistics.UsageReport, 1)
	go func() {
		sr.cond.L.Lock()
		defer sr.cond.L.Unlock()
		for {
			report := sr.snapshotLocked()
			if predicate(report) || ctx.Err() != nil {
				done <- report
				return
			}
			sr.cond.Wait()
		}
	}()

	select {
	case report = <-done:
		return report
	case <-ctx.Done():
		sr.cond.L.Lock()
		sr.cond.Broadcast()
		sr.cond.L.Unlock()
		return <-done
	}
}

func (sr *SyncReporter) SubscriptionUpdateSent() {
	sr.withReport(func(report *statistics.UsageReport) {
		report.MessagesSent++
	})
	sr.emit(Event{Kind: EventSubscriptionUpdateSent})
}

func (sr *SyncReporter) ConnectionsInc() {
	sr.withReport(func(report *statistics.UsageReport) {
		report.Connections++
	})
	sr.emit(Event{Kind: EventConnectionsInc, Count: 1})
}

func (sr *SyncReporter) ConnectionsDec() {
	sr.withReport(func(report *statistics.UsageReport) {
		report.Connections--
	})
	sr.emit(Event{Kind: EventConnectionsDec, Count: 1})
}

func (sr *SyncReporter) SubscriptionCountInc(count int) {
	sr.withReport(func(report *statistics.UsageReport) {
		report.Subscriptions += uint64(count)
	})
	sr.emit(Event{Kind: EventSubscriptionCountInc, Count: count})
}

func (sr *SyncReporter) SubscriptionCountDec(count int) {
	sr.withReport(func(report *statistics.UsageReport) {
		report.Subscriptions -= uint64(count)
	})
	sr.emit(Event{Kind: EventSubscriptionCountDec, Count: count})
}

func (sr *SyncReporter) TriggerCountInc(count int) {
	sr.withReport(func(report *statistics.UsageReport) {
		report.Triggers += uint64(count)
	})
	sr.emit(Event{Kind: EventTriggerCountInc, Count: count})
}

func (sr *SyncReporter) TriggerCountDec(count int) {
	sr.withReport(func(report *statistics.UsageReport) {
		report.Triggers -= uint64(count)
	})
	sr.emit(Event{Kind: EventTriggerCountDec, Count: count})
}

func (sr *SyncReporter) withReport(update func(report *statistics.UsageReport)) {
	sr.cond.L.Lock()
	update(&sr.report)
	sr.cond.Broadcast()
	sr.cond.L.Unlock()
}

func (sr *SyncReporter) snapshotLocked() *statistics.UsageReport {
	report := sr.report
	return &report
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
