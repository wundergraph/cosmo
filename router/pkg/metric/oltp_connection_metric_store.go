package metric

import (
	"context"
	"fmt"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
)

type otlpConnectionMetrics struct {
	instruments *connectionInstruments
	logger      *zap.Logger
}

func newOtlpConnectionMetrics(logger *zap.Logger, meterProvider *metric.MeterProvider) (*otlpConnectionMetrics, error) {
	instruments, err := newConnectionInstruments(meterProvider)
	if err != nil {
		return nil, fmt.Errorf("failed to create otlp connection instruments: %w", err)
	}

	return &otlpConnectionMetrics{
		instruments: instruments,
		logger:      logger,
	}, nil
}

func (m *otlpConnectionMetrics) MeasureDNSDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.dnsDuration.Record(ctx, duration, opts...)
}

func (m *otlpConnectionMetrics) MeasureDialDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.dialDuration.Record(ctx, duration, opts...)
}

func (m *otlpConnectionMetrics) MeasureTLSHandshakeDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.tlsHandshakeDuration.Record(ctx, duration, opts...)
}

func (m *otlpConnectionMetrics) MeasureTotalConnectionDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.totalConnectionDuration.Record(ctx, duration, opts...)
}

func (m *otlpConnectionMetrics) MeasureConnectionAcquireDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.connectionAcquireDuration.Record(ctx, duration, opts...)
}

func (m *otlpConnectionMetrics) MeasureNewConnections(ctx context.Context, count int64, opts ...otelmetric.AddOption) {
	m.instruments.connectionNewTotal.Add(ctx, count, opts...)
}

func (m *otlpConnectionMetrics) MeasureReusedConnections(ctx context.Context, count int64, opts ...otelmetric.AddOption) {
	m.instruments.connectionReuseTotal.Add(ctx, count, opts...)
}

func (m *otlpConnectionMetrics) Flush(ctx context.Context) error {
	return nil
}
