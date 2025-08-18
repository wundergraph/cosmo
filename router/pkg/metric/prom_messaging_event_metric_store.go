package metric

import (
	"context"

	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
)

const (
	cosmoRouterEventPromMeterName    = "cosmo.router.messaging.events.prometheus"
	cosmoRouterEventPromMeterVersion = "0.0.1"
)

type promMessagingEventMetrics struct {
	instruments   *eventInstruments
	meterProvider *metric.MeterProvider
	logger        *zap.Logger
	meter         otelmetric.Meter
}

func newPromMessagingEventMetrics(logger *zap.Logger, meterProvider *metric.MeterProvider) (*promMessagingEventMetrics, error) {
	meter := meterProvider.Meter(
		cosmoRouterEventPromMeterName,
		otelmetric.WithInstrumentationVersion(cosmoRouterEventPromMeterVersion),
	)

	instruments, err := newMessagingEventInstruments(meter)
	if err != nil {
		return nil, err
	}

	return &promMessagingEventMetrics{
		instruments:   instruments,
		meterProvider: meterProvider,
		logger:        logger,
		meter:         meter,
	}, nil
}

func (p *promMessagingEventMetrics) Produce(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.producedMessages.Add(ctx, 1, opts...)
}

func (p *promMessagingEventMetrics) Consume(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.consumedMessages.Add(ctx, 1, opts...)
}

func (p *promMessagingEventMetrics) Flush(ctx context.Context) error {
	return p.meterProvider.ForceFlush(ctx)
}
