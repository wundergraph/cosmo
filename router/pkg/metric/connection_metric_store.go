package metric

import (
	"context"
	"errors"
	"fmt"

	"github.com/wundergraph/cosmo/router/pkg/otel"

	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
)

// ConnectionMetricProvider is the interface that wraps the basic connection metric methods.
// We maintain two providers, one for OTEL and one for Prometheus.
type ConnectionMetricProvider interface {
	MeasureConnectionAcquireDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption)
	MeasureMaxConnections(ctx context.Context, count int64, opts ...otelmetric.RecordOption)
	Shutdown() error
}

// ConnectionMetricStore is the interface for connection and pool metrics only.
type ConnectionMetricStore interface {
	MeasureConnectionAcquireDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
	Shutdown(ctx context.Context) error
}

type ConnectionMetrics struct {
	baseAttributes []attribute.KeyValue
	logger         *zap.Logger

	otlpConnectionMetrics ConnectionMetricProvider
	promConnectionMetrics ConnectionMetricProvider
}

func NewConnectionMetricStore(
	logger *zap.Logger,
	baseAttributes []attribute.KeyValue,
	otelProvider, promProvider *metric.MeterProvider,
	metricsConfig *Config,
	connectionPoolStats *ConnectionPoolStats,
) (*ConnectionMetrics, error) {
	connMetrics := &ConnectionMetrics{
		baseAttributes:        baseAttributes,
		logger:                logger,
		otlpConnectionMetrics: &noopConnectionMetricProvider{},
		promConnectionMetrics: &noopConnectionMetricProvider{},
	}

	if metricsConfig.OpenTelemetry.ConnectionStats {
		otlpMetrics, err := newOtlpConnectionMetrics(logger, otelProvider, connectionPoolStats, baseAttributes)
		if err != nil {
			return nil, fmt.Errorf("failed to create otlp connection metrics: %w", err)
		}
		connMetrics.otlpConnectionMetrics = otlpMetrics
	}

	if metricsConfig.Prometheus.ConnectionStats {
		promMetrics, err := newPromConnectionMetrics(logger, promProvider, connectionPoolStats, baseAttributes)
		if err != nil {
			return nil, fmt.Errorf("failed to create prometheus connection metrics: %w", err)
		}
		connMetrics.promConnectionMetrics = promMetrics
	}

	return connMetrics, nil
}

func (c *ConnectionMetrics) MeasureMaxConnections(ctx context.Context, reused bool, attrs ...attribute.KeyValue) {
	// Add the reused attribute to the base attributes
	reusedAttr := otel.WgClientReusedConnection.Bool(reused)
	allAttrs := append([]attribute.KeyValue{}, c.baseAttributes...)
	allAttrs = append(allAttrs, reusedAttr)
	allAttrs = append(allAttrs, attrs...)

	opts := otelmetric.WithAttributes(allAttrs...)

	c.otlpConnectionMetrics.MeasureMaxConnections(ctx, 1, opts)
	c.promConnectionMetrics.MeasureMaxConnections(ctx, 1, opts)
}

func (c *ConnectionMetrics) MeasureConnectionAcquireDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	copied := append([]attribute.KeyValue{}, c.baseAttributes...)
	opts := otelmetric.WithAttributes(append(copied, attrs...)...)

	c.otlpConnectionMetrics.MeasureConnectionAcquireDuration(ctx, duration, opts)
	c.promConnectionMetrics.MeasureConnectionAcquireDuration(ctx, duration, opts)
}

// Shutdown stops the metric instruments. It does not flush: the shared meter
// providers are flushed once centrally during graph server shutdown to avoid
// redundant ForceFlush calls that all compete for a single shutdown deadline.
func (h *ConnectionMetrics) Shutdown(_ context.Context) error {
	var err error

	if errProm := h.promConnectionMetrics.Shutdown(); errProm != nil {
		err = errors.Join(err, fmt.Errorf("failed to shutdown prom metrics: %w", errProm))
	}

	if errOtlp := h.otlpConnectionMetrics.Shutdown(); errOtlp != nil {
		err = errors.Join(err, fmt.Errorf("failed to shutdown otlp metrics: %w", errOtlp))
	}

	return err
}
