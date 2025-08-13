package metric

import (
	"context"

	otelmetric "go.opentelemetry.io/otel/metric"
)

// A noop metric provider so we do not need to do nil checks for each provider call from the store
type noopEventMetricProvider struct{}

func (n *noopEventMetricProvider) Publish(ctx context.Context, backend string, count int64, opts ...otelmetric.AddOption) {
}
func (n *noopEventMetricProvider) PublishFailure(ctx context.Context, backend string, count int64, opts ...otelmetric.AddOption) {
}
func (n *noopEventMetricProvider) MessageReceived(ctx context.Context, backend string, count int64, opts ...otelmetric.AddOption) {
}
func (n *noopEventMetricProvider) Flush(ctx context.Context) error { return nil }
func (n *noopEventMetricProvider) Shutdown() error                 { return nil }
