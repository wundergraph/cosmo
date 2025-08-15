package metric

import (
	"context"

	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
)

const (
	cosmoRouterEventPromMeterName    = "cosmo.router.event.prometheus"
	cosmoRouterEventPromMeterVersion = "0.0.1"
)

type promEventMetrics struct {
	instruments   *eventInstruments
	meterProvider *metric.MeterProvider
	logger        *zap.Logger
	meter         otelmetric.Meter
}

func newPromEventMetrics(logger *zap.Logger, meterProvider *metric.MeterProvider) (*promEventMetrics, error) {
	meter := meterProvider.Meter(
		cosmoRouterEventPromMeterName,
		otelmetric.WithInstrumentationVersion(cosmoRouterEventPromMeterVersion),
	)

	instruments, err := newEventInstruments(meter)
	if err != nil {
		return nil, err
	}

	return &promEventMetrics{
		instruments:   instruments,
		meterProvider: meterProvider,
		logger:        logger,
		meter:         meter,
	}, nil
}

// Unified methods
func (p *promEventMetrics) Publish(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.publishMessages.Add(ctx, 1, opts...)
}

func (p *promEventMetrics) PublishFailure(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.publishFailures.Add(ctx, 1, opts...)
}

func (p *promEventMetrics) MessagesReceived(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.messagesReceived.Add(ctx, 1, opts...)
}

// NATS request methods remain
func (p *promEventMetrics) NatsRequest(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.natsRequests.Add(ctx, 1, opts...)
}

func (p *promEventMetrics) NatsRequestFailure(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.natsRequestFailures.Add(ctx, 1, opts...)
}

func (p *promEventMetrics) Flush(ctx context.Context) error { return p.meterProvider.ForceFlush(ctx) }
func (p *promEventMetrics) Shutdown() error                 { return nil }
