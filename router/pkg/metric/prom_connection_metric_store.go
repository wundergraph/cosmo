package metric

import (
	"context"
	"fmt"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
)

const (
	cosmoRouterConnectionPrometheusMeterName    = "cosmo.router.connection.prometheus"
	cosmoRouterConnectionPrometheusMeterVersion = "0.0.1"
)

type promConnectionMetrics struct {
	instruments   *connectionInstruments
	meterProvider *metric.MeterProvider
	logger        *zap.Logger
}

func newPromConnectionMetrics(logger *zap.Logger, meterProvider *metric.MeterProvider) (*promConnectionMetrics, error) {
	meter := meterProvider.Meter(cosmoRouterConnectionPrometheusMeterName,
		otelmetric.WithInstrumentationVersion(cosmoRouterConnectionPrometheusMeterVersion),
	)

	instruments, err := newConnectionInstruments(meter)
	if err != nil {
		return nil, fmt.Errorf("failed to create prometheus connection instruments: %w", err)
	}

	return &promConnectionMetrics{
		instruments:   instruments,
		meterProvider: meterProvider,
		logger:        logger,
	}, nil
}

func (m *promConnectionMetrics) MeasureDNSDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.dnsDuration.Record(ctx, duration, opts...)
}

func (m *promConnectionMetrics) MeasureDialDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.dialDuration.Record(ctx, duration, opts...)
}

func (m *promConnectionMetrics) MeasureTLSHandshakeDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.tlsHandshakeDuration.Record(ctx, duration, opts...)
}

func (m *promConnectionMetrics) MeasureTotalConnectionDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.totalConnectionDuration.Record(ctx, duration, opts...)
}

func (m *promConnectionMetrics) MeasureConnectionAcquireDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.connectionAcquireDuration.Record(ctx, duration, opts...)
}

func (m *promConnectionMetrics) MeasureNewConnections(ctx context.Context, count int64, opts ...otelmetric.AddOption) {
	m.instruments.connectionNewTotal.Add(ctx, count, opts...)
}

func (m *promConnectionMetrics) MeasureReusedConnections(ctx context.Context, count int64, opts ...otelmetric.AddOption) {
	m.instruments.connectionReuseTotal.Add(ctx, count, opts...)
}

func (m *promConnectionMetrics) Flush(ctx context.Context) error {
	return nil
}
