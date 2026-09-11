package metric

import (
	"context"

	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
)

const (
	cosmoRouterEventPromMeterName    = "cosmo.router.streams.prometheus"
	cosmoRouterEventPromMeterVersion = "0.0.1"
)

type promStreamEventMetrics struct {
	instruments   *eventInstruments
	meterProvider *metric.MeterProvider
	logger        *zap.Logger
	meter         otelmetric.Meter
}

func newPromStreamEventMetrics(logger *zap.Logger, meterProvider *metric.MeterProvider) (*promStreamEventMetrics, error) {
	meter := meterProvider.Meter(
		cosmoRouterEventPromMeterName,
		otelmetric.WithInstrumentationVersion(cosmoRouterEventPromMeterVersion),
	)

	instruments, err := newStreamEventInstruments(meter)
	if err != nil {
		return nil, err
	}

	return &promStreamEventMetrics{
		instruments:   instruments,
		meterProvider: meterProvider,
		logger:        logger,
		meter:         meter,
	}, nil
}

func (p *promStreamEventMetrics) Produce(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.producedMessages.Add(ctx, 1, opts...)
}

func (p *promStreamEventMetrics) Consume(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.consumedMessages.Add(ctx, 1, opts...)
}

func (p *promStreamEventMetrics) Process(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.processedMessages.Add(ctx, 1, opts...)
}
func (p *promStreamEventMetrics) DispatchInFlight(ctx context.Context, delta int64, opts ...otelmetric.AddOption) {
	p.instruments.dispatchInFlight.Add(ctx, delta, opts...)
}
func (p *promStreamEventMetrics) DispatchDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	p.instruments.dispatchDuration.Record(ctx, duration, opts...)
}

func (p *promStreamEventMetrics) Flush(ctx context.Context) error {
	return p.meterProvider.ForceFlush(ctx)
}
