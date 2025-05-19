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
	MeasureTotalConnectionDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption)
	MeasureMaxConnections(ctx context.Context, count int64, opts ...otelmetric.RecordOption)
	Flush(ctx context.Context) error
	Shutdown() error
}

// ConnectionMetricStore is the interface for connection and pool metrics only.
type ConnectionMetricStore interface {
	MeasureTotalConnectionDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
	MeasureMaxConnections(ctx context.Context, reused bool, attrs ...attribute.KeyValue)
	Flush(ctx context.Context) error
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
		baseAttributes: baseAttributes,
		logger:         logger,
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

func (c *ConnectionMetrics) MeasureTotalConnectionDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	copied := append([]attribute.KeyValue{}, c.baseAttributes...)
	opts := otelmetric.WithAttributes(append(copied, attrs...)...)

	if c.otlpConnectionMetrics != nil {
		c.otlpConnectionMetrics.MeasureTotalConnectionDuration(ctx, duration, opts)
	}
	if c.promConnectionMetrics != nil {
		c.promConnectionMetrics.MeasureTotalConnectionDuration(ctx, duration, opts)
	}
}

func (c *ConnectionMetrics) MeasureMaxConnections(ctx context.Context, reused bool, attrs ...attribute.KeyValue) {
	// Add the reused attribute to the base attributes
	reusedAttr := otel.WgConnReused.Bool(reused)
	allAttrs := append([]attribute.KeyValue{}, c.baseAttributes...)
	allAttrs = append(allAttrs, reusedAttr)
	allAttrs = append(allAttrs, attrs...)

	opts := otelmetric.WithAttributes(allAttrs...)

	if c.otlpConnectionMetrics != nil {
		c.otlpConnectionMetrics.MeasureMaxConnections(ctx, 1, opts)
	}
	if c.promConnectionMetrics != nil {
		c.promConnectionMetrics.MeasureMaxConnections(ctx, 1, opts)
	}
}

func (c *ConnectionMetrics) MeasureConnectionAcquireDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	copied := append([]attribute.KeyValue{}, c.baseAttributes...)
	opts := otelmetric.WithAttributes(append(copied, attrs...)...)

	if c.otlpConnectionMetrics != nil {
		c.otlpConnectionMetrics.MeasureConnectionAcquireDuration(ctx, duration, opts)
	}
	if c.promConnectionMetrics != nil {
		c.promConnectionMetrics.MeasureConnectionAcquireDuration(ctx, duration, opts)
	}
}

// Flush flushes the metrics to the backend synchronously.
func (h *ConnectionMetrics) Flush(ctx context.Context) error {

	var err error

	if h.otlpConnectionMetrics != nil {
		errOtlp := h.otlpConnectionMetrics.Flush(ctx)
		if errOtlp != nil {
			err = errors.Join(err, fmt.Errorf("failed to flush otlp metrics: %w", errOtlp))
		}
	}
	if h.promConnectionMetrics != nil {
		errProm := h.promConnectionMetrics.Flush(ctx)
		if errProm != nil {
			err = errors.Join(err, fmt.Errorf("failed to flush prometheus metrics: %w", errProm))
		}
	}

	return err
}

// Shutdown flushes the metrics and stops the runtime metrics.
func (h *ConnectionMetrics) Shutdown(ctx context.Context) error {

	var err error

	if errFlush := h.Flush(ctx); errFlush != nil {
		err = errors.Join(err, fmt.Errorf("failed to flush metrics: %w", errFlush))
	}

	if h.promConnectionMetrics != nil {
		errProm := h.promConnectionMetrics.Shutdown()
		if err != nil {
			err = errors.Join(err, fmt.Errorf("failed to shutdown prom metrics: %w", errProm))
		}
	}

	if h.otlpConnectionMetrics != nil {
		errOtlp := h.otlpConnectionMetrics.Shutdown()
		if err != nil {
			err = errors.Join(err, fmt.Errorf("failed to shutdown otlp metrics: %w", errOtlp))
		}
	}

	return err
}
