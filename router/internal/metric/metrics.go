package metric

import (
	"context"
	"fmt"
	"go.uber.org/zap"
	"time"

	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
)

// Server HTTP metrics.
const (
	RequestCounter                = "router.http.requests"                      // Incoming request count total
	ServerLatencyHistogram        = "router.http.request.duration_milliseconds" // Incoming end to end duration, milliseconds
	RequestContentLengthCounter   = "router.http.request.content_length"        // Incoming request bytes total
	ResponseContentLengthCounter  = "router.http.response.content_length"       // Outgoing response bytes total
	InFlightRequestsUpDownCounter = "router.http.requests.in_flight.count"      // Number of requests in flight

	cosmoRouterMeterName    = "cosmo.router"
	cosmoRouterMeterVersion = "0.0.1"

	cosmoRouterPrometheusMeterName    = "cosmo.router.prometheus"
	cosmoRouterPrometheusMeterVersion = "0.0.1"

	unitBytes        = "bytes"
	unitMilliseconds = "ms"
)

var (
	RequestCounterDescription = "Total number of requests"
	RequestCounterOptions     = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription(RequestCounterDescription),
	}
	ServerLatencyHistogramDescription = "Server latency in milliseconds"
	ServerLatencyHistogramOptions     = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("ms"),
		otelmetric.WithDescription(ServerLatencyHistogramDescription),
	}
	RequestContentLengthCounterDescription = "Total number of request bytes"
	RequestContentLengthCounterOptions     = []otelmetric.Int64CounterOption{
		otelmetric.WithUnit("bytes"),
		otelmetric.WithDescription(RequestContentLengthCounterDescription),
	}
	ResponseContentLengthCounterDescription = "Total number of response bytes"
	ResponseContentLengthCounterOptions     = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription(ResponseContentLengthCounterDescription),
	}
	InFlightRequestsUpDownCounterDescription = "Number of requests in flight"
	InFlightRequestsUpDownCounterOptions     = []otelmetric.Int64UpDownCounterOption{
		otelmetric.WithDescription(InFlightRequestsUpDownCounterDescription),
	}
)

type (
	Option func(svr *Metrics)

	Metrics struct {
		serviceName    string
		serviceVersion string

		otelMeterProvider *metric.MeterProvider
		promMeterProvider *metric.MeterProvider

		otlpCounters       map[string]otelmetric.Int64Counter
		otlpHistograms     map[string]otelmetric.Float64Histogram
		otlpUpDownCounters map[string]otelmetric.Int64UpDownCounter

		promCounters       map[string]otelmetric.Int64Counter
		promHistograms     map[string]otelmetric.Float64Histogram
		promUpDownCounters map[string]otelmetric.Int64UpDownCounter

		baseFields []attribute.KeyValue
		logger     *zap.Logger
	}

	Store interface {
		MeasureInFlight(ctx context.Context, attr ...attribute.KeyValue) func()
		MeasureRequestCount(ctx context.Context, attr ...attribute.KeyValue)
		MeasureRequestSize(ctx context.Context, contentLength int64, attr ...attribute.KeyValue)
		MeasureResponseSize(ctx context.Context, size int64, attr ...attribute.KeyValue)
		MeasureLatency(ctx context.Context, requestStartTime time.Time, attr ...attribute.KeyValue)
	}
)

// NewMetrics creates a new metrics instance.
// Metrics abstract OTEL and Prometheus metrics with a single interface.
// We create different meters for OTEL and Prometheus metrics.
func NewMetrics(serviceName, serviceVersion string, opts ...Option) (Store, error) {
	h := &Metrics{
		// OTEL metrics
		otlpCounters:       map[string]otelmetric.Int64Counter{},
		otlpHistograms:     map[string]otelmetric.Float64Histogram{},
		otlpUpDownCounters: map[string]otelmetric.Int64UpDownCounter{},
		// Prometheus metrics
		promCounters:       map[string]otelmetric.Int64Counter{},
		promHistograms:     map[string]otelmetric.Float64Histogram{},
		promUpDownCounters: map[string]otelmetric.Int64UpDownCounter{},
		// Base fields
		serviceName:    serviceName,
		serviceVersion: serviceVersion,
	}

	for _, opt := range opts {
		opt(h)
	}

	if err := h.createPrometheusMeasures(); err != nil {
		return nil, err
	}

	if err := h.createOtlpMeasures(); err != nil {
		return nil, err
	}

	return h, nil
}

func (h *Metrics) createPrometheusMeasures() error {
	if h.promMeterProvider == nil {
		return nil
	}

	// Used to export metrics to OpenTelemetry backend.
	meter := h.promMeterProvider.Meter(cosmoRouterPrometheusMeterName,
		otelmetric.WithInstrumentationVersion(cosmoRouterPrometheusMeterVersion),
	)

	requestCounter, err := meter.Int64Counter(
		RequestCounter,
		RequestCounterOptions...,
	)
	if err != nil {
		return fmt.Errorf("failed to create request counter: %w", err)
	}

	h.promCounters[RequestCounter] = requestCounter

	serverLatencyMeasure, err := meter.Float64Histogram(
		ServerLatencyHistogram,
		ServerLatencyHistogramOptions...,
	)
	if err != nil {
		return fmt.Errorf("failed to create server latency measure: %w", err)
	}

	h.promHistograms[ServerLatencyHistogram] = serverLatencyMeasure

	requestContentLengthCounter, err := meter.Int64Counter(
		RequestContentLengthCounter,
		RequestContentLengthCounterOptions...,
	)
	if err != nil {
		return fmt.Errorf("failed to create request content length counter: %w", err)
	}

	h.promCounters[RequestContentLengthCounter] = requestContentLengthCounter

	responseContentLengthCounter, err := meter.Int64Counter(
		ResponseContentLengthCounter,
		ResponseContentLengthCounterOptions...,
	)
	if err != nil {
		return fmt.Errorf("failed to create response content length counter: %w", err)
	}

	h.promCounters[ResponseContentLengthCounter] = responseContentLengthCounter

	inFlightRequestsGauge, err := meter.Int64UpDownCounter(
		InFlightRequestsUpDownCounter,
		InFlightRequestsUpDownCounterOptions...,
	)
	if err != nil {
		return fmt.Errorf("failed to create in flight requests gauge: %w", err)
	}

	h.promUpDownCounters[InFlightRequestsUpDownCounter] = inFlightRequestsGauge

	return nil
}

func (h *Metrics) createOtlpMeasures() error {
	if h.otelMeterProvider == nil {
		return nil
	}

	// Used to export metrics to OpenTelemetry backend.
	meter := h.otelMeterProvider.Meter(cosmoRouterMeterName,
		otelmetric.WithInstrumentationVersion(cosmoRouterMeterVersion),
	)

	requestCounter, err := meter.Int64Counter(
		RequestCounter,
		RequestCounterOptions...,
	)
	if err != nil {
		return fmt.Errorf("failed to create request counter: %w", err)
	}

	h.otlpCounters[RequestCounter] = requestCounter

	serverLatencyMeasure, err := meter.Float64Histogram(
		ServerLatencyHistogram,
		ServerLatencyHistogramOptions...,
	)
	if err != nil {
		return fmt.Errorf("failed to create server latency measure: %w", err)
	}

	h.otlpHistograms[ServerLatencyHistogram] = serverLatencyMeasure

	requestContentLengthCounter, err := meter.Int64Counter(
		RequestContentLengthCounter,
		RequestContentLengthCounterOptions...,
	)
	if err != nil {
		return fmt.Errorf("failed to create request content length counter: %w", err)
	}

	h.otlpCounters[RequestContentLengthCounter] = requestContentLengthCounter

	responseContentLengthCounter, err := meter.Int64Counter(
		ResponseContentLengthCounter,
		ResponseContentLengthCounterOptions...,
	)
	if err != nil {
		return fmt.Errorf("failed to create response content length counter: %w", err)
	}

	h.otlpCounters[ResponseContentLengthCounter] = responseContentLengthCounter

	inFlightRequestsGauge, err := meter.Int64UpDownCounter(
		InFlightRequestsUpDownCounter,
		InFlightRequestsUpDownCounterOptions...,
	)
	if err != nil {
		return fmt.Errorf("failed to create in flight requests gauge: %w", err)
	}

	h.otlpUpDownCounters[InFlightRequestsUpDownCounter] = inFlightRequestsGauge

	return nil
}

func (h *Metrics) MeasureInFlight(ctx context.Context, attr ...attribute.KeyValue) func() {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseFields...)
	baseKeys = append(baseKeys, attr...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	if c, ok := h.otlpUpDownCounters[InFlightRequestsUpDownCounter]; ok {
		c.Add(ctx, 1, baseAttributes)
	}
	if c, ok := h.promUpDownCounters[InFlightRequestsUpDownCounter]; ok {
		c.Add(ctx, 1, baseAttributes)
	}

	return func() {
		if c, ok := h.otlpUpDownCounters[InFlightRequestsUpDownCounter]; ok {
			c.Add(ctx, -1, baseAttributes)
		}
		if c, ok := h.promUpDownCounters[InFlightRequestsUpDownCounter]; ok {
			c.Add(ctx, -1, baseAttributes)
		}
	}
}

func (h *Metrics) MeasureRequestCount(ctx context.Context, attr ...attribute.KeyValue) {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseFields...)
	baseKeys = append(baseKeys, attr...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	if c, ok := h.otlpCounters[RequestCounter]; ok {
		c.Add(ctx, 1, baseAttributes)
	}
	if c, ok := h.promCounters[RequestCounter]; ok {
		c.Add(ctx, 1, baseAttributes)
	}
}

func (h *Metrics) MeasureRequestSize(ctx context.Context, contentLength int64, attr ...attribute.KeyValue) {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseFields...)
	baseKeys = append(baseKeys, attr...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	if c, ok := h.otlpCounters[RequestContentLengthCounter]; ok {
		c.Add(ctx, contentLength, baseAttributes)
	}
	if c, ok := h.promCounters[RequestContentLengthCounter]; ok {
		c.Add(ctx, contentLength, baseAttributes)
	}
}

func (h *Metrics) MeasureResponseSize(ctx context.Context, size int64, attr ...attribute.KeyValue) {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseFields...)
	baseKeys = append(baseKeys, attr...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	if c, ok := h.otlpCounters[ResponseContentLengthCounter]; ok {
		c.Add(ctx, size, baseAttributes)
	}
	if c, ok := h.promCounters[ResponseContentLengthCounter]; ok {
		c.Add(ctx, size, baseAttributes)
	}
}

func (h *Metrics) MeasureLatency(ctx context.Context, requestStartTime time.Time, attr ...attribute.KeyValue) {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseFields...)
	baseKeys = append(baseKeys, attr...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	// Use floating point division here for higher precision (instead of Millisecond method).
	elapsedTime := float64(time.Since(requestStartTime)) / float64(time.Millisecond)

	if c, ok := h.otlpHistograms[ServerLatencyHistogram]; ok {
		c.Record(ctx, elapsedTime, baseAttributes)
	}
	if c, ok := h.promHistograms[ServerLatencyHistogram]; ok {
		c.Record(ctx, elapsedTime, baseAttributes)
	}
}

// WithAttributes adds attributes to the base attributes
func WithAttributes(attrs ...attribute.KeyValue) Option {
	return func(h *Metrics) {
		h.baseFields = append(h.baseFields, attrs...)
	}
}

func WithLogger(logger *zap.Logger) Option {
	return func(h *Metrics) {
		h.logger = logger
	}
}

func WithOtlpMeterProvider(otelMeterProvider *metric.MeterProvider) Option {
	return func(h *Metrics) {
		h.otelMeterProvider = otelMeterProvider
	}
}

func WithPromMeterProvider(promMeterProvider *metric.MeterProvider) Option {
	return func(h *Metrics) {
		h.promMeterProvider = promMeterProvider
	}
}
