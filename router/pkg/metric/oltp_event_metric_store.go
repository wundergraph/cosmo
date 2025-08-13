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
	cosmoRouterEventMeterName    = "cosmo.router.event"
	cosmoRouterEventMeterVersion = "0.0.1"
)

type otlpEventMetrics struct {
	instruments   *eventInstruments
	meterProvider *metric.MeterProvider
	logger        *zap.Logger
	meter         otelmetric.Meter
}

func newOtlpEventMetrics(logger *zap.Logger, meterProvider *metric.MeterProvider, baseAttributes []attribute.KeyValue) (*otlpEventMetrics, error) {
	meter := meterProvider.Meter(
		cosmoRouterEventMeterName,
		otelmetric.WithInstrumentationVersion(cosmoRouterEventMeterVersion),
	)

	instruments, err := newEventInstruments(meter)
	if err != nil {
		return nil, fmt.Errorf("failed to create otlp event instruments: %w", err)
	}

	return &otlpEventMetrics{
		instruments:   instruments,
		meterProvider: meterProvider,
		logger:        logger,
		meter:         meter,
	}, nil
}

func (o *otlpEventMetrics) Publish(ctx context.Context, backend string, count int64, opts ...otelmetric.AddOption) {
	switch backend {
	case EventBackendKafka:
		o.instruments.kafkaPublishMessages.Add(ctx, count, opts...)
	case EventBackendRedis:
		o.instruments.redisPublishMessages.Add(ctx, count, opts...)
	case EventBackendNats:
		o.instruments.natsPublishMessages.Add(ctx, count, opts...)
	default:
		o.instruments.kafkaPublishMessages.Add(ctx, count, opts...)
	}
}

func (o *otlpEventMetrics) PublishFailure(ctx context.Context, backend string, count int64, opts ...otelmetric.AddOption) {
	switch backend {
	case EventBackendKafka:
		o.instruments.kafkaPublishFailures.Add(ctx, count, opts...)
	case EventBackendRedis:
		o.instruments.redisPublishFailures.Add(ctx, count, opts...)
	case EventBackendNats:
		o.instruments.natsPublishFailures.Add(ctx, count, opts...)
	default:
		o.instruments.kafkaPublishFailures.Add(ctx, count, opts...)
	}
}

func (o *otlpEventMetrics) MessageReceived(ctx context.Context, backend string, count int64, opts ...otelmetric.AddOption) {
	switch backend {
	case EventBackendKafka:
		o.instruments.kafkaMessagesReceived.Add(ctx, count, opts...)
	case EventBackendRedis:
		o.instruments.redisMessagesReceived.Add(ctx, count, opts...)
	case EventBackendNats:
		o.instruments.natsMessagesReceived.Add(ctx, count, opts...)
	default:
		o.instruments.kafkaMessagesReceived.Add(ctx, count, opts...)
	}
}

func (o *otlpEventMetrics) Flush(ctx context.Context) error {
	return o.meterProvider.ForceFlush(ctx)
}

func (o *otlpEventMetrics) Shutdown() error { return nil }
