package metric

import (
	"context"
	"fmt"

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
		return nil, fmt.Errorf("failed to create prometheus event instruments: %w", err)
	}

	return &promEventMetrics{
		instruments:   instruments,
		meterProvider: meterProvider,
		logger:        logger,
		meter:         meter,
	}, nil
}

func (p *promEventMetrics) KafkaPublish(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.kafkaPublishMessages.Add(ctx, 1, opts...)
}

func (p *promEventMetrics) KafkaPublishFailure(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.kafkaPublishFailures.Add(ctx, 1, opts...)
}

func (p *promEventMetrics) KafkaMessageReceived(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.kafkaMessagesReceived.Add(ctx, 1, opts...)
}

func (p *promEventMetrics) RedisPublish(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.redisPublishMessages.Add(ctx, 1, opts...)
}

func (p *promEventMetrics) RedisPublishFailure(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.redisPublishFailures.Add(ctx, 1, opts...)
}

func (p *promEventMetrics) RedisMessageReceived(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.redisMessagesReceived.Add(ctx, 1, opts...)
}

func (p *promEventMetrics) NatsPublish(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.natsPublishMessages.Add(ctx, 1, opts...)
}

func (p *promEventMetrics) NatsPublishFailure(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.natsPublishFailures.Add(ctx, 1, opts...)
}

func (p *promEventMetrics) NatsMessageReceived(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.natsMessagesReceived.Add(ctx, 1, opts...)
}

func (p *promEventMetrics) NatsRequest(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.natsRequests.Add(ctx, 1, opts...)
}

func (p *promEventMetrics) NatsRequestFailure(ctx context.Context, opts ...otelmetric.AddOption) {
	p.instruments.natsRequestFailures.Add(ctx, 1, opts...)
}

func (p *promEventMetrics) Flush(ctx context.Context) error { return p.meterProvider.ForceFlush(ctx) }
func (p *promEventMetrics) Shutdown() error                 { return nil }
