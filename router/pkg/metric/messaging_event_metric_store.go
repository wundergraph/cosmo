package metric

import (
	"context"
	"errors"
	"fmt"

	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"

	otel "github.com/wundergraph/cosmo/router/pkg/otel"
)

type ProviderType string

const (
	ProviderTypeKafka ProviderType = "kafka"
	ProviderTypeNats  ProviderType = "nats"
	ProviderTypeRedis ProviderType = "redis"
)

// MessagingEvent carries the values for messaging metrics attributes.
type MessagingEvent struct {
	ProviderId      string       // The id of the provider defined in the configuration
	OperationName   string       // The operation name that is specific to the messaging system
	MessagingSystem ProviderType // The messaging system type that are supported
	Error           bool         // Indicates if the operation resulted in an error or not (true or false)
	DestinationName string       // The name of the destination queue / topic / channel
}

// MessagingEventMetricProvider is the interface that wraps the basic Event metric methods.
type MessagingEventMetricProvider interface {
	Produce(ctx context.Context, opts ...otelmetric.AddOption)
	Consume(ctx context.Context, opts ...otelmetric.AddOption)

	Flush(ctx context.Context) error
}

type MessagingEventMetricStore interface {
	Produce(ctx context.Context, event MessagingEvent)
	Consume(ctx context.Context, event MessagingEvent)

	Flush(ctx context.Context) error
	Shutdown(ctx context.Context) error
}

// MessagingEventMetrics is the store for Event (Kafka/Redis/NATS) metrics.
type MessagingEventMetrics struct {
	baseAttributes []attribute.KeyValue
	logger         *zap.Logger
	providers      []MessagingEventMetricProvider
}

func NewMessagingEventMetricStore(logger *zap.Logger, baseAttributes []attribute.KeyValue, otelProvider, promProvider *metric.MeterProvider, metricsConfig *Config) (*MessagingEventMetrics, error) {
	providers := make([]MessagingEventMetricProvider, 0)

	if metricsConfig.OpenTelemetry.MessagingEventMetrics {
		otlpMetrics, err := newOtlpMessagingEventMetrics(logger, otelProvider)
		if err != nil {
			return nil, fmt.Errorf("failed to create otlp event metrics: %w", err)
		}
		providers = append(providers, otlpMetrics)
	}

	if metricsConfig.Prometheus.MessagingEventMetrics {
		promMetrics, err := newPromMessagingEventMetrics(logger, promProvider)
		if err != nil {
			return nil, fmt.Errorf("failed to create prometheus event metrics: %w", err)
		}
		providers = append(providers, promMetrics)
	}

	store := &MessagingEventMetrics{
		baseAttributes: baseAttributes,
		logger:         logger,
		providers:      providers,
	}
	return store, nil
}

func (e *MessagingEventMetrics) withAttrs(attrs ...attribute.KeyValue) otelmetric.AddOption {
	copied := append([]attribute.KeyValue{}, e.baseAttributes...)
	return otelmetric.WithAttributes(append(copied, attrs...)...)
}

func (e *MessagingEventMetrics) Produce(ctx context.Context, event MessagingEvent) {
	attrs := []attribute.KeyValue{
		otel.WgMessagingOperationName.String(event.OperationName),
		otel.WgMessagingSystem.String(string(event.MessagingSystem)),
		otel.WgMessagingError.Bool(event.Error),
	}
	if event.ProviderId != "" {
		attrs = append(attrs, otel.WgProviderId.String(event.ProviderId))
	}
	if event.DestinationName != "" {
		attrs = append(attrs, otel.WgMessagingDestinationName.String(event.DestinationName))
	}
	opt := e.withAttrs(attrs...)

	for _, provider := range e.providers {
		provider.Produce(ctx, opt)
	}
}

func (e *MessagingEventMetrics) Consume(ctx context.Context, event MessagingEvent) {
	attrs := []attribute.KeyValue{
		otel.WgMessagingOperationName.String(event.OperationName),
		otel.WgMessagingSystem.String(string(event.MessagingSystem)),
		otel.WgMessagingError.Bool(event.Error),
	}
	if event.ProviderId != "" {
		attrs = append(attrs, otel.WgProviderId.String(event.ProviderId))
	}
	if event.DestinationName != "" {
		attrs = append(attrs, otel.WgMessagingDestinationName.String(event.DestinationName))
	}

	opt := e.withAttrs(attrs...)

	for _, provider := range e.providers {
		provider.Consume(ctx, opt)
	}
}

// Flush flushes the metrics to the backend synchronously.
func (e *MessagingEventMetrics) Flush(ctx context.Context) error {
	var err error

	for _, provider := range e.providers {
		if errOtlp := provider.Flush(ctx); errOtlp != nil {
			err = errors.Join(err, fmt.Errorf("failed to flush metrics: %w", errOtlp))
		}
	}

	return err
}

// Shutdown flushes the metrics and stops observers if any.
func (e *MessagingEventMetrics) Shutdown(ctx context.Context) error {
	var err error

	if errFlush := e.Flush(ctx); errFlush != nil {
		err = errors.Join(err, fmt.Errorf("failed to flush metrics: %w", errFlush))
	}

	return err
}
