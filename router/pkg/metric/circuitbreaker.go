package metric

import (
	"context"
	"github.com/cep21/circuit/v4"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"time"
)

type CircuitMetricStore interface {
	MeasureCircuitBreakerShortCircuit(ctx context.Context, sliceAttr []attribute.KeyValue, opt otelmetric.AddOption)
	SetCircuitBreakerState(ctx context.Context, state bool, sliceAttr []attribute.KeyValue, opt otelmetric.RecordOption)
}

func NewCircuitBreakerMetricsConfig(subgraphNames []string, metrics CircuitMetricStore, baseAttributes []attribute.KeyValue) circuit.Config {
	values := []attribute.KeyValue{
		otel.WgSubgraphName.StringSlice(subgraphNames),
	}
	values = append(values, baseAttributes...)

	metricsWrapper := &CircuitBreakerMetricsConfig{
		metrics:    metrics,
		attributes: values,
	}
	return circuit.Config{
		Metrics: circuit.MetricsCollectors{
			Circuit: []circuit.Metrics{metricsWrapper},
			Run:     []circuit.RunMetrics{metricsWrapper},
		},
	}
}

type CircuitBreakerMetricsConfig struct {
	metrics    CircuitMetricStore
	attributes []attribute.KeyValue
}

func (w *CircuitBreakerMetricsConfig) Closed(ctx context.Context, _ time.Time) {
	w.metrics.SetCircuitBreakerState(ctx, false, nil, otelmetric.WithAttributes(w.attributes...))
}

func (w *CircuitBreakerMetricsConfig) Opened(ctx context.Context, _ time.Time) {
	w.metrics.SetCircuitBreakerState(ctx, true, nil, otelmetric.WithAttributes(w.attributes...))
}

func (w *CircuitBreakerMetricsConfig) ErrShortCircuit(ctx context.Context, _ time.Time) {
	w.metrics.MeasureCircuitBreakerShortCircuit(ctx, nil, otelmetric.WithAttributes(w.attributes...))
}

// No-op functions required to satisfy the interface
// We can add them if these make sense later
func (w *CircuitBreakerMetricsConfig) Success(_ context.Context, _ time.Time, _ time.Duration) {
}
func (w *CircuitBreakerMetricsConfig) ErrFailure(_ context.Context, _ time.Time, _ time.Duration) {
}
func (w *CircuitBreakerMetricsConfig) ErrTimeout(_ context.Context, _ time.Time, _ time.Duration) {
}
func (w *CircuitBreakerMetricsConfig) ErrBadRequest(_ context.Context, _ time.Time, _ time.Duration) {
}
func (w *CircuitBreakerMetricsConfig) ErrInterrupt(_ context.Context, _ time.Time, _ time.Duration) {
}
func (w *CircuitBreakerMetricsConfig) ErrConcurrencyLimitReject(_ context.Context, _ time.Time) {
}
