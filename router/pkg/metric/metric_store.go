package metric

import (
	"context"
	"errors"
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
	InFlightRequestsUpDownCounter = "router.http.requests.in_flight"            // Number of requests in flight
	RequestError                  = "router.http.requests.error"                // Total request error count

	unitBytes        = "bytes"
	unitMilliseconds = "ms"
)

var (
	// Shared attributes and options for OTEL and Prometheus metrics.

	RequestCounterDescription = "Total number of requests"
	RequestCounterOptions     = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription(RequestCounterDescription),
	}
	RequestErrorCounterDescription = "Total number of failed request"
	RequestErrorCounterOptions     = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription(RequestErrorCounterDescription),
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
		otelmetric.WithUnit("bytes"),
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
		otelMeterProvider *metric.MeterProvider
		promMeterProvider *metric.MeterProvider

		runtimeMetrics   *RuntimeMetrics
		enableRuntime    bool
		processStartTime time.Time

		otlpRequestMetrics Store
		promRequestMetrics Store

		baseAttributes []attribute.KeyValue
		logger         *zap.Logger
	}

	Store interface {
		MeasureInFlight(ctx context.Context, attr ...attribute.KeyValue) func()
		MeasureRequestCount(ctx context.Context, attr ...attribute.KeyValue)
		MeasureRequestSize(ctx context.Context, contentLength int64, attr ...attribute.KeyValue)
		MeasureResponseSize(ctx context.Context, size int64, attr ...attribute.KeyValue)
		MeasureLatency(ctx context.Context, requestStartTime time.Time, attr ...attribute.KeyValue)
		MeasureRequestError(ctx context.Context, attr ...attribute.KeyValue)
		Flush(ctx context.Context) error
	}
)

// NewStore creates a new metrics store instance.
// The store abstract OTEL and Prometheus metrics with a single interface.
func NewStore(opts ...Option) (Store, error) {
	h := &Metrics{}

	for _, opt := range opts {
		opt(h)
	}

	if h.enableRuntime {
		// Create runtime metrics exported to OTEL
		h.runtimeMetrics = NewRuntimeMetrics(h.logger, h.otelMeterProvider, h.baseAttributes, h.processStartTime)

		// Start runtime metrics
		if err := h.runtimeMetrics.Start(); err != nil {
			return nil, err
		}
	}

	// Create OTLP metrics exported to OTEL
	oltpMetrics, err := NewOtlpMetricStore(h.logger, h.otelMeterProvider, h.baseAttributes)
	if err != nil {
		return nil, err
	}

	h.otlpRequestMetrics = oltpMetrics

	// Create prometheus metrics exported to Prometheus scrape endpoint
	promMetrics, err := NewPromMetricStore(h.logger, h.promMeterProvider, h.baseAttributes)
	if err != nil {
		return nil, err
	}

	h.promRequestMetrics = promMetrics

	return h, nil
}

func (h *Metrics) MeasureInFlight(ctx context.Context, attr ...attribute.KeyValue) func() {
	f1 := h.otlpRequestMetrics.MeasureInFlight(ctx, attr...)
	f2 := h.promRequestMetrics.MeasureInFlight(ctx, attr...)

	return func() {
		f1()
		f2()
	}
}

func (h *Metrics) MeasureRequestCount(ctx context.Context, attr ...attribute.KeyValue) {
	h.otlpRequestMetrics.MeasureRequestCount(ctx, attr...)
	h.promRequestMetrics.MeasureRequestCount(ctx, attr...)
}

func (h *Metrics) MeasureRequestSize(ctx context.Context, contentLength int64, attr ...attribute.KeyValue) {
	h.otlpRequestMetrics.MeasureRequestSize(ctx, contentLength, attr...)
	h.promRequestMetrics.MeasureRequestSize(ctx, contentLength, attr...)
}

func (h *Metrics) MeasureResponseSize(ctx context.Context, size int64, attr ...attribute.KeyValue) {
	h.otlpRequestMetrics.MeasureResponseSize(ctx, size, attr...)
	h.promRequestMetrics.MeasureResponseSize(ctx, size, attr...)
}

func (h *Metrics) MeasureLatency(ctx context.Context, requestStartTime time.Time, attr ...attribute.KeyValue) {
	h.otlpRequestMetrics.MeasureLatency(ctx, requestStartTime, attr...)
	h.promRequestMetrics.MeasureLatency(ctx, requestStartTime, attr...)
}

func (h *Metrics) MeasureRequestError(ctx context.Context, attr ...attribute.KeyValue) {
	h.otlpRequestMetrics.MeasureRequestError(ctx, attr...)
	h.promRequestMetrics.MeasureRequestError(ctx, attr...)
}

// Flush flushes the metrics to the backend synchronously.
func (h *Metrics) Flush(ctx context.Context) error {

	var err error

	if err := h.otlpRequestMetrics.Flush(ctx); err != nil {
		errors.Join(err, fmt.Errorf("failed to flush otlp metrics: %w", err))
	}
	if err := h.promRequestMetrics.Flush(ctx); err != nil {
		errors.Join(err, fmt.Errorf("failed to flush prometheus metrics: %w", err))
	}
	if h.runtimeMetrics != nil {
		if err := h.runtimeMetrics.Stop(); err != nil {
			errors.Join(err, fmt.Errorf("failed to stop runtime metrics: %w", err))
		}
	}

	return err
}

// WithAttributes adds attributes to the base attributes
func WithAttributes(attrs ...attribute.KeyValue) Option {
	return func(h *Metrics) {
		h.baseAttributes = append(h.baseAttributes, attrs...)
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

func WithProcessStartTime(processStartTime time.Time) Option {
	return func(h *Metrics) {
		h.processStartTime = processStartTime
	}
}

func WithRouterRuntimeMetrics(enableRuntime bool) Option {
	return func(h *Metrics) {
		h.enableRuntime = enableRuntime
	}
}
