package metric

import (
	"context"
	"fmt"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
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

	unitBytes        = "bytes"
	unitMilliseconds = "ms"
)

// IMPORTANT: Never add attributes conditionally, as this is incompatible with the prometheus exporter.
// Prometheus client expects a fixed set of labels, and will panic if a label is missing.

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

type Option func(svr *Metrics)

type Metrics struct {
	serviceName    string
	serviceVersion string

	otelMeterProvider *metric.MeterProvider

	counters       map[string]otelmetric.Int64Counter
	histograms     map[string]otelmetric.Float64Histogram
	upDownCounters map[string]otelmetric.Int64UpDownCounter

	promClient PromClient

	baseFields []attribute.KeyValue
	logger     *zap.Logger
}

// NewMetrics creates a new metrics instance.
// Metrics abstract OTEL and Prometheus metrics with a single interface.
// Previously, we used the OTEL Prometheus Exporter to export prometheus metrics with one solution, but the exporter
// is implemented through a OTEL reader which does not pipe the data through OTEL views for manipulation e.g. filtering.
// This makes it impossible to filter metrics and labels before they are created as individual metrics.
// For now, we track both OTEL and Prometheus metrics and use the default Prometheus client to export them.
func NewMetrics(serviceName, serviceVersion string, opts ...Option) (*Metrics, error) {
	h := &Metrics{
		counters:       map[string]otelmetric.Int64Counter{},
		histograms:     map[string]otelmetric.Float64Histogram{},
		upDownCounters: map[string]otelmetric.Int64UpDownCounter{},
		serviceName:    serviceName,
		serviceVersion: serviceVersion,
	}

	for _, opt := range opts {
		opt(h)
	}

	// Create target_info metric.
	h.promClient.AddInfoMetric(
		semconv.ServiceNameKey.String(serviceName),
		semconv.ServiceVersionKey.String(serviceVersion),
	)

	if err := h.createDefaultOtlpMeasures(); err != nil {
		return nil, err
	}

	return h, nil
}

func (h *Metrics) createDefaultOtlpMeasures() error {
	if h.otelMeterProvider == nil {
		return nil
	}

	// Used to export metrics to OpenTelemetry backend.
	otelMeter := h.otelMeterProvider.Meter(cosmoRouterMeterName,
		otelmetric.WithInstrumentationVersion(cosmoRouterMeterVersion),
	)

	requestCounter, err := otelMeter.Int64Counter(
		RequestCounter,
		RequestCounterOptions...,
	)
	if err != nil {
		return fmt.Errorf("failed to create request counter: %w", err)
	}

	h.counters[RequestCounter] = requestCounter

	serverLatencyMeasure, err := otelMeter.Float64Histogram(
		ServerLatencyHistogram,
		ServerLatencyHistogramOptions...,
	)
	if err != nil {
		return fmt.Errorf("failed to create server latency measure: %w", err)
	}

	h.histograms[ServerLatencyHistogram] = serverLatencyMeasure

	requestContentLengthCounter, err := otelMeter.Int64Counter(
		RequestContentLengthCounter,
		RequestContentLengthCounterOptions...,
	)
	if err != nil {
		return fmt.Errorf("failed to create request content length counter: %w", err)
	}

	h.counters[RequestContentLengthCounter] = requestContentLengthCounter

	responseContentLengthCounter, err := otelMeter.Int64Counter(
		ResponseContentLengthCounter,
		ResponseContentLengthCounterOptions...,
	)
	if err != nil {
		return fmt.Errorf("failed to create response content length counter: %w", err)
	}

	h.counters[ResponseContentLengthCounter] = responseContentLengthCounter

	inFlightRequestsGauge, err := otelMeter.Int64UpDownCounter(
		InFlightRequestsUpDownCounter,
		InFlightRequestsUpDownCounterOptions...,
	)
	if err != nil {
		return fmt.Errorf("failed to create in flight requests gauge: %w", err)
	}

	h.upDownCounters[InFlightRequestsUpDownCounter] = inFlightRequestsGauge

	return nil
}

func (h *Metrics) MeasureInFlight(ctx context.Context) func() {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseFields...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	h.upDownCounters[InFlightRequestsUpDownCounter].Add(ctx, 1, baseAttributes)
	h.promClient.AddGauge(InFlightRequestsUpDownCounter, InFlightRequestsUpDownCounterDescription, 1, baseKeys...)

	return func() {
		h.upDownCounters[InFlightRequestsUpDownCounter].Add(ctx, -1, baseAttributes)
		h.promClient.AddGauge(InFlightRequestsUpDownCounter, InFlightRequestsUpDownCounterDescription, -1, baseKeys...)
	}
}

func (h *Metrics) MeasureRequestCount(ctx context.Context, attr ...attribute.KeyValue) {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseFields...)
	baseKeys = append(baseKeys, attr...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	h.counters[RequestCounter].Add(ctx, 1, baseAttributes)
	h.promClient.AddCounter(RequestCounter, RequestCounterDescription, 1, baseKeys...)
}

func (h *Metrics) MeasureRequestSize(ctx context.Context, contentLength int64, attr ...attribute.KeyValue) {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseFields...)
	baseKeys = append(baseKeys, attr...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	h.counters[RequestContentLengthCounter].Add(ctx, contentLength, baseAttributes)
	h.promClient.AddCounter(RequestContentLengthCounter, RequestContentLengthCounterDescription, 1, baseKeys...)
}

func (h *Metrics) MeasureResponseSize(ctx context.Context, size int64, attr ...attribute.KeyValue) {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseFields...)
	baseKeys = append(baseKeys, attr...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	h.counters[ResponseContentLengthCounter].Add(ctx, size, baseAttributes)
	h.promClient.AddCounter(ResponseContentLengthCounter, ResponseContentLengthCounterDescription, float64(size), baseKeys...)
}

func (h *Metrics) MeasureLatency(ctx context.Context, requestStartTime time.Time, attr ...attribute.KeyValue) {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseFields...)
	baseKeys = append(baseKeys, attr...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	// Use floating point division here for higher precision (instead of Millisecond method).
	elapsedTime := float64(time.Since(requestStartTime)) / float64(time.Millisecond)

	h.histograms[ServerLatencyHistogram].Record(ctx, elapsedTime, baseAttributes)
	h.promClient.AddHistogram(
		ServerLatencyHistogram,
		ServerLatencyHistogramDescription,
		elapsedTime,
		msBucketsBounds,
		baseKeys...,
	)
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

func WithMeterProvider(otelMeterProvider *metric.MeterProvider) Option {
	return func(h *Metrics) {
		h.otelMeterProvider = otelMeterProvider
	}
}

func WithPrometheusClient(client PromClient) Option {
	return func(h *Metrics) {
		h.promClient = client
	}
}
