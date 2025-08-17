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

const (
	ProviderTypeKafka = "kafka"
	ProviderTypeNats  = "nats"
	ProviderTypeRedis = "redis"
)

// MessagingEvent carries the values for messaging metrics attributes.
type MessagingEvent struct {
	OperationName   string
	MessagingSystem string
	ErrorType       string
	DestinationName string
}

// EventMetricProvider is the interface that wraps the basic Event metric methods.
// We maintain two providers, one for OTEL and one for Prometheus.
type EventMetricProvider interface {
	// unified produce/consume for brokers (kafka, redis, nats)
	Produce(ctx context.Context, opts ...otelmetric.AddOption)
	Consume(ctx context.Context, opts ...otelmetric.AddOption)

	Flush(ctx context.Context) error
}

type EventMetricStore interface {
	// Generic produce/consume with explicit parameters per semantic conventions
	Produce(ctx context.Context, event MessagingEvent)
	Consume(ctx context.Context, event MessagingEvent)

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

func (e *EventMetrics) Produce(ctx context.Context, event MessagingEvent) {
	attrs := []attribute.KeyValue{
		otel.MessagingOperationName.String(event.OperationName),
		otel.MessagingSystem.String(event.MessagingSystem),
	}
	if event.ErrorType != "" {
		attrs = append(attrs, otel.MessagingErrorType.String(event.ErrorType))
	}
	if event.DestinationName != "" {
		attrs = append(attrs, otel.MessagingDestinationName.String(event.DestinationName))
	}
	opt := e.withAttrs(attrs...)
	e.otlpMetrics.Produce(ctx, opt)
	e.promMetrics.Produce(ctx, opt)
}

func (e *EventMetrics) Consume(ctx context.Context, event MessagingEvent) {
	attrs := []attribute.KeyValue{
		otel.MessagingOperationName.String(event.OperationName),
		otel.MessagingSystem.String(event.MessagingSystem),
	}
	if event.ErrorType != "" {
		attrs = append(attrs, otel.MessagingErrorType.String(event.ErrorType))
	}
	if event.DestinationName != "" {
		attrs = append(attrs, otel.MessagingDestinationName.String(event.DestinationName))
	}
	opt := e.withAttrs(attrs...)
	e.otlpMetrics.Consume(ctx, opt)
	e.promMetrics.Consume(ctx, opt)
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

	return err
}
