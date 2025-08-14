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

func (o *otlpEventMetrics) KafkaPublish(ctx context.Context, opts ...otelmetric.AddOption) {
	o.instruments.kafkaPublishMessages.Add(ctx, 1, opts...)
}

func (o *otlpEventMetrics) KafkaPublishFailure(ctx context.Context, opts ...otelmetric.AddOption) {
	o.instruments.kafkaPublishFailures.Add(ctx, 1, opts...)
}

func (o *otlpEventMetrics) KafkaMessageReceived(ctx context.Context, opts ...otelmetric.AddOption) {
	o.instruments.kafkaMessagesReceived.Add(ctx, 1, opts...)
}

func (o *otlpEventMetrics) RedisPublish(ctx context.Context, opts ...otelmetric.AddOption) {
	o.instruments.redisPublishMessages.Add(ctx, 1, opts...)
}

func (o *otlpEventMetrics) RedisPublishFailure(ctx context.Context, opts ...otelmetric.AddOption) {
	o.instruments.redisPublishFailures.Add(ctx, 1, opts...)
}

func (o *otlpEventMetrics) RedisMessageReceived(ctx context.Context, opts ...otelmetric.AddOption) {
	o.instruments.redisMessagesReceived.Add(ctx, 1, opts...)
}

func (o *otlpEventMetrics) NatsPublish(ctx context.Context, opts ...otelmetric.AddOption) {
	o.instruments.natsPublishMessages.Add(ctx, 1, opts...)
}

func (o *otlpEventMetrics) NatsPublishFailure(ctx context.Context, opts ...otelmetric.AddOption) {
	o.instruments.natsPublishFailures.Add(ctx, 1, opts...)
}

func (o *otlpEventMetrics) NatsMessageReceived(ctx context.Context, opts ...otelmetric.AddOption) {
	o.instruments.natsMessagesReceived.Add(ctx, 1, opts...)
}

func (o *otlpEventMetrics) NatsRequest(ctx context.Context, opts ...otelmetric.AddOption) {
	o.instruments.natsRequests.Add(ctx, 1, opts...)
}

func (o *otlpEventMetrics) NatsRequestFailure(ctx context.Context, opts ...otelmetric.AddOption) {
	o.instruments.natsRequestFailures.Add(ctx, 1, opts...)
}

func (o *otlpEventMetrics) Flush(ctx context.Context) error {
	return o.meterProvider.ForceFlush(ctx)
}

func (o *otlpEventMetrics) Shutdown() error { return nil }
