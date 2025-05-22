package metric

import (
	"context"
	otelmetric "go.opentelemetry.io/otel/metric"
)

// A noop metric provider so we do not need to do nil checks for each provider call from the store
type noopConnectionMetricProvider struct{}

func (h *noopConnectionMetricProvider) MeasureConnectionAcquireDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
}

func (h *noopConnectionMetricProvider) MeasureMaxConnections(ctx context.Context, count int64, opts ...otelmetric.RecordOption) {

}

func (h *noopConnectionMetricProvider) Flush(ctx context.Context) error {
	return nil
}

func (h *noopConnectionMetricProvider) Shutdown() error {
	return nil
}
