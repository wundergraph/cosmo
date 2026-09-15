package metric

import (
	"context"

	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
)

const (
	cosmoRouterStreamEventMeterName    = "cosmo.router.streams"
	cosmoRouterStreamEventMeterVersion = "0.0.1"
)

type otlpStreamEventMetrics struct {
	instruments   *eventInstruments
	meterProvider *metric.MeterProvider
	logger        *zap.Logger
	meter         otelmetric.Meter
}

func newOtlpStreamEventMetrics(logger *zap.Logger, meterProvider *metric.MeterProvider) (*otlpStreamEventMetrics, error) {
	meter := meterProvider.Meter(
		cosmoRouterStreamEventMeterName,
		otelmetric.WithInstrumentationVersion(cosmoRouterStreamEventMeterVersion),
	)

	instruments, err := newStreamEventInstruments(meter)
	if err != nil {
		return nil, err
	}

	return &otlpStreamEventMetrics{
		instruments:   instruments,
		meterProvider: meterProvider,
		logger:        logger,
		meter:         meter,
	}, nil
}

func (o *otlpStreamEventMetrics) Produce(ctx context.Context, opts ...otelmetric.AddOption) {
	o.instruments.producedMessages.Add(ctx, 1, opts...)
}

func (o *otlpStreamEventMetrics) Consume(ctx context.Context, opts ...otelmetric.AddOption) {
	o.instruments.consumedMessages.Add(ctx, 1, opts...)
}

func (o *otlpStreamEventMetrics) Process(ctx context.Context, opts ...otelmetric.AddOption) {
	o.instruments.processedMessages.Add(ctx, 1, opts...)
}
func (o *otlpStreamEventMetrics) DispatchInFlight(ctx context.Context, delta int64, opts ...otelmetric.AddOption) {
	o.instruments.dispatchInFlight.Add(ctx, delta, opts...)
}
func (o *otlpStreamEventMetrics) DispatchDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	o.instruments.dispatchDuration.Record(ctx, duration, opts...)
}
