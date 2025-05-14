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
	ConnectionCounter      = "router.connection.count"           // Total number of connections
	ConnectionLatency      = "router.connection.latency_ms"      // Connection latency in milliseconds
	ConnectionErrorCounter = "router.connection.error"           // Total number of connection errors
	PoolSize               = "router.connection.pool.size"       // Current size of the connection pool
	PoolMaxSize            = "router.connection.pool.max_size"   // Maximum size of the connection pool
	PoolMinSize            = "router.connection.pool.min_size"   // Minimum size of the connection pool
	PoolIdleSize           = "router.connection.pool.idle_size"  // Number of idle connections in the pool
	PoolWaitTime           = "router.connection.pool.wait_ms"    // Time spent waiting for a connection
	PoolWaitCount          = "router.connection.pool.wait_count" // Number of times waiting for a connection
)

var (
	// Connection metric options
	ConnectionCounterOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Total number of connections"),
	}

	ConnectionLatencyOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("ms"),
		otelmetric.WithDescription("Connection latency in milliseconds"),
	}

	ConnectionErrorCounterOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Total number of connection errors"),
	}

	PoolSizeOptions = []otelmetric.Int64UpDownCounterOption{
		otelmetric.WithDescription("Current size of the connection pool"),
	}

	PoolMaxSizeOptions = []otelmetric.Int64UpDownCounterOption{
		otelmetric.WithDescription("Maximum size of the connection pool"),
	}

	PoolMinSizeOptions = []otelmetric.Int64UpDownCounterOption{
		otelmetric.WithDescription("Minimum size of the connection pool"),
	}

	PoolIdleSizeOptions = []otelmetric.Int64UpDownCounterOption{
		otelmetric.WithDescription("Number of idle connections in the pool"),
	}

	PoolWaitTimeOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("ms"),
		otelmetric.WithDescription("Time spent waiting for a connection"),
	}

	PoolWaitCountOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of times waiting for a connection"),
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
	MeasureConnectionNewTotal(ctx context.Context, count int64, opts ...otelmetric.AddOption)
	MeasureConnectionReuseTotal(ctx context.Context, count int64, opts ...otelmetric.AddOption)
	Flush(ctx context.Context) error
}

// ConnectionMetricStore is the interface for connection and pool metrics only.
type ConnectionMetricStore interface {
	MeasureDNSDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
	MeasureDialDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
	MeasureTLSHandshakeDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
	MeasureTotalConnectionDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
	MeasureConnectionNewTotal(ctx context.Context, count int64, attrs ...attribute.KeyValue)
	MeasureConnectionReuseTotal(ctx context.Context, count int64, attrs ...attribute.KeyValue)
	MeasureConnectionAcquireDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue)
}

type connectionInstruments struct {
	connectionCounter      otelmetric.Int64Counter
	connectionLatency      otelmetric.Float64Histogram
	connectionErrorCounter otelmetric.Int64Counter
	poolSize               otelmetric.Int64UpDownCounter
	poolMaxSize            otelmetric.Int64UpDownCounter
	poolMinSize            otelmetric.Int64UpDownCounter
	poolIdleSize           otelmetric.Int64UpDownCounter
	poolWaitTime           otelmetric.Float64Histogram
	poolWaitCount          otelmetric.Int64Counter
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
		// Create OTLP metrics provider
		otlpMetrics, err := newOtlpConnectionMetrics(logger, otelProvider)
		if err != nil {
			return nil, fmt.Errorf("failed to create otlp connection metrics: %w", err)
		}
		connMetrics.otlpConnectionMetrics = otlpMetrics
	}

	if metricsConfig.Prometheus.ConnectionStats {
		// Create Prometheus metrics provider
		promMetrics, err := newPromConnectionMetrics(logger, promProvider)
		if err != nil {
			return nil, fmt.Errorf("failed to create prometheus connection metrics: %w", err)
		}
		connMetrics.promConnectionMetrics = promMetrics
	}

	return connMetrics, nil
}

// Implement ConnectionMetricStore methods
func (c *ConnectionMetrics) MeasureDNSDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	opts := otelmetric.WithAttributes(append(c.baseAttributes, attrs...)...)
	c.otlpConnectionMetrics.MeasureDNSDuration(ctx, duration, opts)
	c.promConnectionMetrics.MeasureDNSDuration(ctx, duration, opts)
}

func (c *ConnectionMetrics) MeasureDialDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	opts := otelmetric.WithAttributes(append(c.baseAttributes, attrs...)...)
	c.otlpConnectionMetrics.MeasureDialDuration(ctx, duration, opts)
	c.promConnectionMetrics.MeasureDialDuration(ctx, duration, opts)
}

func (c *ConnectionMetrics) MeasureTLSHandshakeDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	opts := otelmetric.WithAttributes(append(c.baseAttributes, attrs...)...)
	c.otlpConnectionMetrics.MeasureTLSHandshakeDuration(ctx, duration, opts)
	c.promConnectionMetrics.MeasureTLSHandshakeDuration(ctx, duration, opts)
}

func (c *ConnectionMetrics) MeasureTotalConnectionDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	opts := otelmetric.WithAttributes(append(c.baseAttributes, attrs...)...)
	c.otlpConnectionMetrics.MeasureTotalConnectionDuration(ctx, duration, opts)
	c.promConnectionMetrics.MeasureTotalConnectionDuration(ctx, duration, opts)
}

func (c *ConnectionMetrics) MeasureConnectionNewTotal(ctx context.Context, count int64, attrs ...attribute.KeyValue) {
	opts := otelmetric.WithAttributes(append(c.baseAttributes, attrs...)...)
	c.otlpConnectionMetrics.MeasureConnectionNewTotal(ctx, count, opts)
	c.promConnectionMetrics.MeasureConnectionNewTotal(ctx, count, opts)
}

func (c *ConnectionMetrics) MeasureConnectionReuseTotal(ctx context.Context, count int64, attrs ...attribute.KeyValue) {
	opts := otelmetric.WithAttributes(append(c.baseAttributes, attrs...)...)
	c.otlpConnectionMetrics.MeasureConnectionReuseTotal(ctx, count, opts)
	c.promConnectionMetrics.MeasureConnectionReuseTotal(ctx, count, opts)
}

func (c *ConnectionMetrics) MeasureConnectionAcquireDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	opts := otelmetric.WithAttributes(append(c.baseAttributes, attrs...)...)
	c.otlpConnectionMetrics.MeasureConnectionAcquireDuration(ctx, duration, opts)
	c.promConnectionMetrics.MeasureConnectionAcquireDuration(ctx, duration, opts)
}

type otlpConnectionMetrics struct {
	instruments *connectionInstruments
	logger      *zap.Logger
}

func newOtlpConnectionMetrics(logger *zap.Logger, meterProvider *metric.MeterProvider) (*otlpConnectionMetrics, error) {
	instruments, err := newConnectionInstruments(meterProvider)
	if err != nil {
		return nil, fmt.Errorf("failed to create otlp connection instruments: %w", err)
	}

	return &otlpConnectionMetrics{
		instruments: instruments,
		logger:      logger,
	}, nil
}

func (m *otlpConnectionMetrics) MeasureDNSDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.connectionLatency.Record(ctx, duration, opts...)
}

func (m *otlpConnectionMetrics) MeasureDialDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.connectionLatency.Record(ctx, duration, opts...)
}

func (m *otlpConnectionMetrics) MeasureTLSHandshakeDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.connectionLatency.Record(ctx, duration, opts...)
}

func (m *otlpConnectionMetrics) MeasureTotalConnectionDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.connectionLatency.Record(ctx, duration, opts...)
}

func (m *otlpConnectionMetrics) MeasureConnectionAcquireDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.poolWaitTime.Record(ctx, duration, opts...)
}

func (m *otlpConnectionMetrics) MeasurePoolWaitCountTotal(ctx context.Context, count int64, opts ...otelmetric.AddOption) {
	m.instruments.poolWaitCount.Add(ctx, count, opts...)
}

func (m *otlpConnectionMetrics) MeasureConnectionNewTotal(ctx context.Context, count int64, opts ...otelmetric.AddOption) {
	m.instruments.connectionCounter.Add(ctx, count, opts...)
}

func (m *otlpConnectionMetrics) MeasureConnectionReuseTotal(ctx context.Context, count int64, opts ...otelmetric.AddOption) {
	m.instruments.connectionCounter.Add(ctx, count, opts...)
}

func (m *otlpConnectionMetrics) MeasurePoolActiveConnections(ctx context.Context, delta int64, opts ...otelmetric.AddOption) {
	m.instruments.poolSize.Add(ctx, delta, opts...)
}

func (m *otlpConnectionMetrics) MeasurePoolIdleConnections(ctx context.Context, delta int64, opts ...otelmetric.AddOption) {
	m.instruments.poolIdleSize.Add(ctx, delta, opts...)
}

func (m *otlpConnectionMetrics) Flush(ctx context.Context) error {
	return nil
}

type promConnectionMetrics struct {
	instruments *connectionInstruments
	logger      *zap.Logger
}

func newPromConnectionMetrics(logger *zap.Logger, meterProvider *metric.MeterProvider) (*promConnectionMetrics, error) {
	instruments, err := newConnectionInstruments(meterProvider)
	if err != nil {
		return nil, fmt.Errorf("failed to create prometheus connection instruments: %w", err)
	}

	return &promConnectionMetrics{
		instruments: instruments,
		logger:      logger,
	}, nil
}

func (m *promConnectionMetrics) MeasureDNSDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.connectionLatency.Record(ctx, duration, opts...)
}

func (m *promConnectionMetrics) MeasureDialDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.connectionLatency.Record(ctx, duration, opts...)
}

func (m *promConnectionMetrics) MeasureTLSHandshakeDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.connectionLatency.Record(ctx, duration, opts...)
}

func (m *promConnectionMetrics) MeasureTotalConnectionDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.connectionLatency.Record(ctx, duration, opts...)
}

func (m *promConnectionMetrics) MeasureConnectionAcquireDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.poolWaitTime.Record(ctx, duration, opts...)
}

func (m *promConnectionMetrics) MeasurePoolWaitCountTotal(ctx context.Context, count int64, opts ...otelmetric.AddOption) {
	m.instruments.poolWaitCount.Add(ctx, count, opts...)
}

func (m *promConnectionMetrics) MeasureConnectionNewTotal(ctx context.Context, count int64, opts ...otelmetric.AddOption) {
	m.instruments.connectionCounter.Add(ctx, count, opts...)
}

func (m *promConnectionMetrics) MeasureConnectionReuseTotal(ctx context.Context, count int64, opts ...otelmetric.AddOption) {
	m.instruments.connectionCounter.Add(ctx, count, opts...)
}

func (m *promConnectionMetrics) MeasurePoolActiveConnections(ctx context.Context, delta int64, opts ...otelmetric.AddOption) {
	m.instruments.poolSize.Add(ctx, delta, opts...)
}

func (m *promConnectionMetrics) MeasurePoolIdleConnections(ctx context.Context, delta int64, opts ...otelmetric.AddOption) {
	m.instruments.poolIdleSize.Add(ctx, delta, opts...)
}

func (m *promConnectionMetrics) Flush(ctx context.Context) error {
	return nil
}

func newConnectionInstruments(meterProvider *metric.MeterProvider) (*connectionInstruments, error) {
	meter := meterProvider.Meter("router.connection")

	connectionCounter, err := meter.Int64Counter(
		ConnectionCounter,
		ConnectionCounterOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection counter: %w", err)
	}

	connectionLatency, err := meter.Float64Histogram(
		ConnectionLatency,
		ConnectionLatencyOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection latency histogram: %w", err)
	}

	connectionErrorCounter, err := meter.Int64Counter(
		ConnectionErrorCounter,
		ConnectionErrorCounterOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection error counter: %w", err)
	}

	poolSize, err := meter.Int64UpDownCounter(
		PoolSize,
		PoolSizeOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create pool size updown counter: %w", err)
	}

	poolMaxSize, err := meter.Int64UpDownCounter(
		PoolMaxSize,
		PoolMaxSizeOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create pool max size updown counter: %w", err)
	}

	poolMinSize, err := meter.Int64UpDownCounter(
		PoolMinSize,
		PoolMinSizeOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create pool min size updown counter: %w", err)
	}

	poolIdleSize, err := meter.Int64UpDownCounter(
		PoolIdleSize,
		PoolIdleSizeOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create pool idle size updown counter: %w", err)
	}

	poolWaitTime, err := meter.Float64Histogram(
		PoolWaitTime,
		PoolWaitTimeOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create pool wait time histogram: %w", err)
	}

	poolWaitCount, err := meter.Int64Counter(
		PoolWaitCount,
		PoolWaitCountOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create pool wait count counter: %w", err)
	}

	return &connectionInstruments{
		connectionCounter:      connectionCounter,
		connectionLatency:      connectionLatency,
		connectionErrorCounter: connectionErrorCounter,
		poolSize:               poolSize,
		poolMaxSize:            poolMaxSize,
		poolMinSize:            poolMinSize,
		poolIdleSize:           poolIdleSize,
		poolWaitTime:           poolWaitTime,
		poolWaitCount:          poolWaitCount,
	}, nil
}
