package metric

import (
	"context"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
	"time"
)

const (
	cosmoRouterMeterName    = "cosmo.router"
	cosmoRouterMeterVersion = "0.0.1"
)

type OtlpMetricStore struct {
	meter         otelmetric.Meter
	meterProvider *metric.MeterProvider
	logger        *zap.Logger

	measurements *Measurements
}

func NewOtlpMetricStore(logger *zap.Logger, meterProvider *metric.MeterProvider) (Provider, error) {

	meter := meterProvider.Meter(cosmoRouterMeterName,
		otelmetric.WithInstrumentationVersion(cosmoRouterMeterVersion),
	)

	m := &OtlpMetricStore{
		meter:         meter,
		logger:        logger,
		meterProvider: meterProvider,
	}

	measures, err := createMeasures(meter)
	if err != nil {
		return nil, err
	}

	m.measurements = measures

	return m, nil
}

func (h *OtlpMetricStore) MeasureInFlight(ctx context.Context, attr ...attribute.KeyValue) func() {
	attributes := make([]attribute.KeyValue, 0, len(attr))
	attributes = append(attributes, attr...)
	attributeAddOpt := otelmetric.WithAttributes(attributes...)

	if c, ok := h.measurements.upDownCounters[InFlightRequestsUpDownCounter]; ok {
		c.Add(ctx, 1, attributeAddOpt)
	}

	return func() {
		if c, ok := h.measurements.upDownCounters[InFlightRequestsUpDownCounter]; ok {
			c.Add(ctx, -1, attributeAddOpt)
		}
	}
}

func (h *OtlpMetricStore) MeasureRequestCount(ctx context.Context, attr ...attribute.KeyValue) {
	if c, ok := h.measurements.counters[RequestCounter]; ok {
		attributes := make([]attribute.KeyValue, 0, len(attr))
		attributes = append(attributes, attr...)
		c.Add(ctx, 1, otelmetric.WithAttributes(attributes...))
	}
}

func (h *OtlpMetricStore) MeasureRequestSize(ctx context.Context, contentLength int64, attr ...attribute.KeyValue) {
	if c, ok := h.measurements.counters[RequestContentLengthCounter]; ok {
		attributes := make([]attribute.KeyValue, 0, len(attr))
		attributes = append(attributes, attr...)
		c.Add(ctx, contentLength, otelmetric.WithAttributes(attributes...))
	}
}

func (h *OtlpMetricStore) MeasureResponseSize(ctx context.Context, size int64, attr ...attribute.KeyValue) {
	if c, ok := h.measurements.counters[ResponseContentLengthCounter]; ok {
		attributes := make([]attribute.KeyValue, 0, len(attr))
		attributes = append(attributes, attr...)
		c.Add(ctx, size, otelmetric.WithAttributes(attributes...))
	}
}

func (h *OtlpMetricStore) MeasureLatency(ctx context.Context, latency time.Duration, attr ...attribute.KeyValue) {
	if c, ok := h.measurements.histograms[ServerLatencyHistogram]; ok {
		attributes := make([]attribute.KeyValue, 0, len(attr))
		attributes = append(attributes, attr...)

		// Use floating point division here for higher precision (instead of Millisecond method).
		elapsedTime := float64(latency) / float64(time.Millisecond)

		c.Record(ctx, elapsedTime, otelmetric.WithAttributes(attributes...))
	}
}

func (h *OtlpMetricStore) MeasureRequestError(ctx context.Context, attr ...attribute.KeyValue) {
	if c, ok := h.measurements.counters[RequestError]; ok {
		attributes := make([]attribute.KeyValue, 0, len(attr))
		attributes = append(attributes, attr...)

		c.Add(ctx, 1, otelmetric.WithAttributes(attributes...))
	}
}

func (h *OtlpMetricStore) MeasureOperationPlanningTime(ctx context.Context, planningTime time.Duration, attr ...attribute.KeyValue) {
	if c, ok := h.measurements.histograms[OperationPlanningTime]; ok {
		attributes := make([]attribute.KeyValue, 0, len(attr))
		attributes = append(attributes, attr...)

		// Use floating point division here for higher precision (instead of Millisecond method).
		elapsedTime := float64(planningTime) / float64(time.Millisecond)

		c.Record(ctx, elapsedTime, otelmetric.WithAttributes(attributes...))
	}
}

func (h *OtlpMetricStore) Flush(ctx context.Context) error {
	return h.meterProvider.ForceFlush(ctx)
}
