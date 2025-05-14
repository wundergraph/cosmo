package metric

import (
	"fmt"

	otelmetric "go.opentelemetry.io/otel/metric"
)

// Connection metric constants
const (
	// Counters
	connectionNewTotal     = "router.connection.new_total"     // Total number of new connections
	connectionReuseTotal   = "router.connection.reuse_total"   // Total number of reused connections
	connectionRetriesTotal = "router.connection.retries_total" // Total number of connection retries

	// Histograms
	dnsDuration               = "router.connection.dns_duration_ms"           // DNS resolution duration in milliseconds
	dialDuration              = "router.connection.dial_duration_ms"          // TCP dial duration in milliseconds
	tlsHandshakeDuration      = "router.connection.tls_handshake_duration_ms" // TLS handshake duration in milliseconds
	totalConnectionDuration   = "router.connection.total_duration_ms"         // Total connection duration in milliseconds
	connectionAcquireDuration = "router.connection.acquire_duration_ms"       // Connection acquire duration in milliseconds
)

var (
	// Counter options
	connectionNewTotalOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Total number of new connections"),
	}

	connectionReuseTotalOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Total number of reused connections"),
	}

	connectionRetriesTotalOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Total number of connection retries"),
	}

	// Histogram options
	dnsDurationOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("ms"),
		otelmetric.WithDescription("DNS resolution duration in milliseconds"),
	}

	dialDurationOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("ms"),
		otelmetric.WithDescription("TCP dial duration in milliseconds"),
	}

	tlsHandshakeDurationOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("ms"),
		otelmetric.WithDescription("TLS handshake duration in milliseconds"),
	}

	totalConnectionDurationOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("ms"),
		otelmetric.WithDescription("Total connection duration in milliseconds"),
	}

	connectionAcquireDurationOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("ms"),
		otelmetric.WithDescription("Connection acquire duration in milliseconds"),
	}
)

type connectionInstruments struct {
	// Counters
	connectionNewTotal     otelmetric.Int64Counter
	connectionReuseTotal   otelmetric.Int64Counter
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
	newTotalCounter, err := meter.Int64Counter(
		connectionNewTotal,
		connectionNewTotalOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection new total counter: %w", err)
	}

	reuseTotalCounter, err := meter.Int64Counter(
		connectionReuseTotal,
		connectionReuseTotalOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection reuse total counter: %w", err)
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
		connectionNewTotal:        newTotalCounter,
		connectionReuseTotal:      reuseTotalCounter,
		connectionRetriesTotal:    connectionRetriesTotalCounter,
		dnsDuration:               dnsDurationHistogram,
		dialDuration:              dialDurationHistogram,
		tlsHandshakeDuration:      tlsHandshakeDurationHistogram,
		totalConnectionDuration:   totalConnectionDurationHistogram,
		connectionAcquireDuration: acquireDurationHistogram,
	}, nil
}
