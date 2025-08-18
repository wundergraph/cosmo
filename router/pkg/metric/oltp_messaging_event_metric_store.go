package metric

import (
	"context"

	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
)

const (
	cosmoRouterEventMeterName    = "cosmo.router.messaging.events"
	cosmoRouterEventMeterVersion = "0.0.1"
)

type otlpMessagingEventMetrics struct {
	instruments   *eventInstruments
	meterProvider *metric.MeterProvider
	logger        *zap.Logger
	meter         otelmetric.Meter
}

func newOtlpMessagingEventMetrics(logger *zap.Logger, meterProvider *metric.MeterProvider) (*otlpMessagingEventMetrics, error) {
	meter := meterProvider.Meter(
		cosmoRouterEventMeterName,
		otelmetric.WithInstrumentationVersion(cosmoRouterEventMeterVersion),
	)

	instruments, err := newMessagingEventInstruments(meter)
	if err != nil {
		return nil, err
	}

	return &otlpMessagingEventMetrics{
		instruments:   instruments,
		meterProvider: meterProvider,
		logger:        logger,
		meter:         meter,
	}, nil
}

func (o *otlpMessagingEventMetrics) Produce(ctx context.Context, opts ...otelmetric.AddOption) {
	o.instruments.producedMessages.Add(ctx, 1, opts...)
}

func (o *otlpMessagingEventMetrics) Consume(ctx context.Context, opts ...otelmetric.AddOption) {
	o.instruments.consumedMessages.Add(ctx, 1, opts...)
}

func (o *otlpMessagingEventMetrics) Flush(ctx context.Context) error {
	return o.meterProvider.ForceFlush(ctx)
}
