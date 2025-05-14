package metric

import (
	"context"
	"fmt"

	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
)

// Connection metric constants
const (
	// Counters
	connectionNewTotal   = "router.connection.new_total"   // Total number of new connections
	connectionReuseTotal = "router.connection.reuse_total" // Total number of reused connections

	// Histograms
	dnsDuration               = "router.connection.dns_duration_ms"           // DNS resolution duration in milliseconds
	dialDuration              = "router.connection.dial_duration_ms"          // TCP dial duration in milliseconds
	tlsHandshakeDuration      = "router.connection.tls_handshake_duration_ms" // TLS handshake duration in milliseconds
	totalConnectionDuration   = "router.connection.total_duration_ms"         // Total connection duration in milliseconds
	connectionAcquireDuration = "router.connection.acquire_duration_ms"       // Connection acquire duration in milliseconds
)

var (
	// Counter options
	connectionNewTotalOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Total number of new connections"),
	}

	connectionReuseTotalOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Total number of reused connections"),
	}

	// Histogram options
	dnsDurationOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("ms"),
		otelmetric.WithDescription("DNS resolution duration in milliseconds"),
	}

	dialDurationOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("ms"),
		otelmetric.WithDescription("TCP dial duration in milliseconds"),
	}

	tlsHandshakeDurationOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("ms"),
		otelmetric.WithDescription("TLS handshake duration in milliseconds"),
	}

	totalConnectionDurationOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("ms"),
		otelmetric.WithDescription("Total connection duration in milliseconds"),
	}

	connectionAcquireDurationOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("ms"),
		otelmetric.WithDescription("Connection acquire duration in milliseconds"),
	}
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

type connectionInstruments struct {
	// Counters
	connectionNewTotal   otelmetric.Int64Counter
	connectionReuseTotal otelmetric.Int64Counter

	// Histograms
	dnsDuration               otelmetric.Float64Histogram
	dialDuration              otelmetric.Float64Histogram
	tlsHandshakeDuration      otelmetric.Float64Histogram
	totalConnectionDuration   otelmetric.Float64Histogram
	connectionAcquireDuration otelmetric.Float64Histogram
}

type ConnectionMetrics struct {
	instruments    *connectionInstruments
	meter          otelmetric.Meter
	baseAttributes []attribute.KeyValue
	logger         *zap.Logger

	otlpConnectionMetrics ConnectionMetricProvider
	promConnectionMetrics ConnectionMetricProvider

	baseAttributesOpt otelmetric.MeasurementOption
}

func NewConnectionMetricStore(logger *zap.Logger, baseAttributes []attribute.KeyValue, otelProvider, promProvider *metric.MeterProvider, metricsConfig *Config) (*ConnectionMetrics, error) {
	connMetrics := &ConnectionMetrics{
		baseAttributes:    baseAttributes,
		logger:            logger,
		baseAttributesOpt: otelmetric.WithAttributes(baseAttributes...),
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

func newConnectionInstruments(meterProvider *metric.MeterProvider) (*connectionInstruments, error) {
	meter := meterProvider.Meter("router.connection")

	// Initialize counters
	connectionNewTotal, err := meter.Int64Counter(
		connectionNewTotal,
		connectionNewTotalOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection new total counter: %w", err)
	}

	connectionReuseTotal, err := meter.Int64Counter(
		connectionReuseTotal,
		connectionReuseTotalOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection reuse total counter: %w", err)
	}

	// Initialize histograms
	dnsDuration, err := meter.Float64Histogram(
		dnsDuration,
		dnsDurationOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create DNS duration histogram: %w", err)
	}

	dialDuration, err := meter.Float64Histogram(
		dialDuration,
		dialDurationOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create dial duration histogram: %w", err)
	}

	tlsHandshakeDuration, err := meter.Float64Histogram(
		tlsHandshakeDuration,
		tlsHandshakeDurationOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create TLS handshake duration histogram: %w", err)
	}

	totalConnectionDuration, err := meter.Float64Histogram(
		totalConnectionDuration,
		totalConnectionDurationOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create total connection duration histogram: %w", err)
	}

	connectionAcquireDuration, err := meter.Float64Histogram(
		connectionAcquireDuration,
		connectionAcquireDurationOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection acquire duration histogram: %w", err)
	}

	return &connectionInstruments{
		connectionNewTotal:        connectionNewTotal,
		connectionReuseTotal:      connectionReuseTotal,
		dnsDuration:               dnsDuration,
		dialDuration:              dialDuration,
		tlsHandshakeDuration:      tlsHandshakeDuration,
		totalConnectionDuration:   totalConnectionDuration,
		connectionAcquireDuration: connectionAcquireDuration,
	}, nil
}
