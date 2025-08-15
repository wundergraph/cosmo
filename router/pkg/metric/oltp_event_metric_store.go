package metric

import (
	"context"

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

func newOtlpEventMetrics(logger *zap.Logger, meterProvider *metric.MeterProvider) (*otlpEventMetrics, error) {
	meter := meterProvider.Meter(
		cosmoRouterEventMeterName,
		otelmetric.WithInstrumentationVersion(cosmoRouterEventMeterVersion),
	)

	instruments, err := newEventInstruments(meter)
	if err != nil {
		return nil, err
	}

	return &otlpEventMetrics{
		instruments:   instruments,
		meterProvider: meterProvider,
		logger:        logger,
		meter:         meter,
	}, nil
}

// Unified methods
func (o *otlpEventMetrics) Publish(ctx context.Context, opts ...otelmetric.AddOption) {
	o.instruments.publishMessages.Add(ctx, 1, opts...)
}

func (o *otlpEventMetrics) PublishFailure(ctx context.Context, opts ...otelmetric.AddOption) {
	o.instruments.publishFailures.Add(ctx, 1, opts...)
}

func (o *otlpEventMetrics) MessagesReceived(ctx context.Context, opts ...otelmetric.AddOption) {
	o.instruments.messagesReceived.Add(ctx, 1, opts...)
}

// Keep NATS request methods
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
