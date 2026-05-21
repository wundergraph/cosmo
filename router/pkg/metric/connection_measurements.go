package metric

import (
	"fmt"

	otelmetric "go.opentelemetry.io/otel/metric"
)

// Connection metric constants
const (
	maxConnections            = "router.http.client.max_connections"
	connectionsActive         = "router.http.client.active_connections"
	connectionAcquireDuration = "router.http.client.connection.acquire_duration"

	dnsLookupDuration    = "router.http.client.dns_lookup_duration"
	tcpConnectDuration   = "router.http.client.tcp_connect_duration"
	tlsHandshakeDuration = "router.http.client.tls_handshake_duration"
	timeToFirstByte      = "router.http.client.time_to_first_byte"
)

var (
	maxConnectionOptions = []otelmetric.Int64GaugeOption{
		otelmetric.WithDescription("Total number of max connections per subgraph"),
	}

	connectionAcquireDurationOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("ms"),
		otelmetric.WithDescription("Total connection acquire duration"),
	}

	connectionsActiveOptions = []otelmetric.Int64ObservableGaugeOption{
		otelmetric.WithDescription("Connections active"),
	}

	dnsLookupDurationOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("ms"),
		otelmetric.WithDescription("DNS lookup duration for outgoing subgraph requests"),
	}

	tcpConnectDurationOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("ms"),
		otelmetric.WithDescription("TCP connect duration for outgoing subgraph requests"),
	}

	tlsHandshakeDurationOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("ms"),
		otelmetric.WithDescription("TLS handshake duration for outgoing subgraph requests"),
	}

	timeToFirstByteOptions = []otelmetric.Float64HistogramOption{
		otelmetric.WithUnit("ms"),
		otelmetric.WithDescription("Time from request write completion to first response byte from subgraph"),
	}
)

type connectionInstruments struct {
	maxConnections            otelmetric.Int64Gauge
	connectionAcquireDuration otelmetric.Float64Histogram
	connectionsActive         otelmetric.Int64ObservableGauge

	// Per-request httptrace phase histograms — only created when enhancedConnectionStats is true.
	dnsLookupDuration    otelmetric.Float64Histogram
	tcpConnectDuration   otelmetric.Float64Histogram
	tlsHandshakeDuration otelmetric.Float64Histogram
	timeToFirstByte      otelmetric.Float64Histogram
}

func newConnectionInstruments(meter otelmetric.Meter, enhancedConnectionStats bool) (*connectionInstruments, error) {
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

	ci := &connectionInstruments{
		maxConnections:            maxConnectionsGauge,
		connectionAcquireDuration: acquireDurationHistogram,
		connectionsActive:         connectionsActiveGauge,
	}

	if !enhancedConnectionStats {
		return ci, nil
	}

	if ci.dnsLookupDuration, err = meter.Float64Histogram(dnsLookupDuration, dnsLookupDurationOptions...); err != nil {
		return nil, fmt.Errorf("failed to create dns lookup duration histogram: %w", err)
	}
	if ci.tcpConnectDuration, err = meter.Float64Histogram(tcpConnectDuration, tcpConnectDurationOptions...); err != nil {
		return nil, fmt.Errorf("failed to create tcp connect duration histogram: %w", err)
	}
	if ci.tlsHandshakeDuration, err = meter.Float64Histogram(tlsHandshakeDuration, tlsHandshakeDurationOptions...); err != nil {
		return nil, fmt.Errorf("failed to create tls handshake duration histogram: %w", err)
	}
	if ci.timeToFirstByte, err = meter.Float64Histogram(timeToFirstByte, timeToFirstByteOptions...); err != nil {
		return nil, fmt.Errorf("failed to create time to first byte histogram: %w", err)
	}

	return ci, nil
}
