package metric

import (
	"context"
	"time"

	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
)

// This is dummy implementation of metric.Provider interface to avoid nil checks in the code
// and to simplify the code when metrics are disabled.

type NoopMetrics struct{}

func (n NoopMetrics) MeasureInFlight(ctx context.Context, sliceAttr []attribute.KeyValue, opt otelmetric.AddOption) func() {
	return func() {

	}
}

func (n NoopMetrics) MeasureRequestCount(ctx context.Context, sliceAttr []attribute.KeyValue, opt otelmetric.AddOption) {

}

func (n NoopMetrics) MeasureRequestSize(ctx context.Context, contentLength int64, sliceAttr []attribute.KeyValue, opt otelmetric.AddOption) {

}

func (n NoopMetrics) MeasureResponseSize(ctx context.Context, size int64, sliceAttr []attribute.KeyValue, opt otelmetric.AddOption) {

}

func (n NoopMetrics) MeasureLatency(ctx context.Context, latency time.Duration, sliceAttr []attribute.KeyValue, opt otelmetric.RecordOption) {

}

func (n NoopMetrics) MeasureRequestError(ctx context.Context, sliceAttr []attribute.KeyValue, opt otelmetric.AddOption) {

}

func (n NoopMetrics) MeasureOperationPlanningTime(ctx context.Context, planningTime time.Duration, sliceAttr []attribute.KeyValue, opt otelmetric.RecordOption) {

}

func (n NoopMetrics) MeasureSchemaFieldUsage(ctx context.Context, count int64, sliceAttr []attribute.KeyValue, opt otelmetric.AddOption) {

}

func (n NoopMetrics) Flush(ctx context.Context) error {
	return nil
}

func (n NoopMetrics) Shutdown(ctx context.Context) error {
	return nil
}

func (n NoopMetrics) MeasureCircuitBreakerShortCircuit(ctx context.Context, sliceAttr []attribute.KeyValue, opt otelmetric.AddOption) {
}
func (n NoopMetrics) SetCircuitBreakerState(ctx context.Context, state bool, sliceAttr []attribute.KeyValue, opt otelmetric.RecordOption) {
}

func NewNoopMetrics() Store {
	return &NoopMetrics{}
}
