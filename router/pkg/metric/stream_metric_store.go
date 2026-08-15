package metric

import (
	"context"
	"fmt"
	"time"

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

// StreamsEvent carries the values for stream metrics attributes.
type StreamsEvent struct {
	ProviderId          string       // The id of the provider defined in the configuration
	StreamOperationName string       // The stream operation name that is specific to the messaging system
	ProviderType        ProviderType // The messaging system type that are supported
	ErrorType           string       // Optional error type, e.g., "publish_error" or "receive_error". If empty, the attribute is not set
	DestinationName     string       // The name of the destination queue / topic / channel
	RootFieldName       string       // The GraphQL subscription root field
}

// StreamMetricProvider is the interface that wraps the basic Event metric methods.
type StreamMetricProvider interface {
	Produce(ctx context.Context, opts ...otelmetric.AddOption)
	Consume(ctx context.Context, opts ...otelmetric.AddOption)
	Process(ctx context.Context, opts ...otelmetric.AddOption)
	DispatchInFlight(ctx context.Context, delta int64, opts ...otelmetric.AddOption)
	DispatchDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption)
}

type StreamMetricStore interface {
	Produce(ctx context.Context, event StreamsEvent)
	Consume(ctx context.Context, event StreamsEvent)
	DispatchStart(ctx context.Context, event StreamsEvent)
	DispatchFinish(ctx context.Context, event StreamsEvent, duration time.Duration)
}

// StreamMetrics is the store for Event (Kafka/Redis/NATS) metrics.
type StreamMetrics struct {
	baseAttributes []attribute.KeyValue
	logger         *zap.Logger
	providers      []StreamMetricProvider
}

func NewStreamMetricStore(logger *zap.Logger, baseAttributes []attribute.KeyValue, otelProvider, promProvider *metric.MeterProvider, metricsConfig *Config) (*StreamMetrics, error) {
	providers := make([]StreamMetricProvider, 0)

	if metricsConfig.OpenTelemetry.Streams {
		otlpMetrics, err := newOtlpStreamEventMetrics(logger, otelProvider)
		if err != nil {
			return nil, fmt.Errorf("failed to create otlp stream event metrics: %w", err)
		}
		providers = append(providers, otlpMetrics)
	}

	if metricsConfig.Prometheus.Streams {
		promMetrics, err := newPromStreamEventMetrics(logger, promProvider)
		if err != nil {
			return nil, fmt.Errorf("failed to create prometheus stream event metrics: %w", err)
		}
		providers = append(providers, promMetrics)
	}

	store := &StreamMetrics{
		baseAttributes: baseAttributes,
		logger:         logger,
		providers:      providers,
	}
	return store, nil
}

func (e *StreamMetrics) withAttrs(attrs ...attribute.KeyValue) otelmetric.AddOption {
	copied := append([]attribute.KeyValue{}, e.baseAttributes...)
	return otelmetric.WithAttributes(append(copied, attrs...)...)
}

func (e *StreamMetrics) Produce(ctx context.Context, event StreamsEvent) {
	attrs := []attribute.KeyValue{
		otel.WgStreamOperationName.String(event.StreamOperationName),
		otel.WgProviderType.String(string(event.ProviderType)),
	}
	if event.ErrorType != "" {
		attrs = append(attrs, otel.WgErrorType.String(event.ErrorType))
	}
	if event.ProviderId != "" {
		attrs = append(attrs, otel.WgProviderId.String(event.ProviderId))
	}
	if event.DestinationName != "" {
		attrs = append(attrs, otel.WgDestinationName.String(event.DestinationName))
	}
	opt := e.withAttrs(attrs...)

	for _, provider := range e.providers {
		provider.Produce(ctx, opt)
	}
}

func (e *StreamMetrics) Consume(ctx context.Context, event StreamsEvent) {
	e.recordAdd(ctx, event, func(provider StreamMetricProvider, ctx context.Context, opt otelmetric.AddOption) {
		provider.Consume(ctx, opt)
	})
}

func (e *StreamMetrics) DispatchStart(ctx context.Context, event StreamsEvent) {
	e.recordAdd(ctx, event, func(provider StreamMetricProvider, ctx context.Context, opt otelmetric.AddOption) {
		provider.DispatchInFlight(ctx, 1, opt)
	})
}

func (e *StreamMetrics) DispatchFinish(ctx context.Context, event StreamsEvent, duration time.Duration) {
	attrs := e.eventAttrs(event)
	addOpt := e.withAttrs(attrs...)
	recordOpt := otelmetric.WithAttributes(append(append([]attribute.KeyValue{}, e.baseAttributes...), attrs...)...)
	for _, provider := range e.providers {
		provider.DispatchInFlight(ctx, -1, addOpt)
		provider.Process(ctx, addOpt)
		provider.DispatchDuration(ctx, float64(duration)/float64(time.Millisecond), recordOpt)
	}
}

func (e *StreamMetrics) recordAdd(ctx context.Context, event StreamsEvent, record func(StreamMetricProvider, context.Context, otelmetric.AddOption)) {
	opt := e.withAttrs(e.eventAttrs(event)...)
	for _, provider := range e.providers {
		record(provider, ctx, opt)
	}
}

func (e *StreamMetrics) eventAttrs(event StreamsEvent) []attribute.KeyValue {
	attrs := []attribute.KeyValue{
		otel.WgStreamOperationName.String(event.StreamOperationName),
		otel.WgProviderType.String(string(event.ProviderType)),
	}
	if event.ErrorType != "" {
		attrs = append(attrs, otel.WgErrorType.String(event.ErrorType))
	}
	if event.ProviderId != "" {
		attrs = append(attrs, otel.WgProviderId.String(event.ProviderId))
	}
	if event.DestinationName != "" {
		attrs = append(attrs, otel.WgDestinationName.String(event.DestinationName))
	}
	if event.RootFieldName != "" {
		attrs = append(attrs, otel.WgGraphQLFieldName.String(event.RootFieldName))
	}
	return attrs
}
