package metric

import (
	"context"
	"errors"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
)

const (
	cosmoRouterMeterName    = "cosmo.router"
	cosmoRouterMeterVersion = "0.0.1"
)

type OtlpMetricStore struct {
	meter                   otelmetric.Meter
	meterProvider           *metric.MeterProvider
	logger                  *zap.Logger
	measurements            *Measurements
	instrumentRegistrations []otelmetric.Registration
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

func (h *OtlpMetricStore) StartRouterInfoCallback(opts ...otelmetric.ObserveOption) error {
	gauge := h.measurements.observableGauges[RouterInfo]

	rc, err := h.meter.RegisterCallback(func(_ context.Context, o otelmetric.Observer) error {
		o.ObserveInt64(gauge, 1, opts...)
		return nil
	}, gauge)
	if err != nil {
		return err
	}

	h.instrumentRegistrations = append(h.instrumentRegistrations, rc)
	return nil
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

func (h *OtlpMetricStore) Shutdown() error {
	var err error

	for _, reg := range h.instrumentRegistrations {
		if regErr := reg.Unregister(); regErr != nil {
			err = errors.Join(regErr)
		}
	}

	return err
}
