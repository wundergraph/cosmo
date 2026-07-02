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
	MeasureDNSLookupDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption)
	MeasureTCPConnectDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption)
	MeasureTLSHandshakeDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption)
	MeasureTimeToFirstByte(ctx context.Context, duration float64, opts ...otelmetric.RecordOption)
	Shutdown() error
}

// ConnectionMetricStore is the interface for connection and pool metrics only.
type ConnectionMetricStore interface {
	MeasureConnectionAcquireDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
	MeasureDNSLookupDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
	MeasureTCPConnectDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
	MeasureTLSHandshakeDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
	MeasureTimeToFirstByte(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
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

	if metricsConfig.OpenTelemetry.ConnectionStats || metricsConfig.OpenTelemetry.NetworkStats {
		otlpMetrics, err := newOtlpConnectionMetrics(logger, otelProvider, connectionPoolStats, baseAttributes, metricsConfig.OpenTelemetry.NetworkStats)
		if err != nil {
			return nil, fmt.Errorf("failed to create otlp connection metrics: %w", err)
		}
		connMetrics.otlpConnectionMetrics = otlpMetrics
	}

	if metricsConfig.Prometheus.ConnectionStats || metricsConfig.Prometheus.NetworkStats {
		promMetrics, err := newPromConnectionMetrics(logger, promProvider, connectionPoolStats, baseAttributes, metricsConfig.Prometheus.NetworkStats)
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
	opts := c.recordOpts(attrs)
	c.otlpConnectionMetrics.MeasureConnectionAcquireDuration(ctx, duration, opts)
	c.promConnectionMetrics.MeasureConnectionAcquireDuration(ctx, duration, opts)
}

func (c *ConnectionMetrics) MeasureDNSLookupDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	opts := c.recordOpts(attrs)
	c.otlpConnectionMetrics.MeasureDNSLookupDuration(ctx, duration, opts)
	c.promConnectionMetrics.MeasureDNSLookupDuration(ctx, duration, opts)
}

func (c *ConnectionMetrics) MeasureTCPConnectDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	opts := c.recordOpts(attrs)
	c.otlpConnectionMetrics.MeasureTCPConnectDuration(ctx, duration, opts)
	c.promConnectionMetrics.MeasureTCPConnectDuration(ctx, duration, opts)
}

func (c *ConnectionMetrics) MeasureTLSHandshakeDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	opts := c.recordOpts(attrs)
	c.otlpConnectionMetrics.MeasureTLSHandshakeDuration(ctx, duration, opts)
	c.promConnectionMetrics.MeasureTLSHandshakeDuration(ctx, duration, opts)
}

func (c *ConnectionMetrics) MeasureTimeToFirstByte(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	opts := c.recordOpts(attrs)
	c.otlpConnectionMetrics.MeasureTimeToFirstByte(ctx, duration, opts)
	c.promConnectionMetrics.MeasureTimeToFirstByte(ctx, duration, opts)
}

func (c *ConnectionMetrics) recordOpts(attrs []attribute.KeyValue) otelmetric.RecordOption {
	copied := append([]attribute.KeyValue{}, c.baseAttributes...)
	return otelmetric.WithAttributes(append(copied, attrs...)...)
}

// Flush flushes the metrics to the backend synchronously.
func (h *ConnectionMetrics) Shutdown(ctx context.Context) error {
	var err error

	if errProm := h.promConnectionMetrics.Shutdown(); errProm != nil {
		err = errors.Join(err, fmt.Errorf("failed to shutdown prom metrics: %w", errProm))
	}

	if errOtlp := h.otlpConnectionMetrics.Shutdown(); errOtlp != nil {
		err = errors.Join(err, fmt.Errorf("failed to shutdown otlp metrics: %w", errOtlp))
	}

	return err
}
