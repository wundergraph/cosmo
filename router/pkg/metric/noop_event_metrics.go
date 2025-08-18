package metric

import (
	"context"
)

type NoopEventMetricStore struct{}

func (n *NoopEventMetricStore) Produce(ctx context.Context, event MessagingEvent) {}
func (n *NoopEventMetricStore) Consume(ctx context.Context, event MessagingEvent) {}

func (n *NoopEventMetricStore) Flush(ctx context.Context) error    { return nil }
func (n *NoopEventMetricStore) Shutdown(ctx context.Context) error { return nil }

func NewNoopEventMetricStore() *NoopEventMetricStore { return &NoopEventMetricStore{} }
