package metric

import (
	"fmt"
	otelmetric "go.opentelemetry.io/otel/metric"
)

// Connection metric constants
const (
	maxConnections    = "router.http.client.connection.total"
	connectionsActive = "router.http.client.connection.active"

	totalConnectionDuration   = "router.http.client.connection.total_duration"
	connectionAcquireDuration = "router.http.client.connection.acquire_duration"
)

var (
	maxConnectionOptions = []otelmetric.Int64GaugeOption{
		otelmetric.WithDescription("Total number of max connections per host"),
	}

	totalConnectionDurationOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("s"),
		otelmetric.WithDescription("Total connection duration"),
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
	totalConnectionDuration   otelmetric.Float64Histogram
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

	totalConnectionDurationHistogram, err := meter.Float64Histogram(
		totalConnectionDuration,
		totalConnectionDurationOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create total connection duration histogram: %w", err)
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
		totalConnectionDuration:   totalConnectionDurationHistogram,
		connectionAcquireDuration: acquireDurationHistogram,
		connectionsActive:         connectionsActiveGauge,
	}, nil
}
