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
}

type EngineStats struct {
	mu            sync.Mutex
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
		mu:          sync.Mutex{},
		reportStats: reportStats,
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
