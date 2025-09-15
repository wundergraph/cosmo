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

func (o *otlpStreamEventMetrics) Flush(ctx context.Context) error {
	return o.meterProvider.ForceFlush(ctx)
}
