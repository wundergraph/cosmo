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

func (n *noopEventMetricProvider) NatsRequest(ctx context.Context, opts ...otelmetric.AddOption) {}
func (n *noopEventMetricProvider) NatsRequestFailure(ctx context.Context, opts ...otelmetric.AddOption) {
}
func (n *noopEventMetricProvider) Flush(ctx context.Context) error { return nil }
func (n *noopEventMetricProvider) Shutdown() error                 { return nil }

type NoopEventMetricStore struct{}

func (n *NoopEventMetricStore) KafkaPublish(ctx context.Context, providerID string, topic string) {}

func (n *NoopEventMetricStore) KafkaPublishFailure(ctx context.Context, providerID string, topic string) {
}

func (n *NoopEventMetricStore) KafkaMessageReceived(ctx context.Context, providerID string, topic string) {
}

func (n *NoopEventMetricStore) RedisPublish(ctx context.Context, providerID string, channel string) {}

func (n *NoopEventMetricStore) RedisPublishFailure(ctx context.Context, providerID string, channel string) {
}

func (n *NoopEventMetricStore) RedisMessageReceived(ctx context.Context, providerID string, channel string) {
}

func (n *NoopEventMetricStore) NatsPublish(ctx context.Context, providerID string, subject string) {}

func (n *NoopEventMetricStore) NatsPublishFailure(ctx context.Context, providerID string, subject string) {
}

func (n *NoopEventMetricStore) NatsMessageReceived(ctx context.Context, providerID string, subject string) {
}

func (n *NoopEventMetricStore) NatsRequest(ctx context.Context, providerID string, subject string) {}

func (n *NoopEventMetricStore) NatsRequestFailure(ctx context.Context, providerID string, subject string) {
}

func (n *NoopEventMetricStore) Flush(ctx context.Context) error {
	return nil
}

func (n *NoopEventMetricStore) Shutdown(ctx context.Context) error {
	return nil
}

func NewNoopEventMetricStore() *NoopEventMetricStore {
	return &NoopEventMetricStore{}
}
