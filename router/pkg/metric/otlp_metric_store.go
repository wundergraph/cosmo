package metric

import (
	"context"

	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
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

func (h *OtlpMetricStore) MeasureInFlight(ctx context.Context, opts ...otelmetric.AddOption) func() {

	if c, ok := h.measurements.upDownCounters[InFlightRequestsUpDownCounter]; ok {
		c.Add(ctx, 1, opts...)
	}

	return func() {
		if c, ok := h.measurements.upDownCounters[InFlightRequestsUpDownCounter]; ok {
			c.Add(ctx, -1, opts...)
		}
	}
}

func (h *OtlpMetricStore) MeasureRequestCount(ctx context.Context, opts ...otelmetric.AddOption) {
	if c, ok := h.measurements.counters[RequestCounter]; ok {
		c.Add(ctx, 1, opts...)
	}
}

func (h *OtlpMetricStore) MeasureRequestSize(ctx context.Context, contentLength int64, opts ...otelmetric.AddOption) {
	if c, ok := h.measurements.counters[RequestContentLengthCounter]; ok {
		c.Add(ctx, contentLength, opts...)
	}
}

func (h *OtlpMetricStore) MeasureResponseSize(ctx context.Context, size int64, opts ...otelmetric.AddOption) {
	if c, ok := h.measurements.counters[ResponseContentLengthCounter]; ok {
		c.Add(ctx, size, opts...)
	}
}

func (h *OtlpMetricStore) MeasureLatency(ctx context.Context, latency float64, opts ...otelmetric.RecordOption) {
	if c, ok := h.measurements.histograms[ServerLatencyHistogram]; ok {
		c.Record(ctx, latency, opts...)
	}
}

func (h *OtlpMetricStore) MeasureRequestError(ctx context.Context, opts ...otelmetric.AddOption) {
	if c, ok := h.measurements.counters[RequestError]; ok {
		c.Add(ctx, 1, opts...)
	}
}

func (h *OtlpMetricStore) MeasureOperationPlanningTime(ctx context.Context, planningTime float64, opts ...otelmetric.RecordOption) {
	if c, ok := h.measurements.histograms[OperationPlanningTime]; ok {
		c.Record(ctx, planningTime, opts...)
	}
}

func (h *OtlpMetricStore) MeasureSchemaFieldUsage(_ context.Context, _ int64, _ ...otelmetric.AddOption) {
	// Do not record schema usage in OpenTelemetry
}

func (h *OtlpMetricStore) Flush(ctx context.Context) error {
	return h.meterProvider.ForceFlush(ctx)
}

func (h *OtlpMetricStore) RecordDNSDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	if c, ok := h.measurements.histograms[DNSDurationKey]; ok {
		c.Record(ctx, duration, opts...)
	}
}

func (h *OtlpMetricStore) RecordTCPDialDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	if c, ok := h.measurements.histograms[TCPDialDurationKey]; ok {
		c.Record(ctx, duration, opts...)
	}
}

func (h *OtlpMetricStore) RecordTLSHandshakeDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	if c, ok := h.measurements.histograms[TLSHandshakeDurationKey]; ok {
		c.Record(ctx, duration, opts...)
	}
}

func (h *OtlpMetricStore) RecordTotalConnectionDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	if c, ok := h.measurements.histograms[TotalConnectionDurationKey]; ok {
		c.Record(ctx, duration, opts...)
	}
}

func (h *OtlpMetricStore) RecordPoolWaitDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	if c, ok := h.measurements.histograms[PoolWaitDurationKey]; ok {
		c.Record(ctx, duration, opts...)
	}
}

func (h *OtlpMetricStore) RecordPoolWaitCountTotal(ctx context.Context, count int64, opts ...otelmetric.AddOption) {
	if c, ok := h.measurements.counters[PoolWaitCountTotalKey]; ok {
		c.Add(ctx, count, opts...)
	}
}

func (h *OtlpMetricStore) RecordConnectionNewTotal(ctx context.Context, count int64, opts ...otelmetric.AddOption) {
	if c, ok := h.measurements.counters[ConnectionNewTotalKey]; ok {
		c.Add(ctx, count, opts...)
	}
}

func (h *OtlpMetricStore) RecordConnectionReuseTotal(ctx context.Context, count int64, opts ...otelmetric.AddOption) {
	if c, ok := h.measurements.counters[ConnectionReuseTotalKey]; ok {
		c.Add(ctx, count, opts...)
	}
}

func (h *OtlpMetricStore) RecordPoolActiveConnections(ctx context.Context, delta int64, opts ...otelmetric.AddOption) {
	if c, ok := h.measurements.upDownCounters[PoolActiveConnectionsKey]; ok {
		c.Add(ctx, delta, opts...)
	}
}

func (h *OtlpMetricStore) RecordPoolIdleConnections(ctx context.Context, delta int64, opts ...otelmetric.AddOption) {
	if c, ok := h.measurements.upDownCounters[PoolIdleConnectionsKey]; ok {
		c.Add(ctx, delta, opts...)
	}
}
