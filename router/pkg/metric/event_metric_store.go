package metric

import (
	"context"
	"errors"
	"fmt"

	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"

	otelattrs "github.com/wundergraph/cosmo/router/pkg/otel"
)

const (
	ProviderTypeKafka = "kafka"
	ProviderTypeNats  = "nats"
	ProviderTypeRedis = "redis"
)

// EventMetricProvider is the interface that wraps the basic Event metric methods.
// We maintain two providers, one for OTEL and one for Prometheus.
type EventMetricProvider interface {
	// unified publish/receive for brokers (kafka, redis, nats)
	Publish(ctx context.Context, opts ...otelmetric.AddOption)
	PublishFailure(ctx context.Context, opts ...otelmetric.AddOption)
	MessagesReceived(ctx context.Context, opts ...otelmetric.AddOption)

	// keep NATS request separate
	NatsRequest(ctx context.Context, opts ...otelmetric.AddOption)
	NatsRequestFailure(ctx context.Context, opts ...otelmetric.AddOption)

	Flush(ctx context.Context) error
	Shutdown() error
}

type EventMetricStore interface {
	KafkaPublish(ctx context.Context, providerID string, topic string)
	KafkaPublishFailure(ctx context.Context, providerID string, topic string)
	KafkaMessageReceived(ctx context.Context, providerID string, topic string)

	RedisPublish(ctx context.Context, providerID string, channel string)
	RedisPublishFailure(ctx context.Context, providerID string, channel string)
	RedisMessageReceived(ctx context.Context, providerID string, channel string)

	NatsPublish(ctx context.Context, providerID string, subject string)
	NatsPublishFailure(ctx context.Context, providerID string, subject string)
	NatsMessageReceived(ctx context.Context, providerID string, subject string)
	NatsRequest(ctx context.Context, providerID string, subject string)
	NatsRequestFailure(ctx context.Context, providerID string, subject string)

	Flush(ctx context.Context) error
	Shutdown(ctx context.Context) error
}

// EventMetrics is the store for Event (Kafka/Redis/NATS) metrics.
type EventMetrics struct {
	baseAttributes []attribute.KeyValue
	logger         *zap.Logger

	otlpMetrics EventMetricProvider
	promMetrics EventMetricProvider
}

func NewEventMetricStore(logger *zap.Logger, baseAttributes []attribute.KeyValue, otelProvider, promProvider *metric.MeterProvider, metricsConfig *Config) (*EventMetrics, error) {
	store := &EventMetrics{
		baseAttributes: baseAttributes,
		logger:         logger,
		otlpMetrics:    &noopEventMetricProvider{},
		promMetrics:    &noopEventMetricProvider{},
	}

	if metricsConfig.OpenTelemetry.EventMetrics {
		otlpMetrics, err := newOtlpEventMetrics(logger, otelProvider)
		if err != nil {
			return nil, fmt.Errorf("failed to create otlp event metrics: %w", err)
		}
		store.otlpMetrics = otlpMetrics
	}

	if metricsConfig.Prometheus.EventMetrics {
		promMetrics, err := newPromEventMetrics(logger, promProvider)
		if err != nil {
			return nil, fmt.Errorf("failed to create prometheus event metrics: %w", err)
		}
		store.promMetrics = promMetrics
	}

	return store, nil
}

func (e *EventMetrics) withAttrs(attrs ...attribute.KeyValue) otelmetric.AddOption {
	copied := append([]attribute.KeyValue{}, e.baseAttributes...)
	return otelmetric.WithAttributes(append(copied, attrs...)...)
}

func (e *EventMetrics) KafkaPublish(ctx context.Context, providerID string, topic string) {
	opts := e.withAttrs(
		otelattrs.WgEventProviderType.String(ProviderTypeKafka),
		otelattrs.WgEventProviderID.String(providerID),
		otelattrs.WgKafkaTopic.String(topic),
	)
	e.otlpMetrics.Publish(ctx, opts)
	e.promMetrics.Publish(ctx, opts)
}

func (e *EventMetrics) KafkaPublishFailure(ctx context.Context, providerID string, topic string) {
	opts := e.withAttrs(
		otelattrs.WgEventProviderType.String(ProviderTypeKafka),
		otelattrs.WgEventProviderID.String(providerID),
		otelattrs.WgKafkaTopic.String(topic),
	)
	e.otlpMetrics.PublishFailure(ctx, opts)
	e.promMetrics.PublishFailure(ctx, opts)
}

func (e *EventMetrics) KafkaMessageReceived(ctx context.Context, providerID string, topic string) {
	opts := e.withAttrs(
		otelattrs.WgEventProviderType.String(ProviderTypeKafka),
		otelattrs.WgEventProviderID.String(providerID),
		otelattrs.WgKafkaTopic.String(topic),
	)
	e.otlpMetrics.MessagesReceived(ctx, opts)
	e.promMetrics.MessagesReceived(ctx, opts)
}

func (e *EventMetrics) RedisPublish(ctx context.Context, providerID string, channel string) {
	opts := e.withAttrs(
		otelattrs.WgEventProviderType.String(ProviderTypeRedis),
		otelattrs.WgEventProviderID.String(providerID),
		otelattrs.WgRedisChannel.String(channel),
	)
	e.otlpMetrics.Publish(ctx, opts)
	e.promMetrics.Publish(ctx, opts)
}

func (e *EventMetrics) RedisPublishFailure(ctx context.Context, providerID string, channel string) {
	opts := e.withAttrs(
		otelattrs.WgEventProviderType.String(ProviderTypeRedis),
		otelattrs.WgEventProviderID.String(providerID),
		otelattrs.WgRedisChannel.String(channel),
	)
	e.otlpMetrics.PublishFailure(ctx, opts)
	e.promMetrics.PublishFailure(ctx, opts)
}

func (e *EventMetrics) RedisMessageReceived(ctx context.Context, providerID string, channel string) {
	opts := e.withAttrs(
		otelattrs.WgEventProviderType.String(ProviderTypeRedis),
		otelattrs.WgEventProviderID.String(providerID),
		otelattrs.WgRedisChannel.String(channel),
	)
	e.otlpMetrics.MessagesReceived(ctx, opts)
	e.promMetrics.MessagesReceived(ctx, opts)
}

func (e *EventMetrics) NatsPublish(ctx context.Context, providerID string, subject string) {
	opts := e.withAttrs(
		otelattrs.WgEventProviderType.String(ProviderTypeNats),
		otelattrs.WgEventProviderID.String(providerID),
		otelattrs.WgNatsSubject.String(subject),
	)
	e.otlpMetrics.Publish(ctx, opts)
	e.promMetrics.Publish(ctx, opts)
}

func (e *EventMetrics) NatsPublishFailure(ctx context.Context, providerID string, subject string) {
	opts := e.withAttrs(
		otelattrs.WgEventProviderType.String(ProviderTypeNats),
		otelattrs.WgEventProviderID.String(providerID),
		otelattrs.WgNatsSubject.String(subject),
	)
	e.otlpMetrics.PublishFailure(ctx, opts)
	e.promMetrics.PublishFailure(ctx, opts)
}

func (e *EventMetrics) NatsMessageReceived(ctx context.Context, providerID string, subject string) {
	opts := e.withAttrs(
		otelattrs.WgEventProviderType.String(ProviderTypeNats),
		otelattrs.WgEventProviderID.String(providerID),
		otelattrs.WgNatsSubject.String(subject),
	)
	e.otlpMetrics.MessagesReceived(ctx, opts)
	e.promMetrics.MessagesReceived(ctx, opts)
}

func (e *EventMetrics) NatsRequest(ctx context.Context, providerID string, subject string) {
	opts := e.withAttrs(
		otelattrs.WgEventProviderID.String(providerID),
		otelattrs.WgEventProviderType.String(ProviderTypeNats),
		otelattrs.WgNatsSubject.String(subject),
	)
	e.otlpMetrics.NatsRequest(ctx, opts)
	e.promMetrics.NatsRequest(ctx, opts)
}

func (e *EventMetrics) NatsRequestFailure(ctx context.Context, providerID string, subject string) {
	opts := e.withAttrs(
		otelattrs.WgEventProviderID.String(providerID),
		otelattrs.WgEventProviderType.String(ProviderTypeNats),
		otelattrs.WgNatsSubject.String(subject),
	)
	e.otlpMetrics.NatsRequestFailure(ctx, opts)
	e.promMetrics.NatsRequestFailure(ctx, opts)
}

// Flush flushes the metrics to the backend synchronously.
func (e *EventMetrics) Flush(ctx context.Context) error {
	var err error

	if errOtlp := e.otlpMetrics.Flush(ctx); errOtlp != nil {
		err = errors.Join(err, fmt.Errorf("failed to flush otlp metrics: %w", errOtlp))
	}

	if errProm := e.promMetrics.Flush(ctx); errProm != nil {
		err = errors.Join(err, fmt.Errorf("failed to flush prometheus metrics: %w", errProm))
	}

	return err
}

// Shutdown flushes the metrics and stops observers if any.
func (e *EventMetrics) Shutdown(ctx context.Context) error {
	var err error

	if errFlush := e.Flush(ctx); errFlush != nil {
		err = errors.Join(err, fmt.Errorf("failed to flush metrics: %w", errFlush))
	}

	if errProm := e.promMetrics.Shutdown(); errProm != nil {
		err = errors.Join(err, fmt.Errorf("failed to shutdown prom metrics: %w", errProm))
	}

	if errOtlp := e.otlpMetrics.Shutdown(); errOtlp != nil {
		err = errors.Join(err, fmt.Errorf("failed to shutdown otlp metrics: %w", errOtlp))
	}

	return err
}
