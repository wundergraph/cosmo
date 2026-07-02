package statistics

import (
	"context"
	"sync"
	"time"

	"go.uber.org/atomic"
	"go.uber.org/zap"
)

// ResolverConcurrencyReporter reports the concurrency state of a single
// resolver. Implemented by graphql-go-tools' *resolve.Resolver. Kept here to
// avoid an import cycle on the engine package.
type ResolverConcurrencyReporter interface {
	MaxConcurrentResolves() int
	InflightResolves() int
}

type EngineStatistics interface {
	GetReport() *UsageReport
	SubscriptionUpdateSent()
	ConnectionsInc()
	ConnectionsDec()
	SubscriptionCountInc(count int)
	SubscriptionCountDec(count int)
	TriggerCountInc(count int)
	TriggerCountDec(count int)
	RegisterResolver(r ResolverConcurrencyReporter)
	UnregisterResolver(r ResolverConcurrencyReporter)
}

type EngineStats struct {
	ctx           context.Context
	logger        *zap.Logger
	reportStats   bool
	connections   atomic.Uint64
	subscriptions atomic.Uint64
	messagesSent  atomic.Uint64
	triggers      atomic.Uint64

	resolverMu        sync.RWMutex
	resolverReporters map[ResolverConcurrencyReporter]struct{}
}

type UsageReport struct {
	Connections           uint64
	Subscriptions         uint64
	MessagesSent          uint64
	Triggers              uint64
	ResolverMaxConcurrent uint64
	ResolverInflight      uint64
}

// NewEngineStats creates a new EngineStats instance. If reportStats is true, the stats will be reported every 5 seconds.
func NewEngineStats(ctx context.Context, logger *zap.Logger, reportStats bool) *EngineStats {
	stats := &EngineStats{
		ctx:               ctx,
		logger:            logger,
		reportStats:       reportStats,
		resolverReporters: make(map[ResolverConcurrencyReporter]struct{}),
	}
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
	s.resolverMu.RLock()
	for r := range s.resolverReporters {
		report.ResolverMaxConcurrent += uint64(r.MaxConcurrentResolves())
		report.ResolverInflight += uint64(r.InflightResolves())
	}
	s.resolverMu.RUnlock()
	return report
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
}

func (s *EngineStats) ConnectionsInc() {
	s.connections.Inc()
}

func (s *EngineStats) ConnectionsDec() {
	s.connections.Dec()
}

func (s *EngineStats) SubscriptionCountInc(count int) {
	s.subscriptions.Add(uint64(count))
}

func (s *EngineStats) SubscriptionCountDec(count int) {
	s.subscriptions.Sub(uint64(count))
}

func (s *EngineStats) TriggerCountInc(count int) {
	s.triggers.Add(uint64(count))
}

func (s *EngineStats) TriggerCountDec(count int) {
	s.triggers.Sub(uint64(count))
}

func (s *EngineStats) RegisterResolver(r ResolverConcurrencyReporter) {
	if r == nil {
		return
	}
	s.resolverMu.Lock()
	s.resolverReporters[r] = struct{}{}
	s.resolverMu.Unlock()
}

func (s *EngineStats) UnregisterResolver(r ResolverConcurrencyReporter) {
	if r == nil {
		return
	}
	s.resolverMu.Lock()
	delete(s.resolverReporters, r)
	s.resolverMu.Unlock()
}

type NoopEngineStats struct{}

func NewNoopEngineStats() *NoopEngineStats {
	return &NoopEngineStats{}
}

func (s *NoopEngineStats) Subscribe(_ context.Context) chan *UsageReport {
	return nil
}

func (s *NoopEngineStats) GetReport() *UsageReport {
	return &UsageReport{}
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

func (s *NoopEngineStats) RegisterResolver(_ ResolverConcurrencyReporter)   {}
func (s *NoopEngineStats) UnregisterResolver(_ ResolverConcurrencyReporter) {}

var _ EngineStatistics = &EngineStats{}
var _ EngineStatistics = &NoopEngineStats{}
