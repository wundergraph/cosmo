package metric

import (
	"fmt"

	otelmetric "go.opentelemetry.io/otel/metric"
)

// Connection metric constants
const (
	// Counters
	connectionTotal        = "router.connection.total"
	connectionRetriesTotal = "router.connection.retries_total"

	// Histograms
	dnsDuration               = "router.connection.dns_duration"
	dialDuration              = "router.connection.dial_duration"
	tlsHandshakeDuration      = "router.connection.tls_handshake_duration"
	totalConnectionDuration   = "router.connection.total_duration"
	connectionAcquireDuration = "router.connection.acquire_duration"
)

var (
	// Counter options
	connectionTotalOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Total number of connections with reused attribute"),
	}

	connectionRetriesTotalOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Total number of connection retries"),
	}

	// Histogram options
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
)

type connectionInstruments struct {
	// Counters
	connectionTotal        otelmetric.Int64Counter
	connectionRetriesTotal otelmetric.Int64Counter

	// Histograms
	dnsDuration               otelmetric.Float64Histogram
	dialDuration              otelmetric.Float64Histogram
	tlsHandshakeDuration      otelmetric.Float64Histogram
	totalConnectionDuration   otelmetric.Float64Histogram
	connectionAcquireDuration otelmetric.Float64Histogram
}

func newConnectionInstruments(meter otelmetric.Meter) (*connectionInstruments, error) {
	// Initialize counters
	connectionTotalCounter, err := meter.Int64Counter(
		connectionTotal,
		connectionTotalOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection total counter: %w", err)
	}

	connectionRetriesTotalCounter, err := meter.Int64Counter(
		connectionRetriesTotal,
		connectionRetriesTotalOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection retries total counter: %w", err)
	}

	// Initialize histograms
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

	return &connectionInstruments{
		connectionTotal:           connectionTotalCounter,
		connectionRetriesTotal:    connectionRetriesTotalCounter,
		dnsDuration:               dnsDurationHistogram,
		dialDuration:              dialDurationHistogram,
		tlsHandshakeDuration:      tlsHandshakeDurationHistogram,
		totalConnectionDuration:   totalConnectionDurationHistogram,
		connectionAcquireDuration: acquireDurationHistogram,
	}, nil
}
