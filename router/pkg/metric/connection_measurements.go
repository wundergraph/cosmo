package metric

import (
	"fmt"
	otelmetric "go.opentelemetry.io/otel/metric"
)

// Connection metric constants
const (
	connectionTotal   = "router.connection.total"
	connectionsActive = "router.connection.active"

	dnsDuration               = "router.connection.dns_duration"
	dialDuration              = "router.connection.dial_duration"
	tlsHandshakeDuration      = "router.connection.tls_handshake_duration"
	totalConnectionDuration   = "router.connection.total_duration"
	connectionAcquireDuration = "router.connection.acquire_duration"
)

var (
	connectionTotalOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Total number of connections with reused attribute"),
	}

	dnsDurationOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("s"),
		otelmetric.WithDescription("DNS resolution duration"),
	}

	dialDurationOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("s"),
		otelmetric.WithDescription("TCP dial duration"),
	}

	tlsHandshakeDurationOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("s"),
		otelmetric.WithDescription("TLS handshake duration"),
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
	connectionTotal otelmetric.Int64Counter

	dnsDuration               otelmetric.Float64Histogram
	dialDuration              otelmetric.Float64Histogram
	tlsHandshakeDuration      otelmetric.Float64Histogram
	totalConnectionDuration   otelmetric.Float64Histogram
	connectionAcquireDuration otelmetric.Float64Histogram

	connectionsActive otelmetric.Int64ObservableGauge
}

func newConnectionInstruments(meter otelmetric.Meter) (*connectionInstruments, error) {
	connectionTotalCounter, err := meter.Int64Counter(
		connectionTotal,
		connectionTotalOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection total counter: %w", err)
	}

	dnsDurationHistogram, err := meter.Float64Histogram(
		dnsDuration,
		dnsDurationOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create DNS duration histogram: %w", err)
	}

	dialDurationHistogram, err := meter.Float64Histogram(
		dialDuration,
		dialDurationOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create dial duration histogram: %w", err)
	}

	tlsHandshakeDurationHistogram, err := meter.Float64Histogram(
		tlsHandshakeDuration,
		tlsHandshakeDurationOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create TLS handshake duration histogram: %w", err)
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
		connectionTotal:           connectionTotalCounter,
		dnsDuration:               dnsDurationHistogram,
		dialDuration:              dialDurationHistogram,
		tlsHandshakeDuration:      tlsHandshakeDurationHistogram,
		totalConnectionDuration:   totalConnectionDurationHistogram,
		connectionAcquireDuration: acquireDurationHistogram,
		connectionsActive:         connectionsActiveGauge,
	}, nil
}
