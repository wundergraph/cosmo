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
	MeasureNewConnections(ctx context.Context, count int64, opts ...otelmetric.AddOption)
	MeasureReusedConnections(ctx context.Context, count int64, opts ...otelmetric.AddOption)
	Flush(ctx context.Context) error
}

// ConnectionMetricStore is the interface for connection and pool metrics only.
type ConnectionMetricStore interface {
	MeasureDNSDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
	MeasureDialDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
	MeasureTLSHandshakeDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
	MeasureTotalConnectionDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
	MeasureNewConnections(ctx context.Context, attrs ...attribute.KeyValue)
	MeasureReusedConnections(ctx context.Context, attrs ...attribute.KeyValue)
	MeasureConnectionAcquireDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
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

func (c *ConnectionMetrics) MeasureNewConnections(ctx context.Context, attrs ...attribute.KeyValue) {
	opts := otelmetric.WithAttributes(append(c.baseAttributes, attrs...)...)
	if c.otlpConnectionMetrics != nil {
		c.otlpConnectionMetrics.MeasureNewConnections(ctx, 1, opts)
	}
	if c.promConnectionMetrics != nil {
		c.promConnectionMetrics.MeasureNewConnections(ctx, 1, opts)
	}
}

func (c *ConnectionMetrics) MeasureReusedConnections(ctx context.Context, attrs ...attribute.KeyValue) {
	opts := otelmetric.WithAttributes(append(c.baseAttributes, attrs...)...)
	if c.otlpConnectionMetrics != nil {
		c.otlpConnectionMetrics.MeasureReusedConnections(ctx, 1, opts)
	}
	if c.promConnectionMetrics != nil {
		c.promConnectionMetrics.MeasureReusedConnections(ctx, 1, opts)
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
