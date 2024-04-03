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
	cosmoRouterPrometheusMeterName    = "cosmo.router.prometheus"
	cosmoRouterPrometheusMeterVersion = "0.0.1"
)

type PromMetricStore struct {
	meter          otelmetric.Meter
	baseAttributes []attribute.KeyValue
	meterProvider  *metric.MeterProvider
	logger         *zap.Logger

	measurements *Measurements
}

func NewPromMetricStore(logger *zap.Logger, meterProvider *metric.MeterProvider, baseAttributes []attribute.KeyValue) (Store, error) {

	meter := meterProvider.Meter(cosmoRouterPrometheusMeterName,
		otelmetric.WithInstrumentationVersion(cosmoRouterPrometheusMeterVersion),
	)

	m := &PromMetricStore{
		meter:          meter,
		baseAttributes: baseAttributes,
		logger:         logger,
		meterProvider:  meterProvider,
	}

	measures, err := createMeasures(meter)
	if err != nil {
		return nil, err
	}

	m.measurements = measures

	return m, nil
}

func (h *PromMetricStore) MeasureInFlight(ctx context.Context, attr ...attribute.KeyValue) func() {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseAttributes...)
	baseKeys = append(baseKeys, attr...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	if c, ok := h.measurements.upDownCounters[InFlightRequestsUpDownCounter]; ok {
		c.Add(ctx, 1, baseAttributes)
	}

	return func() {
		if c, ok := h.measurements.upDownCounters[InFlightRequestsUpDownCounter]; ok {
			c.Add(ctx, -1, baseAttributes)
		}
	}
}

func (h *PromMetricStore) MeasureRequestCount(ctx context.Context, attr ...attribute.KeyValue) {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseAttributes...)
	baseKeys = append(baseKeys, attr...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	if c, ok := h.measurements.counters[RequestCounter]; ok {
		c.Add(ctx, 1, baseAttributes)
	}
}

func (h *PromMetricStore) MeasureRequestSize(ctx context.Context, contentLength int64, attr ...attribute.KeyValue) {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseAttributes...)
	baseKeys = append(baseKeys, attr...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	if c, ok := h.measurements.counters[RequestContentLengthCounter]; ok {
		c.Add(ctx, contentLength, baseAttributes)
	}
}

func (h *PromMetricStore) MeasureResponseSize(ctx context.Context, size int64, attr ...attribute.KeyValue) {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseAttributes...)
	baseKeys = append(baseKeys, attr...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	if c, ok := h.measurements.counters[ResponseContentLengthCounter]; ok {
		c.Add(ctx, size, baseAttributes)
	}
}

func (h *PromMetricStore) MeasureLatency(ctx context.Context, requestStartTime time.Time, attr ...attribute.KeyValue) {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseAttributes...)
	baseKeys = append(baseKeys, attr...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	// Use floating point division here for higher precision (instead of Millisecond method).
	elapsedTime := float64(time.Since(requestStartTime)) / float64(time.Millisecond)

	if c, ok := h.measurements.histograms[ServerLatencyHistogram]; ok {
		c.Record(ctx, elapsedTime, baseAttributes)
	}
}

func (h *PromMetricStore) MeasureRequestError(ctx context.Context, attr ...attribute.KeyValue) {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseAttributes...)
	baseKeys = append(baseKeys, attr...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	if c, ok := h.measurements.counters[RequestError]; ok {
		c.Add(ctx, 1, baseAttributes)
	}
}

func (h *PromMetricStore) Flush(ctx context.Context) error {
	return h.meterProvider.ForceFlush(ctx)
}
