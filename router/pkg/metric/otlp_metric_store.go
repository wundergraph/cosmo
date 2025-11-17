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
	circuitBreakerEnabled   bool
}

func NewOtlpMetricStore(logger *zap.Logger, meterProvider *metric.MeterProvider, routerInfoAttributes otelmetric.ObserveOption, opts MetricOpts) (Provider, error) {

	meter := meterProvider.Meter(cosmoRouterMeterName,
		otelmetric.WithInstrumentationVersion(cosmoRouterMeterVersion),
	)

	m := &OtlpMetricStore{
		meter:                   meter,
		logger:                  logger,
		meterProvider:           meterProvider,
		instrumentRegistrations: make([]otelmetric.Registration, 0, 1),
		circuitBreakerEnabled:   opts.EnableCircuitBreaker,
	}

	measures, err := createMeasures(meter, opts)
	if err != nil {
		return nil, err
	}

	m.measurements = measures

	err = m.startInitMetrics(routerInfoAttributes)
	if err != nil {
		return nil, err
	}

	return m, nil
}

func (h *OtlpMetricStore) startInitMetrics(initAttributes otelmetric.ObserveOption) error {
	gauge := h.measurements.observableGauges[RouterInfo]

	rc, err := h.meter.RegisterCallback(func(_ context.Context, o otelmetric.Observer) error {
		o.ObserveInt64(gauge, 1, initAttributes)
		return nil
	}, gauge)
	if err != nil {
		return err
	}

	h.instrumentRegistrations = append(h.instrumentRegistrations, rc)
	return nil
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

func (h *OtlpMetricStore) MeasureCircuitBreakerShortCircuit(ctx context.Context, opts ...otelmetric.AddOption) {
	if !h.circuitBreakerEnabled {
		return
	}

	if c, ok := h.measurements.counters[CircuitBreakerShortCircuitsCounter]; ok {
		c.Add(ctx, 1, opts...)
	}
}

func (h *OtlpMetricStore) SetCircuitBreakerState(ctx context.Context, state bool, opts ...otelmetric.RecordOption) {
	if !h.circuitBreakerEnabled {
		return
	}

	if c, ok := h.measurements.gauges[CircuitBreakerStateGauge]; ok {
		// The value 0 here means it's not open, 1 means it's open
		var boolAsInt int64 = 0
		if state {
			boolAsInt = 1
		}
		c.Record(ctx, boolAsInt, opts...)
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
