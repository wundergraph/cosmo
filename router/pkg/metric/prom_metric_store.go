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
	meter         otelmetric.Meter
	meterProvider *metric.MeterProvider
	logger        *zap.Logger

	measurements *Measurements
}

func NewPromMetricStore(logger *zap.Logger, meterProvider *metric.MeterProvider) (Provider, error) {

	meter := meterProvider.Meter(cosmoRouterPrometheusMeterName,
		otelmetric.WithInstrumentationVersion(cosmoRouterPrometheusMeterVersion),
	)

	m := &PromMetricStore{
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

func (h *PromMetricStore) MeasureInFlight(ctx context.Context, attr ...attribute.KeyValue) func() {
	dimensionsSet, otherAttributes := filterStringSliceAttr(attr)
	otherAttributes = append(otherAttributes, otherAttributes...)
	attributeAddOpt := otelmetric.WithAttributes(otherAttributes...)

	if c, ok := h.measurements.upDownCounters[InFlightRequestsUpDownCounter]; ok {
		if len(dimensionsSet) == 0 {
			c.Add(ctx, 1, attributeAddOpt)
		} else {
			// String Slice attributes have to be exploded into multiple metrics with different label values in Prometheus.
			// This is because Prometheus does not support multi-value labels.
			for _, attr := range dimensionsSet {
				for _, v := range attr.Value.AsStringSlice() {
					c.Add(ctx, 1, otelmetric.WithAttributes(append(otherAttributes, attribute.KeyValue{
						Key:   attr.Key,
						Value: attribute.StringValue(v),
					})...))
				}
			}
		}
	}

	return func() {
		if c, ok := h.measurements.upDownCounters[InFlightRequestsUpDownCounter]; ok {
			if len(dimensionsSet) == 0 {
				c.Add(ctx, 1, attributeAddOpt)
				return
			}
			// String Slice attributes have to be exploded into multiple metrics with different label values in Prometheus.
			// This is because Prometheus does not support multi-value labels.
			for _, attr := range dimensionsSet {
				for _, v := range attr.Value.AsStringSlice() {
					c.Add(ctx, 1, otelmetric.WithAttributes(append(otherAttributes, attribute.KeyValue{
						Key:   attr.Key,
						Value: attribute.StringValue(v),
					})...))
				}
			}
		}
	}
}

func (h *PromMetricStore) MeasureRequestCount(ctx context.Context, attr ...attribute.KeyValue) {
	if c, ok := h.measurements.counters[RequestCounter]; ok {
		dimensionsSet, otherAttributes := filterStringSliceAttr(attr)
		otherAttributes = append(otherAttributes, otherAttributes...)

		if len(dimensionsSet) == 0 {
			c.Add(ctx, 1, otelmetric.WithAttributes(otherAttributes...))
			return
		}
		for _, attr := range dimensionsSet {
			for _, v := range attr.Value.AsStringSlice() {
				c.Add(ctx, 1, otelmetric.WithAttributes(append(otherAttributes, attribute.KeyValue{
					Key:   attr.Key,
					Value: attribute.StringValue(v),
				})...))
			}
		}
	}
}

func (h *PromMetricStore) MeasureRequestSize(ctx context.Context, contentLength int64, attr ...attribute.KeyValue) {
	if c, ok := h.measurements.counters[RequestContentLengthCounter]; ok {
		dimensionsSet, otherAttributes := filterStringSliceAttr(attr)
		otherAttributes = append(otherAttributes, otherAttributes...)

		if len(dimensionsSet) == 0 {
			c.Add(ctx, contentLength, otelmetric.WithAttributes(otherAttributes...))
			return
		}
		for _, attr := range dimensionsSet {
			for _, v := range attr.Value.AsStringSlice() {
				c.Add(ctx, contentLength, otelmetric.WithAttributes(append(otherAttributes, attribute.KeyValue{
					Key:   attr.Key,
					Value: attribute.StringValue(v),
				})...))
			}
		}
	}
}

func (h *PromMetricStore) MeasureResponseSize(ctx context.Context, size int64, attr ...attribute.KeyValue) {
	if c, ok := h.measurements.counters[ResponseContentLengthCounter]; ok {
		dimensionsSet, otherAttributes := filterStringSliceAttr(attr)
		otherAttributes = append(otherAttributes, otherAttributes...)

		if len(dimensionsSet) == 0 {
			c.Add(ctx, size, otelmetric.WithAttributes(otherAttributes...))
			return
		}
		for _, attr := range dimensionsSet {
			for _, v := range attr.Value.AsStringSlice() {
				c.Add(ctx, size, otelmetric.WithAttributes(append(otherAttributes, attribute.KeyValue{
					Key:   attr.Key,
					Value: attribute.StringValue(v),
				})...))
			}
		}
	}
}

func (h *PromMetricStore) MeasureLatency(ctx context.Context, latency time.Duration, attr ...attribute.KeyValue) {
	if c, ok := h.measurements.histograms[ServerLatencyHistogram]; ok {
		dimensionsSet, otherAttributes := filterStringSliceAttr(attr)
		otherAttributes = append(otherAttributes, otherAttributes...)

		// Use floating point division here for higher precision (instead of Millisecond method).
		elapsedTime := float64(latency) / float64(time.Millisecond)

		if len(dimensionsSet) == 0 {
			c.Record(ctx, elapsedTime, otelmetric.WithAttributes(otherAttributes...))
			return
		}
		for _, attr := range dimensionsSet {
			for _, v := range attr.Value.AsStringSlice() {
				c.Record(ctx, elapsedTime, otelmetric.WithAttributes(append(otherAttributes, attribute.KeyValue{
					Key:   attr.Key,
					Value: attribute.StringValue(v),
				})...))
			}
		}
	}
}

func (h *PromMetricStore) MeasureRequestError(ctx context.Context, attr ...attribute.KeyValue) {
	dimensionsSet, otherAttributes := filterStringSliceAttr(attr)
	otherAttributes = append(otherAttributes, otherAttributes...)

	if c, ok := h.measurements.counters[RequestError]; ok {
		if len(dimensionsSet) == 0 {
			c.Add(ctx, 1, otelmetric.WithAttributes(otherAttributes...))
			return
		}
		for _, attr := range dimensionsSet {
			for _, v := range attr.Value.AsStringSlice() {
				c.Add(ctx, 1, otelmetric.WithAttributes(append(otherAttributes, attribute.KeyValue{
					Key:   attr.Key,
					Value: attribute.StringValue(v),
				})...))
			}
		}
	}
}

func (h *PromMetricStore) MeasureOperationPlanningTime(ctx context.Context, planningTime time.Duration, attr ...attribute.KeyValue) {
	dimensionsSet, otherAttributes := filterStringSliceAttr(attr)
	otherAttributes = append(otherAttributes, otherAttributes...)

	// Use floating point division here for higher precision (instead of Millisecond method).
	elapsedTime := float64(planningTime) / float64(time.Millisecond)

	if c, ok := h.measurements.histograms[OperationPlanningTime]; ok {
		if len(dimensionsSet) == 0 {
			c.Record(ctx, elapsedTime, otelmetric.WithAttributes(otherAttributes...))
			return
		}
		for _, attr := range dimensionsSet {
			for _, v := range attr.Value.AsStringSlice() {
				c.Record(ctx, elapsedTime, otelmetric.WithAttributes(append(otherAttributes, attribute.KeyValue{
					Key:   attr.Key,
					Value: attribute.StringValue(v),
				})...))
			}
		}
	}
}

func (h *PromMetricStore) Flush(ctx context.Context) error {
	return h.meterProvider.ForceFlush(ctx)
}

func (h *PromMetricStore) Shutdown(ctx context.Context) error {
	return h.meterProvider.Shutdown(ctx)
}

func isStringSliceAttr(kv attribute.KeyValue) bool {
	return kv.Value.Type() == attribute.STRINGSLICE
}

func filterStringSliceAttr(kv []attribute.KeyValue) (stringSliceAttr []attribute.KeyValue, excludeAttr []attribute.KeyValue) {
	for _, a := range kv {
		if isStringSliceAttr(a) {
			stringSliceAttr = append(stringSliceAttr, a)
		} else {
			excludeAttr = append(excludeAttr, a)
		}
	}
	return
}
