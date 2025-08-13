package metric

import (
	"context"
	"fmt"

	"go.opentelemetry.io/otel/attribute"
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

func newPromEventMetrics(logger *zap.Logger, meterProvider *metric.MeterProvider, baseAttributes []attribute.KeyValue) (*promEventMetrics, error) {
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

func (p *promEventMetrics) Publish(ctx context.Context, backend string, count int64, opts ...otelmetric.AddOption) {
	switch backend {
	case EventBackendKafka:
		p.instruments.kafkaPublishMessages.Add(ctx, count, opts...)
	case EventBackendRedis:
		p.instruments.redisPublishMessages.Add(ctx, count, opts...)
	case EventBackendNats:
		p.instruments.natsPublishMessages.Add(ctx, count, opts...)
	default:
		p.instruments.kafkaPublishMessages.Add(ctx, count, opts...)
	}
}

func (p *promEventMetrics) PublishFailure(ctx context.Context, backend string, count int64, opts ...otelmetric.AddOption) {
	switch backend {
	case EventBackendKafka:
		p.instruments.kafkaPublishFailures.Add(ctx, count, opts...)
	case EventBackendRedis:
		p.instruments.redisPublishFailures.Add(ctx, count, opts...)
	case EventBackendNats:
		p.instruments.natsPublishFailures.Add(ctx, count, opts...)
	default:
		p.instruments.kafkaPublishFailures.Add(ctx, count, opts...)
	}
}

func (p *promEventMetrics) MessageReceived(ctx context.Context, backend string, count int64, opts ...otelmetric.AddOption) {
	switch backend {
	case EventBackendKafka:
		p.instruments.kafkaMessagesReceived.Add(ctx, count, opts...)
	case EventBackendRedis:
		p.instruments.redisMessagesReceived.Add(ctx, count, opts...)
	case EventBackendNats:
		p.instruments.natsMessagesReceived.Add(ctx, count, opts...)
	default:
		p.instruments.kafkaMessagesReceived.Add(ctx, count, opts...)
	}
}

func (p *promEventMetrics) Flush(ctx context.Context) error { return p.meterProvider.ForceFlush(ctx) }
func (p *promEventMetrics) Shutdown() error                 { return nil }
