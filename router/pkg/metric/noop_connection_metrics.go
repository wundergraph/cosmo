package metric

import (
	"context"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
)

// A noop metric provider so we do not need to do nil checks for each provider call from the store
type noopConnectionMetricProvider struct{}

func (h *noopConnectionMetricProvider) MeasureConnectionAcquireDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
}

func (h *noopConnectionMetricProvider) MeasureMaxConnections(ctx context.Context, count int64, opts ...otelmetric.RecordOption) {

}

func (h *noopConnectionMetricProvider) MeasureDNSLookupDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
}

func (h *noopConnectionMetricProvider) MeasureTCPConnectDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
}

func (h *noopConnectionMetricProvider) MeasureTLSHandshakeDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
}

func (h *noopConnectionMetricProvider) MeasureTimeToFirstByte(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
}

func (h *noopConnectionMetricProvider) Flush(ctx context.Context) error {
	return nil
}

func (h *noopConnectionMetricProvider) Shutdown() error {
	return nil
}

type NoopConnectionMetricStore struct{}

func (h *NoopConnectionMetricStore) MeasureConnectionAcquireDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
}
func (h *NoopConnectionMetricStore) MeasureDNSLookupDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
}
func (h *NoopConnectionMetricStore) MeasureTCPConnectDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
}
func (h *NoopConnectionMetricStore) MeasureTLSHandshakeDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
}
func (h *NoopConnectionMetricStore) MeasureTimeToFirstByte(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
}
func (h *NoopConnectionMetricStore) Flush(ctx context.Context) error    { return nil }
func (h *NoopConnectionMetricStore) Shutdown(ctx context.Context) error { return nil }
