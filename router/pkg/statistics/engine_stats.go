package statistics

import (
	"context"
	"sync"
	"time"

	"go.uber.org/atomic"
	"go.uber.org/zap"
)

type EngineStatistics interface {
	GetReport() *UsageReport
	SubscriptionUpdateSent()
	ConnectionsInc()
	ConnectionsDec()
	SubscriptionCountInc(count int)
	SubscriptionCountDec(count int)
	TriggerCountInc(count int)
	TriggerCountDec(count int)
	// Wait blocks until predicate returns true for the current stats or ctx is cancelled.
	// Returns the report that satisfied the predicate, or the last report if ctx was cancelled.
	Wait(ctx context.Context, predicate func(*UsageReport) bool) *UsageReport
}

type EngineStats struct {
	cond          *sync.Cond
	ctx           context.Context
	logger        *zap.Logger
	reportStats   bool
	connections   atomic.Uint64
	subscriptions atomic.Uint64
	messagesSent  atomic.Uint64
	triggers      atomic.Uint64
}

type UsageReport struct {
	Connections   uint64
	Subscriptions uint64
	MessagesSent  uint64
	Triggers      uint64
}

// NewEngineStats creates a new EngineStats instance. If reportStats is true, the stats will be reported every 5 seconds.
func NewEngineStats(ctx context.Context, logger *zap.Logger, reportStats bool) *EngineStats {
	stats := &EngineStats{
		ctx:         ctx,
		logger:      logger,
		reportStats: reportStats,
	}
	stats.cond = sync.NewCond(&sync.Mutex{})
	if reportStats {
		go stats.runReporter(ctx)
	}
	return stats
}

func (s *EngineStats) GetReport() *UsageReport {
	report := &UsageReport{
		Connections:   s.connections.Load(),
		Subscriptions: s.subscriptions.Load(),
		MessagesSent:  s.messagesSent.Load(),
		Triggers:      s.triggers.Load(),
	}
	return report
}

// Wait blocks until the predicate returns true for the current stats snapshot,
// or until ctx is cancelled. Returns the UsageReport that satisfied the predicate,
// or the last snapshot if the context expired.
//
// Implementation: sync.Cond cannot select on context cancellation directly, so we
// bridge it with a goroutine that loops on cond.Wait() and sends the result on a
// channel. The caller selects on that channel and ctx.Done(). On cancellation, a
// Broadcast wakes the goroutine so it can observe ctx.Err() and exit cleanly.
func (s *EngineStats) Wait(ctx context.Context, predicate func(*UsageReport) bool) *UsageReport {
	// Fast path: check without blocking.
	report := s.GetReport()
	if predicate(report) {
		return report
	}

	// Slow path: wait for cond broadcasts from stat mutations.
	done := make(chan *UsageReport, 1)
	go func() {
		s.cond.L.Lock()
		defer s.cond.L.Unlock()
		for {
			r := s.GetReport()
			if predicate(r) {
				done <- r
				return
			}
			if ctx.Err() != nil {
				done <- r
				return
			}
			s.cond.Wait()
		}
	}()

	select {
	case report = <-done:
		return report
	case <-ctx.Done():
		// Unblock the goroutine waiting on cond.Wait()
		s.cond.Broadcast()
		// Wait for goroutine to exit to prevent leak
		return <-done
	}
}

func (s *EngineStats) runReporter(ctx context.Context) {
	tickReport := time.NewTicker(time.Second * 5)
	defer tickReport.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-tickReport.C:
			s.reportConnections()
		}
	}
}

func (s *EngineStats) reportConnections() {
	s.logger.Info("WebSocket Stats",
		zap.Uint64("open_connections", s.connections.Load()),
		zap.Uint64("triggers", s.triggers.Load()),
		zap.Uint64("active_subscriptions", s.subscriptions.Load()),
	)
}

func (s *EngineStats) SubscriptionUpdateSent() {
	s.messagesSent.Inc()
	s.cond.Broadcast()
}

func (s *EngineStats) ConnectionsInc() {
	s.connections.Inc()
	s.cond.Broadcast()
}

func (s *EngineStats) ConnectionsDec() {
	s.connections.Dec()
	s.cond.Broadcast()
}

func (s *EngineStats) SubscriptionCountInc(count int) {
	s.subscriptions.Add(uint64(count))
	s.cond.Broadcast()
}

func (s *EngineStats) SubscriptionCountDec(count int) {
	s.subscriptions.Sub(uint64(count))
	s.cond.Broadcast()
}

func (s *EngineStats) TriggerCountInc(count int) {
	s.triggers.Add(uint64(count))
	s.cond.Broadcast()
}

func (s *EngineStats) TriggerCountDec(count int) {
	s.triggers.Sub(uint64(count))
	s.cond.Broadcast()
}

type NoopEngineStats struct{}

func NewNoopEngineStats() *NoopEngineStats {
	return &NoopEngineStats{}
}

func (s *NoopEngineStats) Subscribe(_ context.Context) chan *UsageReport {
	return nil
}

func (s *NoopEngineStats) GetReport() *UsageReport {
	return nil
}

func (s *NoopEngineStats) Wait(_ context.Context, _ func(*UsageReport) bool) *UsageReport {
	return nil
}

func (s *NoopEngineStats) SubscriptionUpdateSent() {}

func (s *NoopEngineStats) ConnectionsInc() {}

func (s *NoopEngineStats) ConnectionsDec() {}

func (s *NoopEngineStats) SubscriptionCountInc(_ int) {}

func (s *NoopEngineStats) SubscriptionCountDec(_ int) {}

func (s *NoopEngineStats) SynchronousSubscriptionsInc() {}

func (s *NoopEngineStats) SynchronousSubscriptionsDec() {}

func (s *NoopEngineStats) TriggerCountInc(count int) {}

func (s *NoopEngineStats) TriggerCountDec(count int) {}

var _ EngineStatistics = &EngineStats{}
