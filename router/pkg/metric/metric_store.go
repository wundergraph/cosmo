package metric

import (
	"context"
	"errors"
	"fmt"
	"go.opentelemetry.io/otel/attribute"
	"go.uber.org/zap"
	"os"
	"strconv"
	"time"

	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
)

// DefaultCardinalityLimit is the hard limit on the number of metric streams that can be collected for a single instrument.
const DefaultCardinalityLimit = 2000

// Server HTTP metrics.
const (
	RequestCounter                = "router.http.requests"                      // Incoming request count total
	ServerLatencyHistogram        = "router.http.request.duration_milliseconds" // Incoming end to end duration, milliseconds
	RequestContentLengthCounter   = "router.http.request.content_length"        // Incoming request bytes total
	ResponseContentLengthCounter  = "router.http.response.content_length"       // Outgoing response bytes total
	InFlightRequestsUpDownCounter = "router.http.requests.in_flight"            // Number of requests in flight
	RequestError                  = "router.http.requests.error"                // Total request error count

	OperationPlanningTime = "router.graphql.operation.planning_time" // Time taken to plan the operation

	unitBytes        = "bytes"
	unitMilliseconds = "ms"
)

var (
	// Shared attributes and options for OTEL and Prometheus metrics.

	RequestCounterDescription = "Total number of requests"
	RequestCounterOptions     = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription(RequestCounterDescription),
	}
	RequestErrorCounterDescription = "Total number of failed requests"
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

	// GraphQL operation metrics

	OperationPlanningTimeHistogramDescription = "Operation planning time in milliseconds"
	OperationPlanningTimeHistogramOptions     = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("ms"),
		otelmetric.WithDescription(OperationPlanningTimeHistogramDescription),
	}
)

type (
	Option func(svr *Metrics)

	Metrics struct {
		otelMeterProvider *metric.MeterProvider
		promMeterProvider *metric.MeterProvider

		processStartTime   time.Time
		otlpRequestMetrics Provider
		promRequestMetrics Provider
		baseAttributes     []attribute.KeyValue
		baseAttributesOpt  otelmetric.MeasurementOption

		// The cardinality limit is the hard limit on the number of metric streams that can be collected for a single instrument
		//
		// The otel go sdk currently does not yet allow us to define our own limiter.
		// Without proper limitation it can be easy to accidentally create a large number of metric streams.
		// See reference: https://github.com/open-telemetry/opentelemetry-go/blob/main/sdk/metric/internal/x/README.md
		cardinalityLimit int

		logger *zap.Logger
	}

	// Provider is the interface that wraps the basic metric methods.
	// We maintain two providers, one for OTEL and one for Prometheus.
	Provider interface {
		MeasureInFlight(ctx context.Context, opts ...otelmetric.AddOption) func()
		MeasureRequestCount(ctx context.Context, opts ...otelmetric.AddOption)
		MeasureRequestSize(ctx context.Context, contentLength int64, opts ...otelmetric.AddOption)
		MeasureResponseSize(ctx context.Context, size int64, opts ...otelmetric.AddOption)
		MeasureLatency(ctx context.Context, latency float64, opts ...otelmetric.RecordOption)
		MeasureRequestError(ctx context.Context, opts ...otelmetric.AddOption)
		MeasureOperationPlanningTime(ctx context.Context, planningTime float64, opts ...otelmetric.RecordOption)
		Flush(ctx context.Context) error
	}

	// Store is the unified metric interface for OTEL and Prometheus metrics. The interface can vary depending on
	// if additional information is required for the provider e.g. slice attributes.
	Store interface {
		MeasureInFlight(ctx context.Context, sliceAttr []attribute.KeyValue, opt otelmetric.AddOption) func()
		MeasureRequestCount(ctx context.Context, sliceAttr []attribute.KeyValue, opt otelmetric.AddOption)
		MeasureRequestSize(ctx context.Context, contentLength int64, sliceAttr []attribute.KeyValue, opt otelmetric.AddOption)
		MeasureResponseSize(ctx context.Context, size int64, sliceAttr []attribute.KeyValue, opt otelmetric.AddOption)
		MeasureLatency(ctx context.Context, latency time.Duration, sliceAttr []attribute.KeyValue, opt otelmetric.RecordOption)
		MeasureRequestError(ctx context.Context, sliceAttr []attribute.KeyValue, opt otelmetric.AddOption)
		MeasureOperationPlanningTime(ctx context.Context, planningTime time.Duration, sliceAttr []attribute.KeyValue, opt otelmetric.RecordOption)
		Flush(ctx context.Context) error
		Shutdown(ctx context.Context) error
	}
)

// NewStore creates a new metrics store instance.
// The store abstract OTEL and Prometheus metrics with a single interface.
func NewStore(opts ...Option) (Store, error) {
	h := &Metrics{
		logger: zap.NewNop(),
	}

	for _, opt := range opts {
		opt(h)
	}

	if err := setCardinalityLimit(h.cardinalityLimit); err != nil {
		h.logger.Warn("Failed to set cardinality limit", zap.Error(err))
	}

	h.baseAttributesOpt = otelmetric.WithAttributes(h.baseAttributes...)

	// Create OTLP metrics exported to OTEL
	oltpMetrics, err := NewOtlpMetricStore(h.logger, h.otelMeterProvider)
	if err != nil {
		return nil, err
	}

	h.otlpRequestMetrics = oltpMetrics

	// Create prometheus metrics exported to Prometheus scrape endpoint
	promMetrics, err := NewPromMetricStore(h.logger, h.promMeterProvider)
	if err != nil {
		return nil, err
	}

	h.promRequestMetrics = promMetrics

	return h, nil
}

// setCardinalityLimit sets the cardinality limit for open telemetry.
// This feature is experimental in otel-go and may be exposed in a different way in the future.
// In order to avoid creating a large number of metric streams, we set a hard limit that can be collected for a single instrument.
func setCardinalityLimit(limit int) error {
	if limit <= 0 {
		// We set the default limit if the limit is not set or invalid.
		// A limit of 0 would disable the cardinality limit.
		limit = DefaultCardinalityLimit
	}

	return os.Setenv("OTEL_GO_X_CARDINALITY_LIMIT", strconv.Itoa(limit))
}

func (h *Metrics) MeasureInFlight(ctx context.Context, sliceAttr []attribute.KeyValue, opt otelmetric.AddOption) func() {
	handlers := make([]func(), 0, 2)

	opts := []otelmetric.AddOption{h.baseAttributesOpt, opt}

	// Explode for prometheus metrics

	if len(sliceAttr) == 0 {
		handlers = append(handlers, h.promRequestMetrics.MeasureInFlight(ctx, opts...))
	} else {
		explodeAddInstrument(ctx, sliceAttr, func(ctx context.Context, newOpts ...otelmetric.AddOption) {
			newOpts = append(newOpts, opts...)
			handlers = append(handlers, h.promRequestMetrics.MeasureInFlight(ctx, newOpts...))
		})
	}

	// OTEL metrics

	opts = append(opts, otelmetric.WithAttributes(sliceAttr...))

	handlers = append(handlers, h.otlpRequestMetrics.MeasureInFlight(ctx, opts...))

	return func() {
		for _, h := range handlers {
			h()
		}
	}
}

func (h *Metrics) MeasureRequestCount(ctx context.Context, sliceAttr []attribute.KeyValue, opt otelmetric.AddOption) {
	opts := []otelmetric.AddOption{h.baseAttributesOpt, opt}

	// Explode for prometheus metrics

	if len(sliceAttr) == 0 {
		h.promRequestMetrics.MeasureRequestCount(ctx, opts...)
	} else {
		explodeAddInstrument(ctx, sliceAttr, func(ctx context.Context, newOpts ...otelmetric.AddOption) {
			newOpts = append(newOpts, opts...)
			h.promRequestMetrics.MeasureRequestCount(ctx, newOpts...)
		})
	}

	// OTEL metrics

	opts = append(opts, otelmetric.WithAttributes(sliceAttr...))

	h.otlpRequestMetrics.MeasureRequestCount(ctx, opts...)
}

func (h *Metrics) MeasureRequestSize(ctx context.Context, contentLength int64, sliceAttr []attribute.KeyValue, opt otelmetric.AddOption) {
	opts := []otelmetric.AddOption{h.baseAttributesOpt, opt}

	// Explode for prometheus metrics

	if len(sliceAttr) == 0 {
		h.promRequestMetrics.MeasureRequestSize(ctx, contentLength, opts...)
	} else {
		explodeAddInstrument(ctx, sliceAttr, func(ctx context.Context, newOpts ...otelmetric.AddOption) {
			newOpts = append(newOpts, opts...)
			h.promRequestMetrics.MeasureRequestSize(ctx, contentLength, newOpts...)
		})
	}

	// OTEL metrics

	opts = append(opts, otelmetric.WithAttributes(sliceAttr...))

	h.otlpRequestMetrics.MeasureRequestSize(ctx, contentLength, opts...)
}

func (h *Metrics) MeasureResponseSize(ctx context.Context, size int64, sliceAttr []attribute.KeyValue, opt otelmetric.AddOption) {
	opts := []otelmetric.AddOption{h.baseAttributesOpt, opt}

	// Explode for prometheus metrics

	if len(sliceAttr) == 0 {
		h.promRequestMetrics.MeasureResponseSize(ctx, size, opts...)
	} else {
		explodeAddInstrument(ctx, sliceAttr, func(ctx context.Context, newOpts ...otelmetric.AddOption) {
			newOpts = append(newOpts, opts...)
			h.promRequestMetrics.MeasureResponseSize(ctx, size, newOpts...)
		})
	}

	// OTEL metrics

	opts = append(opts, otelmetric.WithAttributes(sliceAttr...))

	h.otlpRequestMetrics.MeasureResponseSize(ctx, size, opts...)
}

func (h *Metrics) MeasureLatency(ctx context.Context, latency time.Duration, sliceAttr []attribute.KeyValue, opt otelmetric.RecordOption) {
	opts := []otelmetric.RecordOption{h.baseAttributesOpt, opt}

	// Use floating point division here for higher precision (instead of Millisecond method).
	latencyTime := float64(latency) / float64(time.Millisecond)

	// Explode for prometheus metrics

	if len(sliceAttr) == 0 {
		h.promRequestMetrics.MeasureLatency(ctx, latencyTime, opts...)
	} else {
		explodeRecordInstrument(ctx, sliceAttr, func(ctx context.Context, newOpts ...otelmetric.RecordOption) {
			newOpts = append(newOpts, opts...)
			h.promRequestMetrics.MeasureLatency(ctx, latencyTime, newOpts...)
		})
	}

	// OTEL metrics

	opts = append(opts, otelmetric.WithAttributes(sliceAttr...))

	h.otlpRequestMetrics.MeasureLatency(ctx, latencyTime, opts...)
}

func (h *Metrics) MeasureRequestError(ctx context.Context, sliceAttr []attribute.KeyValue, opt otelmetric.AddOption) {
	opts := []otelmetric.AddOption{h.baseAttributesOpt, opt}

	// Explode for prometheus metrics

	if len(sliceAttr) == 0 {
		h.promRequestMetrics.MeasureRequestError(ctx, opts...)
	} else {
		explodeAddInstrument(ctx, sliceAttr, func(ctx context.Context, newOpts ...otelmetric.AddOption) {
			newOpts = append(newOpts, opts...)
			h.promRequestMetrics.MeasureRequestError(ctx, newOpts...)
		})
	}

	// OTEL metrics

	opts = append(opts, otelmetric.WithAttributes(sliceAttr...))

	h.otlpRequestMetrics.MeasureRequestError(ctx, opts...)
}

func (h *Metrics) MeasureOperationPlanningTime(ctx context.Context, planningTime time.Duration, sliceAttr []attribute.KeyValue, opt otelmetric.RecordOption) {
	opts := []otelmetric.RecordOption{h.baseAttributesOpt, opt}

	// Use floating point division here for higher precision (instead of Millisecond method).
	elapsedTime := float64(planningTime) / float64(time.Millisecond)

	// Explode for prometheus metrics

	if len(sliceAttr) == 0 {
		h.promRequestMetrics.MeasureOperationPlanningTime(ctx, elapsedTime, opts...)
	} else {
		explodeRecordInstrument(ctx, sliceAttr, func(ctx context.Context, newOpts ...otelmetric.RecordOption) {
			newOpts = append(newOpts, opts...)
			h.promRequestMetrics.MeasureOperationPlanningTime(ctx, elapsedTime, newOpts...)
		})
	}

	// OTEL metrics

	opts = append(opts, otelmetric.WithAttributes(sliceAttr...))

	h.otlpRequestMetrics.MeasureOperationPlanningTime(ctx, elapsedTime, opts...)
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

	return err
}

// Shutdown flushes the metrics and stops the runtime metrics.
func (h *Metrics) Shutdown(ctx context.Context) error {

	var err error

	if err := h.Flush(ctx); err != nil {
		errors.Join(err, fmt.Errorf("failed to flush metrics: %w", err))
	}

	return err
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

func WithBaseAttributes(baseAttributes []attribute.KeyValue) Option {
	return func(h *Metrics) {
		h.baseAttributes = baseAttributes
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

func WithCardinalityLimit(cardinalityLimit int) Option {
	return func(h *Metrics) {
		h.cardinalityLimit = cardinalityLimit
	}
}
