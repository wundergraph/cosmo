package metric

import (
	"context"
)

type NoopStreamMetricStore struct{}

func (n *NoopStreamMetricStore) Produce(ctx context.Context, event StreamsEvent) {}
func (n *NoopStreamMetricStore) Consume(ctx context.Context, event StreamsEvent) {}

func (n *NoopStreamMetricStore) Flush(ctx context.Context) error    { return nil }
func (n *NoopStreamMetricStore) Shutdown(ctx context.Context) error { return nil }

func NewNoopStreamMetricStore() *NoopStreamMetricStore { return &NoopStreamMetricStore{} }
