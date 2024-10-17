package metric

import (
	"context"
	"go.opentelemetry.io/otel/attribute"
	"time"
)

// This is dummy implementation of metric.Provider interface to avoid nil checks in the code
// and to simplify the code when metrics are disabled.

type NoopMetrics struct{}

func (n NoopMetrics) MeasureRequestError(ctx context.Context, attr ...attribute.KeyValue) {
}

func NewNoopMetrics() Store {
	return &NoopMetrics{}
}

func (n NoopMetrics) MeasureInFlight(ctx context.Context, attr ...attribute.KeyValue) func() {
	return func() {}
}

func (n NoopMetrics) MeasureRequestCount(ctx context.Context, attr ...attribute.KeyValue) {
}

func (n NoopMetrics) MeasureRequestSize(ctx context.Context, contentLength int64, attr ...attribute.KeyValue) {
}

func (n NoopMetrics) MeasureResponseSize(ctx context.Context, size int64, attr ...attribute.KeyValue) {
}

func (n NoopMetrics) MeasureLatency(ctx context.Context, latency time.Duration, attr ...attribute.KeyValue) {
}

func (n NoopMetrics) MeasureOperationPlanningTime(ctx context.Context, planningTime time.Duration, attr ...attribute.KeyValue) {
}

func (n NoopMetrics) Flush(ctx context.Context) error {
	return nil
}

func (n NoopMetrics) Shutdown(ctx context.Context) error {
	return nil
}
