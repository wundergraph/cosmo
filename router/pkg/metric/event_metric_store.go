package metric

import (
	"context"
	"errors"
	"fmt"

	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
)

// EventBackend represents supported backends
const (
	EventBackendKafka = "kafka"
	EventBackendRedis = "redis"
	EventBackendNats  = "nats"
)

// EventMetricProvider is the interface that wraps the basic Event metric methods.
// We maintain two providers, one for OTEL and one for Prometheus.
type EventMetricProvider interface {
	Publish(ctx context.Context, backend string, count int64, opts ...otelmetric.AddOption)
	PublishFailure(ctx context.Context, backend string, count int64, opts ...otelmetric.AddOption)
	MessageReceived(ctx context.Context, backend string, count int64, opts ...otelmetric.AddOption)
	Flush(ctx context.Context) error
	Shutdown() error
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
		otlpMetrics, err := newOtlpEventMetrics(logger, otelProvider, baseAttributes)
		if err != nil {
			return nil, fmt.Errorf("failed to create otlp event metrics: %w", err)
		}
		store.otlpMetrics = otlpMetrics
	}

	if metricsConfig.Prometheus.EventMetrics {
		promMetrics, err := newPromEventMetrics(logger, promProvider, baseAttributes)
		if err != nil {
			return nil, fmt.Errorf("failed to create prometheus event metrics: %w", err)
		}
		store.promMetrics = promMetrics
	}

	return store, nil
}

func (e *EventMetrics) Publish(ctx context.Context, backend string, count int64, attrs ...attribute.KeyValue) {
	copied := append([]attribute.KeyValue{}, e.baseAttributes...)
	opts := otelmetric.WithAttributes(append(copied, attrs...)...)
	e.otlpMetrics.Publish(ctx, backend, count, opts)
	e.promMetrics.Publish(ctx, backend, count, opts)
}

func (e *EventMetrics) PublishFailure(ctx context.Context, backend string, count int64, attrs ...attribute.KeyValue) {
	copied := append([]attribute.KeyValue{}, e.baseAttributes...)
	opts := otelmetric.WithAttributes(append(copied, attrs...)...)
	e.otlpMetrics.PublishFailure(ctx, backend, count, opts)
	e.promMetrics.PublishFailure(ctx, backend, count, opts)
}

func (e *EventMetrics) MessageReceived(ctx context.Context, backend string, count int64, attrs ...attribute.KeyValue) {
	copied := append([]attribute.KeyValue{}, e.baseAttributes...)
	opts := otelmetric.WithAttributes(append(copied, attrs...)...)
	e.otlpMetrics.MessageReceived(ctx, backend, count, opts)
	e.promMetrics.MessageReceived(ctx, backend, count, opts)
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
