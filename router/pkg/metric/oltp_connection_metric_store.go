package metric

import (
	"context"
	"errors"
	"fmt"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"

	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
)

const (
	cosmoRouterConnectionMeterName    = "cosmo.router.connection"
	cosmoRouterConnectionMeterVersion = "0.0.1"
)

type otlpConnectionMetrics struct {
	instruments             *connectionInstruments
	meterProvider           *metric.MeterProvider
	logger                  *zap.Logger
	meter                   otelmetric.Meter
	instrumentRegistrations []otelmetric.Registration
}

func newOtlpConnectionMetrics(logger *zap.Logger, meterProvider *metric.MeterProvider, stats *ConnectionPoolStats, baseAttributes []attribute.KeyValue) (*otlpConnectionMetrics, error) {
	meter := meterProvider.Meter(
		cosmoRouterConnectionMeterName,
		otelmetric.WithInstrumentationVersion(cosmoRouterConnectionMeterVersion),
	)

	instruments, err := newConnectionInstruments(meter)
	if err != nil {
		return nil, fmt.Errorf("failed to create otlp connection instruments: %w", err)
	}

	metrics := &otlpConnectionMetrics{
		instruments:   instruments,
		meterProvider: meterProvider,
		logger:        logger,
		meter:         meter,
	}

	metrics.startInitMetrics(stats, baseAttributes)
	return metrics, nil
}

func (h *otlpConnectionMetrics) startInitMetrics(connStats *ConnectionPoolStats, attributes []attribute.KeyValue) error {
	rc, err := h.meter.RegisterCallback(func(_ context.Context, o otelmetric.Observer) error {
		stats := connStats.GetStats()
		for host, activeConnections := range stats {
			o.ObserveInt64(h.instruments.connectionsActive, activeConnections,
				otelmetric.WithAttributes(attributes...),
				otelmetric.WithAttributes(otel.WgHost.String(host)),
			)
		}
		return nil
	}, h.instruments.connectionsActive)
	if err != nil {
		return err
	}

	h.instrumentRegistrations = append(h.instrumentRegistrations, rc)
	return nil
}

func (h *otlpConnectionMetrics) MeasureDNSDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	h.instruments.dnsDuration.Record(ctx, duration, opts...)
}

func (h *otlpConnectionMetrics) MeasureDialDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	h.instruments.dialDuration.Record(ctx, duration, opts...)
}

func (h *otlpConnectionMetrics) MeasureTLSHandshakeDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	h.instruments.tlsHandshakeDuration.Record(ctx, duration, opts...)
}

func (h *otlpConnectionMetrics) MeasureTotalConnectionDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	h.instruments.totalConnectionDuration.Record(ctx, duration, opts...)
}

func (h *otlpConnectionMetrics) MeasureConnectionAcquireDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	h.instruments.connectionAcquireDuration.Record(ctx, duration, opts...)
}

func (h *otlpConnectionMetrics) MeasureConnections(ctx context.Context, count int64, opts ...otelmetric.AddOption) {
	h.instruments.connectionTotal.Add(ctx, count, opts...)
}

func (h *otlpConnectionMetrics) Flush(ctx context.Context) error {
	return h.meterProvider.ForceFlush(ctx)
}

func (h *otlpConnectionMetrics) Shutdown() error {
	var err error

	for _, reg := range h.instrumentRegistrations {
		if regErr := reg.Unregister(); regErr != nil {
			err = errors.Join(regErr)
		}
	}

	return err
}
