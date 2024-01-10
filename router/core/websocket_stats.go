package core

import (
	"context"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"sync"
	"time"
)

type WebSocketsStatistics interface {
	Subscribe() chan *UsageReport
	GetReport() *UsageReport
	SubscriptionUpdateSent()
	ConnectionsInc()
	ConnectionsDec()
	SubscriptionsInc()
	SubscriptionsDec()
	SynchronousSubscriptionsInc()
	SynchronousSubscriptionsDec()
}

type WebSocketStats struct {
	mu            sync.Mutex
	ctx           context.Context
	logger        *zap.Logger
	connections   atomic.Uint64
	subscriptions atomic.Uint64
	messagesSent  atomic.Uint64
	update        chan struct{}
	subscribers   []chan *UsageReport
}

type UsageReport struct {
	Connections   uint64
	Subscriptions uint64
	MessagesSent  uint64
}

func NewWebSocketStats(ctx context.Context, logger *zap.Logger) *WebSocketStats {
	stats := &WebSocketStats{
		ctx:    ctx,
		logger: logger,
		update: make(chan struct{}),
		mu:     sync.Mutex{},
	}
	go stats.run(ctx)
	return stats
}

func (s *WebSocketStats) Subscribe() chan *UsageReport {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.subscribers = append(s.subscribers, make(chan *UsageReport))
	return s.subscribers[len(s.subscribers)-1]
}

func (s *WebSocketStats) GetReport() *UsageReport {
	return &UsageReport{
		Connections:   s.connections.Load(),
		Subscriptions: s.subscriptions.Load(),
		MessagesSent:  s.messagesSent.Load(),
	}
}

func (s *WebSocketStats) run(ctx context.Context) {
	tickReport := time.NewTicker(time.Second * 5)
	defer tickReport.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tickReport.C:
			s.reportConnections()
		case <-s.update:
			s.mu.Lock()
			for _, subscriber := range s.subscribers {
				// non-blocking send
				select {
				case subscriber <- s.GetReport():
				default:
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

func (s *WebSocketStats) SubscriptionsInc() {
	s.subscriptions.Inc()
	s.publish()
}

func (s *WebSocketStats) SubscriptionsDec() {
	s.subscriptions.Dec()
	s.publish()
}

func (s *WebSocketStats) SynchronousSubscriptionsInc() {
	s.subscriptions.Inc()
	s.connections.Inc()
	s.publish()
}

func (s *WebSocketStats) SynchronousSubscriptionsDec() {
	s.subscriptions.Dec()
	s.connections.Dec()
	s.publish()
}

type NoopWebSocketStats struct{}

func NewNoopWebSocketStats() *NoopWebSocketStats {
	return &NoopWebSocketStats{}
}

func (s *NoopWebSocketStats) Subscribe() chan *UsageReport {
	return nil
}

func (s *NoopWebSocketStats) GetReport() *UsageReport {
	return nil
}

func (s *NoopWebSocketStats) SubscriptionUpdateSent() {}

func (s *NoopWebSocketStats) ConnectionsInc() {}

func (s *NoopWebSocketStats) ConnectionsDec() {}

func (s *NoopWebSocketStats) SubscriptionsInc() {}

func (s *NoopWebSocketStats) SubscriptionsDec() {}

func (s *NoopWebSocketStats) SynchronousSubscriptionsInc() {}

func (s *NoopWebSocketStats) SynchronousSubscriptionsDec() {}

var _ WebSocketsStatistics = &WebSocketStats{}
