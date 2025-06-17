package metric

import (
	"context"
	"github.com/cep21/circuit/v4"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"time"
)

func NewCircuitBreakerMetricsConfig(subgraphName string, metrics Store, baseAttributes []attribute.KeyValue) circuit.Config {
	attributes := append([]attribute.KeyValue{
		otel.WgSubgraphName.String(subgraphName),
	}, baseAttributes...)

	metricsWrapper := &CircuitBreakerMetricsConfig{
		metrics:    metrics,
		attributes: attributes,
	}
	return circuit.Config{
		Metrics: circuit.MetricsCollectors{
			Circuit: []circuit.Metrics{metricsWrapper},
			Run:     []circuit.RunMetrics{metricsWrapper},
		},
	}
}

type CircuitBreakerMetricsConfig struct {
	metrics    Store
	attributes []attribute.KeyValue
}

func (w *CircuitBreakerMetricsConfig) Closed(ctx context.Context, _ time.Time) {
	w.metrics.SetCircuitBreakerState(ctx, false, nil, otelmetric.WithAttributes(w.attributes...))
}

func (w *CircuitBreakerMetricsConfig) Opened(ctx context.Context, _ time.Time) {
	w.metrics.SetCircuitBreakerState(ctx, true, nil, otelmetric.WithAttributes(w.attributes...))
}

func (w *CircuitBreakerMetricsConfig) ErrShortCircuit(ctx context.Context, now time.Time) {
	w.metrics.MeasureCircuitBreakerShortCircuit(ctx, nil, otelmetric.WithAttributes(w.attributes...))
}

// No-op functions required to satisfy the interface
// We can add them if these make sense later
func (w *CircuitBreakerMetricsConfig) Success(ctx context.Context, now time.Time, duration time.Duration) {
}
func (w *CircuitBreakerMetricsConfig) ErrFailure(ctx context.Context, now time.Time, duration time.Duration) {
}
func (w *CircuitBreakerMetricsConfig) ErrTimeout(ctx context.Context, now time.Time, duration time.Duration) {
}
func (w *CircuitBreakerMetricsConfig) ErrBadRequest(ctx context.Context, now time.Time, duration time.Duration) {
}
func (w *CircuitBreakerMetricsConfig) ErrInterrupt(ctx context.Context, now time.Time, duration time.Duration) {
}
func (w *CircuitBreakerMetricsConfig) ErrConcurrencyLimitReject(ctx context.Context, now time.Time) {
}
