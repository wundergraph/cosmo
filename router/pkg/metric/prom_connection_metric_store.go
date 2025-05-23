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
	cosmoRouterConnectionPrometheusMeterName    = "cosmo.router.connections.prometheus"
	cosmoRouterConnectionPrometheusMeterVersion = "0.0.1"
)

type promConnectionMetrics struct {
	instruments             *connectionInstruments
	meterProvider           *metric.MeterProvider
	logger                  *zap.Logger
	meter                   otelmetric.Meter
	instrumentRegistrations []otelmetric.Registration
}

func newPromConnectionMetrics(logger *zap.Logger, meterProvider *metric.MeterProvider, stats *ConnectionPoolStats, attributes []attribute.KeyValue) (*promConnectionMetrics, error) {
	meter := meterProvider.Meter(
		cosmoRouterConnectionPrometheusMeterName,
		otelmetric.WithInstrumentationVersion(cosmoRouterConnectionPrometheusMeterVersion),
	)

	instruments, err := newConnectionInstruments(meter)
	if err != nil {
		return nil, fmt.Errorf("failed to create prometheus connection instruments: %w", err)
	}

	metrics := &promConnectionMetrics{
		instruments:   instruments,
		meterProvider: meterProvider,
		meter:         meter,
		logger:        logger,
	}

	metrics.startInitMetrics(stats, attributes)
	return metrics, nil
}

func (h *promConnectionMetrics) startInitMetrics(connStats *ConnectionPoolStats, attributes []attribute.KeyValue) error {
	for subgraph, maxConns := range connStats.MaxConnsPerSubgraph {
		attrs := make([]attribute.KeyValue, 0, 1)
		if subgraph != "" {
			attrs = append(attrs, otel.WgSubgraphName.String(subgraph))
		}
		h.MeasureMaxConnections(context.Background(), maxConns, otelmetric.WithAttributes(attrs...))
	}

	rc, err := h.meter.RegisterCallback(func(_ context.Context, o otelmetric.Observer) error {
		stats := connStats.GetStats()
		for key, activeConnections := range stats {
			attrs := otel.GetServerAttributes(key.Host)
			if key.Subgraph != "" {
				attrs = append(attrs, otel.WgSubgraphName.String(key.Subgraph))
			}
			o.ObserveInt64(h.instruments.connectionsActive, activeConnections,
				otelmetric.WithAttributes(attributes...),
				otelmetric.WithAttributes(attrs...),
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

func (m *promConnectionMetrics) MeasureConnectionAcquireDuration(ctx context.Context, duration float64, opts ...otelmetric.RecordOption) {
	m.instruments.connectionAcquireDuration.Record(ctx, duration, opts...)
}

func (m *promConnectionMetrics) MeasureMaxConnections(ctx context.Context, count int64, opts ...otelmetric.RecordOption) {
	m.instruments.maxConnections.Record(ctx, count, opts...)
}

func (m *promConnectionMetrics) Flush(ctx context.Context) error {
	return m.meterProvider.ForceFlush(ctx)
}

func (h *promConnectionMetrics) Shutdown() error {
	var err error

	for _, reg := range h.instrumentRegistrations {
		if regErr := reg.Unregister(); regErr != nil {
			err = errors.Join(regErr)
		}
	}

	return err
}
