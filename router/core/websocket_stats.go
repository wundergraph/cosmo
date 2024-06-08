package core

import (
	"context"
	"sync"
	"time"

	"github.com/wundergraph/cosmo/router/pkg/metric"
	"go.uber.org/atomic"
	"go.uber.org/zap"
)

type WebSocketsStatistics interface {
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

type WebSocketStats struct {
	mu                         sync.Mutex
	ctx                        context.Context
	logger                     *zap.Logger
	metrics                    metric.Store
	connections                atomic.Uint64
	subscriptions              atomic.Uint64
	messagesSent               atomic.Uint64
	triggers                   atomic.Uint64
	update                     chan struct{}
	reportWebSocketConnections bool
	subscribers                map[context.Context]chan *UsageReport
}

type UsageReport struct {
	Connections   uint64
	Subscriptions uint64
	MessagesSent  uint64
	Triggers      uint64
}

func NewWebSocketStats(ctx context.Context, metrics metric.Store, logger *zap.Logger, reportWebSocketConnections bool) *WebSocketStats {
	stats := &WebSocketStats{
		ctx:                        ctx,
		logger:                     logger,
		metrics:                    metrics,
		update:                     make(chan struct{}),
		mu:                         sync.Mutex{},
		subscribers:                map[context.Context]chan *UsageReport{},
		reportWebSocketConnections: reportWebSocketConnections,
	}
	go stats.run(ctx)
	return stats
}

func (s *WebSocketStats) Subscribe(ctx context.Context) chan *UsageReport {
	s.mu.Lock()
	defer s.mu.Unlock()

	sub := make(chan *UsageReport)
	s.subscribers[ctx] = sub
	return sub
}

func (s *WebSocketStats) GetReport() *UsageReport {
	report := &UsageReport{
		Connections:   s.connections.Load(),
		Subscriptions: s.subscriptions.Load(),
		MessagesSent:  s.messagesSent.Load(),
		Triggers:      s.triggers.Load(),
	}
	return report
}

func (s *WebSocketStats) run(ctx context.Context) {
	var tickChan <-chan time.Time
	if s.reportWebSocketConnections {
		tickReport := time.NewTicker(time.Second * 5)
		defer tickReport.Stop()
		tickChan = tickReport.C
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-tickChan:
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

func (s *WebSocketStats) reportConnections() {
	s.logger.Info("WebSocket Stats",
		zap.Uint64("open_connections", s.connections.Load()),
		zap.Uint64("active_subscriptions", s.subscriptions.Load()),
	)
}

func (s *WebSocketStats) publish() {
	s.update <- struct{}{}
}

func (s *WebSocketStats) SubscriptionUpdateSent() {
	s.messagesSent.Inc()
	s.publish()
}

func (s *WebSocketStats) ConnectionsInc() {
	s.connections.Inc()
	s.publish()
}

func (s *WebSocketStats) ConnectionsDec() {
	s.connections.Dec()
	s.publish()
}

func (s *WebSocketStats) SubscriptionCountInc(count int) {
	if count == 0 {
		return
	}

	s.subscriptions.Add(uint64(count))
	s.metrics.MeasureSubscriptionCount(s.ctx, int64(count))
	s.metrics.Flush(s.ctx)
	s.publish()
}

func (s *WebSocketStats) SubscriptionCountDec(count int) {
	if count == 0 {
		return
	}

	s.subscriptions.Sub(uint64(count))
	s.metrics.MeasureSubscriptionCount(s.ctx, int64(-count))
	s.metrics.Flush(s.ctx)
	s.publish()
}

func (s *WebSocketStats) TriggerCountInc(count int) {
	s.triggers.Add(uint64(count))
	s.publish()
}

func (s *WebSocketStats) TriggerCountDec(count int) {
	s.triggers.Sub(uint64(count))
	s.publish()
}

type NoopWebSocketStats struct{}

func NewNoopWebSocketStats() *NoopWebSocketStats {
	return &NoopWebSocketStats{}
}

func (s *NoopWebSocketStats) Subscribe(_ context.Context) chan *UsageReport {
	return nil
}

func (s *NoopWebSocketStats) GetReport() *UsageReport {
	return nil
}

func (s *NoopWebSocketStats) SubscriptionUpdateSent() {}

func (s *NoopWebSocketStats) ConnectionsInc() {}

func (s *NoopWebSocketStats) ConnectionsDec() {}

func (s *NoopWebSocketStats) SubscriptionCountInc(_ int) {}

func (s *NoopWebSocketStats) SubscriptionCountDec(_ int) {}

func (s *NoopWebSocketStats) SynchronousSubscriptionsInc() {}

func (s *NoopWebSocketStats) SynchronousSubscriptionsDec() {}

func (s *NoopWebSocketStats) TriggerCountInc(count int) {}

func (s *NoopWebSocketStats) TriggerCountDec(count int) {}

var _ WebSocketsStatistics = &WebSocketStats{}
