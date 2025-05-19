package metric

import (
	"fmt"
	otelmetric "go.opentelemetry.io/otel/metric"
)

// Connection metric constants
const (
	maxConnections            = "router.http.client.connection.max"
	connectionsActive         = "router.http.client.connection.active"
	connectionAcquireDuration = "router.http.client.connection.acquire_duration"
)

var (
	maxConnectionOptions = []otelmetric.Int64GaugeOption{
		otelmetric.WithDescription("Total number of max connections per host"),
	}

	connectionAcquireDurationOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("s"),
		otelmetric.WithDescription("Connection acquire duration"),
	}

	connectionsActiveOptions = []otelmetric.Int64ObservableGaugeOption{
		otelmetric.WithDescription("Connections active"),
	}
)

type connectionInstruments struct {
	maxConnections            otelmetric.Int64Gauge
	connectionAcquireDuration otelmetric.Float64Histogram
	connectionsActive         otelmetric.Int64ObservableGauge
}

func newConnectionInstruments(meter otelmetric.Meter) (*connectionInstruments, error) {
	maxConnectionsGauge, err := meter.Int64Gauge(
		maxConnections,
		maxConnectionOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection total counter: %w", err)
	}

	acquireDurationHistogram, err := meter.Float64Histogram(
		connectionAcquireDuration,
		connectionAcquireDurationOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection acquire duration histogram: %w", err)
	}

	connectionsActiveGauge, err := meter.Int64ObservableGauge(
		connectionsActive,
		connectionsActiveOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create connections available: %w", err)
	}

	return &connectionInstruments{
		maxConnections:            maxConnectionsGauge,
		connectionAcquireDuration: acquireDurationHistogram,
		connectionsActive:         connectionsActiveGauge,
	}, nil
}
