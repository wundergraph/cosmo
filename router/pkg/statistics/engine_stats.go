package statistics

import (
	"context"
	"sync"
	"time"

	"go.uber.org/atomic"
	"go.uber.org/zap"
)

type EngineStatistics interface {
	Subscribe(ctx context.Context) chan *UsageReport
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
	update        chan struct{}
	subscribers   map[context.Context]chan *UsageReport
}

type UsageReport struct {
	Connections   uint64
	Subscriptions uint64
	MessagesSent  uint64
	Triggers      uint64
}

func NewEngineStats(ctx context.Context, logger *zap.Logger, reportStats bool) *EngineStats {
	stats := &EngineStats{
		ctx:         ctx,
		logger:      logger,
		update:      make(chan struct{}),
		mu:          sync.Mutex{},
		reportStats: reportStats,
		subscribers: map[context.Context]chan *UsageReport{},
	}
	go stats.run(ctx)
	return stats
}

func (s *EngineStats) Subscribe(ctx context.Context) chan *UsageReport {
	s.mu.Lock()
	defer s.mu.Unlock()

	sub := make(chan *UsageReport)
	s.subscribers[ctx] = sub
	return sub
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

func (s *EngineStats) run(ctx context.Context) {
	tickReport := time.NewTicker(time.Second * 5)
	if !s.reportStats {
		tickReport.Stop()
	}

	defer tickReport.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tickReport.C:
			s.reportConnections()
		case <-s.update:
			s.mu.Lock()
			report := s.GetReport()
			for ctx, subscriber := range s.subscribers {
				select {
				case subscriber <- report:
				case <-ctx.Done():
					delete(s.subscribers, ctx)
					continue
				case <-s.ctx.Done():
					continue
				}
			}
			s.mu.Unlock()
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

func (s *EngineStats) publish() {
	s.update <- struct{}{}
}

func (s *EngineStats) SubscriptionUpdateSent() {
	s.messagesSent.Inc()
	s.publish()
}

func (s *EngineStats) ConnectionsInc() {
	s.connections.Inc()
	s.publish()
}

func (s *EngineStats) ConnectionsDec() {
	s.connections.Dec()
	s.publish()
}

func (s *EngineStats) SubscriptionCountInc(count int) {
	s.subscriptions.Add(uint64(count))
	s.publish()
}

func (s *EngineStats) SubscriptionCountDec(count int) {
	s.subscriptions.Sub(uint64(count))
	s.publish()
}

func (s *EngineStats) TriggerCountInc(count int) {
	s.triggers.Add(uint64(count))
	s.publish()
}

func (s *EngineStats) TriggerCountDec(count int) {
	s.triggers.Sub(uint64(count))
	s.publish()
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
