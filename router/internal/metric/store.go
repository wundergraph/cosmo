package metric

import (
	"context"
	"fmt"
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

type Option func(svr *Metrics)

type Metrics struct {
	applicationVersion string

	meterProvider  *metric.MeterProvider
	counters       map[string]otelmetric.Int64Counter
	valueRecorders map[string]otelmetric.Float64Histogram
	upDownCounters map[string]otelmetric.Int64UpDownCounter

	baseFields []attribute.KeyValue
}

func NewMetrics(meterProvider *metric.MeterProvider, opts ...Option) (*Metrics, error) {
	h := &Metrics{
		meterProvider: meterProvider,
	}

	for _, opt := range opts {
		opt(h)
	}

	if err := h.createMeasures(); err != nil {
		return nil, err
	}

	return h, nil
}

func (h *Metrics) createMeasures() error {
	if h.meterProvider == nil {
		return fmt.Errorf("meter provider is nil")
	}

	h.counters = make(map[string]otelmetric.Int64Counter)
	h.valueRecorders = make(map[string]otelmetric.Float64Histogram)
	h.upDownCounters = make(map[string]otelmetric.Int64UpDownCounter)

	routerMeter := h.meterProvider.Meter(cosmoRouterMeterName,
		otelmetric.WithInstrumentationVersion(cosmoRouterMeterVersion),
	)
	requestCounter, err := routerMeter.Int64Counter(
		RequestCounter,
		otelmetric.WithDescription("Total number of requests"),
	)
	if err != nil {
		return fmt.Errorf("failed to create request counter: %w", err)
	}
	h.counters[RequestCounter] = requestCounter

	serverLatencyMeasure, err := routerMeter.Float64Histogram(
		ServerLatencyHistogram,
		otelmetric.WithUnit("ms"),
		otelmetric.WithDescription("Server latency in milliseconds"),
	)
	if err != nil {
		return fmt.Errorf("failed to create server latency measure: %w", err)
	}
	h.valueRecorders[ServerLatencyHistogram] = serverLatencyMeasure

	requestContentLengthCounter, err := routerMeter.Int64Counter(
		RequestContentLengthCounter,
		otelmetric.WithDescription("Total number of request bytes"),
		otelmetric.WithUnit("bytes"),
	)
	if err != nil {
		return fmt.Errorf("failed to create request content length counter: %w", err)
	}
	h.counters[RequestContentLengthCounter] = requestContentLengthCounter

	responseContentLengthCounter, err := routerMeter.Int64Counter(
		ResponseContentLengthCounter,
		otelmetric.WithDescription("Total number of response bytes"),
	)
	if err != nil {
		return fmt.Errorf("failed to create response content length counter: %w", err)
	}

	h.counters[ResponseContentLengthCounter] = responseContentLengthCounter

	inFlightRequestsGauge, err := routerMeter.Int64UpDownCounter(
		InFlightRequestsUpDownCounter,
		otelmetric.WithDescription("Number of requests in flight"),
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

	return func() {
		h.upDownCounters[InFlightRequestsUpDownCounter].Add(ctx, -1, baseAttributes)
	}
}

func (h *Metrics) MeasureRequestCount(ctx context.Context, attr ...attribute.KeyValue) {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseFields...)
	baseKeys = append(baseKeys, attr...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	h.counters[RequestCounter].Add(ctx, 1, baseAttributes)
}

func (h *Metrics) MeasureRequestSize(ctx context.Context, contentLength int64, attr ...attribute.KeyValue) {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseFields...)
	baseKeys = append(baseKeys, attr...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	h.counters[RequestContentLengthCounter].Add(ctx, contentLength, baseAttributes)
}

func (h *Metrics) MeasureResponseSize(ctx context.Context, size int64, attr ...attribute.KeyValue) {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseFields...)
	baseKeys = append(baseKeys, attr...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	h.counters[ResponseContentLengthCounter].Add(ctx, size, baseAttributes)
}

func (h *Metrics) MeasureLatency(ctx context.Context, requestStartTime time.Time, attr ...attribute.KeyValue) {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseFields...)
	baseKeys = append(baseKeys, attr...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	// Use floating point division here for higher precision (instead of Millisecond method).
	elapsedTime := float64(time.Since(requestStartTime)) / float64(time.Millisecond)
	h.valueRecorders[ServerLatencyHistogram].Record(ctx, elapsedTime, baseAttributes)
}

func WithApplicationVersion(version string) Option {
	return func(h *Metrics) {
		h.applicationVersion = version
	}
}

// WithAttributes adds attributes to the base attributes
func WithAttributes(attrs ...attribute.KeyValue) Option {
	return func(h *Metrics) {
		h.baseFields = append(h.baseFields, attrs...)
	}
}
