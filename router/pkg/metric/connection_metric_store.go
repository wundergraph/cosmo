package metric

import (
	"context"
	"fmt"

	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
)

// ConnectionMetricProvider is the interface that wraps the basic connection metric methods.
// We maintain two providers, one for OTEL and one for Prometheus.
type ConnectionMetricProvider interface {
	MeasureDNSDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption)
	MeasureDialDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption)
	MeasureTLSHandshakeDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption)
	MeasureTotalConnectionDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption)
	MeasureConnectionAcquireDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption)
	MeasureConnections(ctx context.Context, count int64, opts ...otelmetric.AddOption)
	MeasureConnectionRetries(ctx context.Context, count int64, opts ...otelmetric.AddOption)
	Flush(ctx context.Context) error
}

// ConnectionMetricStore is the interface for connection and pool metrics only.
type ConnectionMetricStore interface {
	MeasureDNSDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
	MeasureDialDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
	MeasureTLSHandshakeDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
	MeasureTotalConnectionDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
	MeasureConnections(ctx context.Context, reused bool, attrs ...attribute.KeyValue)
	MeasureConnectionAcquireDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
	MeasureConnectionRetries(ctx context.Context, attrs ...attribute.KeyValue)
}

type ConnectionMetrics struct {
	baseAttributes []attribute.KeyValue
	logger         *zap.Logger

	otlpConnectionMetrics ConnectionMetricProvider
	promConnectionMetrics ConnectionMetricProvider
}

func NewConnectionMetricStore(logger *zap.Logger, baseAttributes []attribute.KeyValue, otelProvider, promProvider *metric.MeterProvider, metricsConfig *Config) (*ConnectionMetrics, error) {
	connMetrics := &ConnectionMetrics{
		baseAttributes: baseAttributes,
		logger:         logger,
	}

	if metricsConfig.OpenTelemetry.ConnectionStats {
		otlpMetrics, err := newOtlpConnectionMetrics(logger, otelProvider)
		if err != nil {
			return nil, fmt.Errorf("failed to create otlp connection metrics: %w", err)
		}
		connMetrics.otlpConnectionMetrics = otlpMetrics
	}

	if metricsConfig.Prometheus.ConnectionStats {
		promMetrics, err := newPromConnectionMetrics(logger, promProvider)
		if err != nil {
			return nil, fmt.Errorf("failed to create prometheus connection metrics: %w", err)
		}
		connMetrics.promConnectionMetrics = promMetrics
	}

	return connMetrics, nil
}

func (c *ConnectionMetrics) MeasureDNSDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	opts := otelmetric.WithAttributes(append(c.baseAttributes, attrs...)...)
	if c.otlpConnectionMetrics != nil {
		c.otlpConnectionMetrics.MeasureDNSDuration(ctx, duration, opts)
	}
	if c.promConnectionMetrics != nil {
		c.promConnectionMetrics.MeasureDNSDuration(ctx, duration, opts)
	}
}

func (c *ConnectionMetrics) MeasureDialDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	opts := otelmetric.WithAttributes(append(c.baseAttributes, attrs...)...)
	if c.otlpConnectionMetrics != nil {
		c.otlpConnectionMetrics.MeasureDialDuration(ctx, duration, opts)
	}
	if c.promConnectionMetrics != nil {
		c.promConnectionMetrics.MeasureDialDuration(ctx, duration, opts)
	}
}

func (c *ConnectionMetrics) MeasureTLSHandshakeDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	opts := otelmetric.WithAttributes(append(c.baseAttributes, attrs...)...)
	if c.otlpConnectionMetrics != nil {
		c.otlpConnectionMetrics.MeasureTLSHandshakeDuration(ctx, duration, opts)
	}
	if c.promConnectionMetrics != nil {
		c.promConnectionMetrics.MeasureTLSHandshakeDuration(ctx, duration, opts)
	}
}

func (c *ConnectionMetrics) MeasureTotalConnectionDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	opts := otelmetric.WithAttributes(append(c.baseAttributes, attrs...)...)
	if c.otlpConnectionMetrics != nil {
		c.otlpConnectionMetrics.MeasureTotalConnectionDuration(ctx, duration, opts)
	}
	if c.promConnectionMetrics != nil {
		c.promConnectionMetrics.MeasureTotalConnectionDuration(ctx, duration, opts)
	}
}

func (c *ConnectionMetrics) MeasureConnections(ctx context.Context, reused bool, attrs ...attribute.KeyValue) {
	// Add the reused attribute to the base attributes
	reusedAttr := attribute.Bool("reused", reused)
	allAttrs := append(c.baseAttributes, reusedAttr)
	allAttrs = append(allAttrs, attrs...)

	opts := otelmetric.WithAttributes(allAttrs...)

	if c.otlpConnectionMetrics != nil {
		c.otlpConnectionMetrics.MeasureConnections(ctx, 1, opts)
	}
	if c.promConnectionMetrics != nil {
		c.promConnectionMetrics.MeasureConnections(ctx, 1, opts)
	}
}

func (c *ConnectionMetrics) MeasureConnectionAcquireDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	opts := otelmetric.WithAttributes(append(c.baseAttributes, attrs...)...)
	if c.otlpConnectionMetrics != nil {
		c.otlpConnectionMetrics.MeasureConnectionAcquireDuration(ctx, duration, opts)
	}
	if c.promConnectionMetrics != nil {
		c.promConnectionMetrics.MeasureConnectionAcquireDuration(ctx, duration, opts)
	}
}

func (c *ConnectionMetrics) MeasureConnectionRetries(ctx context.Context, attrs ...attribute.KeyValue) {
	opts := otelmetric.WithAttributes(append(c.baseAttributes, attrs...)...)
	if c.otlpConnectionMetrics != nil {
		c.otlpConnectionMetrics.MeasureConnectionRetries(ctx, 1, opts)
	}
	if c.promConnectionMetrics != nil {
		c.promConnectionMetrics.MeasureConnectionRetries(ctx, 1, opts)
	}
}
