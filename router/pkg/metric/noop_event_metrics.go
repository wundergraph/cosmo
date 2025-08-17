package metric

import (
	"context"

	otelmetric "go.opentelemetry.io/otel/metric"
)

// A noop metric provider so we do not need to do nil checks for each provider call from the store
type noopEventMetricProvider struct{}

func (n *noopEventMetricProvider) Produce(ctx context.Context, opts ...otelmetric.AddOption) {}
func (n *noopEventMetricProvider) Consume(ctx context.Context, opts ...otelmetric.AddOption) {}
func (n *noopEventMetricProvider) Flush(ctx context.Context) error                           { return nil }

type NoopEventMetricStore struct{}

func (n *NoopEventMetricStore) Produce(ctx context.Context, event MessagingEvent) {}
func (n *NoopEventMetricStore) Consume(ctx context.Context, event MessagingEvent) {}

func (n *NoopEventMetricStore) Flush(ctx context.Context) error    { return nil }
func (n *NoopEventMetricStore) Shutdown(ctx context.Context) error { return nil }

func NewNoopEventMetricStore() *NoopEventMetricStore { return &NoopEventMetricStore{} }
