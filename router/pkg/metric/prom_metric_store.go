package metric

import (
	"context"
	"errors"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
)

const (
	cosmoRouterPrometheusMeterName    = "cosmo.router.prometheus"
	cosmoRouterPrometheusMeterVersion = "0.0.1"
)

type PromMetricStore struct {
	meter                   otelmetric.Meter
	meterProvider           *metric.MeterProvider
	logger                  *zap.Logger
	measurements            *Measurements
	instrumentRegistrations []otelmetric.Registration
	circuitBreakerEnabled   bool
}

func NewPromMetricStore(
	logger *zap.Logger,
	meterProvider *metric.MeterProvider,
	routerInfoAttributes otelmetric.ObserveOption,
	opts MetricOpts,
) (Provider, error) {
	meter := meterProvider.Meter(cosmoRouterPrometheusMeterName,
		otelmetric.WithInstrumentationVersion(cosmoRouterPrometheusMeterVersion),
	)

	m := &PromMetricStore{
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

func (h *PromMetricStore) startInitMetrics(initAttributes otelmetric.ObserveOption) error {
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

func (h *PromMetricStore) MeasureInFlight(ctx context.Context, opts ...otelmetric.AddOption) func() {
	if c, ok := h.measurements.upDownCounters[InFlightRequestsUpDownCounter]; ok {
		c.Add(ctx, 1, opts...)
	}

	return func() {
		if c, ok := h.measurements.upDownCounters[InFlightRequestsUpDownCounter]; ok {
			c.Add(ctx, -1, opts...)
		}
	}
}

func (h *PromMetricStore) MeasureRequestCount(ctx context.Context, opts ...otelmetric.AddOption) {
	if c, ok := h.measurements.counters[RequestCounter]; ok {
		c.Add(ctx, 1, opts...)
	}
}

func (h *PromMetricStore) MeasureCircuitBreakerShortCircuit(ctx context.Context, opts ...otelmetric.AddOption) {
	if !h.circuitBreakerEnabled {
		return
	}

	if c, ok := h.measurements.counters[CircuitBreakerShortCircuitsCounter]; ok {
		c.Add(ctx, 1, opts...)
	}
}

func (h *PromMetricStore) SetCircuitBreakerState(ctx context.Context, state bool, opts ...otelmetric.RecordOption) {
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

func (h *PromMetricStore) MeasureRequestSize(ctx context.Context, contentLength int64, opts ...otelmetric.AddOption) {
	if c, ok := h.measurements.counters[RequestContentLengthCounter]; ok {
		c.Add(ctx, contentLength, opts...)
	}
}

func (h *PromMetricStore) MeasureResponseSize(ctx context.Context, size int64, opts ...otelmetric.AddOption) {
	if c, ok := h.measurements.counters[ResponseContentLengthCounter]; ok {
		c.Add(ctx, size, opts...)
	}
}

func (h *PromMetricStore) MeasureLatency(ctx context.Context, latency float64, opts ...otelmetric.RecordOption) {
	if c, ok := h.measurements.histograms[ServerLatencyHistogram]; ok {
		c.Record(ctx, latency, opts...)
	}
}

func (h *PromMetricStore) MeasureRequestError(ctx context.Context, opts ...otelmetric.AddOption) {
	if c, ok := h.measurements.counters[RequestError]; ok {
		c.Add(ctx, 1, opts...)
	}
}

func (h *PromMetricStore) MeasureOperationPlanningTime(ctx context.Context, planningTime float64, opts ...otelmetric.RecordOption) {
	if c, ok := h.measurements.histograms[OperationPlanningTime]; ok {
		c.Record(ctx, planningTime, opts...)
	}
}

func (h *PromMetricStore) MeasureSchemaFieldUsage(ctx context.Context, schemaUsage int64, opts ...otelmetric.AddOption) {
	if c, ok := h.measurements.counters[SchemaFieldUsageCounter]; ok {
		c.Add(ctx, schemaUsage, opts...)
	}
}

func (h *PromMetricStore) Flush(ctx context.Context) error {
	return h.meterProvider.ForceFlush(ctx)
}

func (h *PromMetricStore) Shutdown() error {
	var err error

	for _, reg := range h.instrumentRegistrations {
		if regErr := reg.Unregister(); regErr != nil {
			err = errors.Join(regErr)
		}
	}

	return err
}

// explodeAddInstrument explodes the metric into multiple metrics with different label values in Prometheus.
func explodeAddInstrument(ctx context.Context, sliceAttrs []attribute.KeyValue, collect func(ctx context.Context, opts ...otelmetric.AddOption)) {
	for _, attr := range sliceAttrs {
		s := attr.Value.AsStringSlice()

		// If the slice is empty, we should at least emit the metric without the attribute.
		// to not ignore the metric emission.
		if len(s) == 0 {
			collect(ctx)
			continue
		}

		for _, v := range s {
			kv := attribute.KeyValue{
				Key:   attr.Key,
				Value: attribute.StringValue(v),
			}
			o := []otelmetric.AddOption{
				otelmetric.WithAttributeSet(attribute.NewSet(kv)),
			}
			collect(ctx, o...)
		}
	}
}

// explodeRecordInstrument explodes the metric into multiple metrics with different label values in Prometheus.
func explodeRecordInstrument(ctx context.Context, sliceAttrs []attribute.KeyValue, collect func(ctx context.Context, opts ...otelmetric.RecordOption)) {
	for _, attr := range sliceAttrs {
		s := attr.Value.AsStringSlice()

		// If the slice is empty, we should at least emit the metric without the attribute.
		// to not ignore the metric emission.
		if len(s) == 0 {
			collect(ctx)
			continue
		}

		for _, v := range s {
			kv := attribute.KeyValue{
				Key:   attr.Key,
				Value: attribute.StringValue(v),
			}
			o := []otelmetric.RecordOption{
				otelmetric.WithAttributeSet(attribute.NewSet(kv)),
			}
			collect(ctx, o...)
		}
	}
}
