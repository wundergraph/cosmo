package metric

import (
	"context"

	otelmetric "go.opentelemetry.io/otel/metric"
)

// A noop metric provider so we do not need to do nil checks for each provider call from the store
type noopEventMetricProvider struct{}

func (n *noopEventMetricProvider) KafkaPublish(ctx context.Context, opts ...otelmetric.AddOption) {}
func (n *noopEventMetricProvider) KafkaPublishFailure(ctx context.Context, opts ...otelmetric.AddOption) {
}
func (n *noopEventMetricProvider) KafkaMessageReceived(ctx context.Context, opts ...otelmetric.AddOption) {
}
func (n *noopEventMetricProvider) RedisPublish(ctx context.Context, opts ...otelmetric.AddOption) {}
func (n *noopEventMetricProvider) RedisPublishFailure(ctx context.Context, opts ...otelmetric.AddOption) {
}
func (n *noopEventMetricProvider) RedisMessageReceived(ctx context.Context, opts ...otelmetric.AddOption) {
}
func (n *noopEventMetricProvider) NatsPublish(ctx context.Context, opts ...otelmetric.AddOption) {}
func (n *noopEventMetricProvider) NatsPublishFailure(ctx context.Context, opts ...otelmetric.AddOption) {
}
func (n *noopEventMetricProvider) NatsMessageReceived(ctx context.Context, opts ...otelmetric.AddOption) {
}
func (n *noopEventMetricProvider) Flush(ctx context.Context) error { return nil }
func (n *noopEventMetricProvider) Shutdown() error                 { return nil }
