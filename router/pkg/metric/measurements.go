package metric

import (
	"fmt"

	otelmetric "go.opentelemetry.io/otel/metric"
)

// Measurements holds the metrics for the request.
type Measurements struct {
	counters       map[string]otelmetric.Int64Counter
	histograms     map[string]otelmetric.Float64Histogram
	upDownCounters map[string]otelmetric.Int64UpDownCounter
}

// Connection and pool metric keys
const (
	DNSDurationKey             = "router.http_client.dns_duration_seconds"
	TCPDialDurationKey         = "router.http_client.tcp_dial_duration_seconds"
	TLSHandshakeDurationKey    = "router.http_client.tls_handshake_duration_seconds"
	TotalConnectionDurationKey = "router.http_client.total_connection_duration_seconds"

	PoolWaitCountTotalKey    = "router.http_client.connection_pool_wait_count_total"
	PoolWaitDurationKey      = "router.http_client.connection_pool_wait_duration_seconds"
	ConnectionNewTotalKey    = "router.http_client.connection_new_total"
	ConnectionReuseTotalKey  = "router.http_client.connection_reuse_total"
	PoolActiveConnectionsKey = "router.http_client.connection_pool_active_connections"
	PoolIdleConnectionsKey   = "router.http_client.connection_pool_idle_connections"
)

// createMeasures creates the measures. Used to create measures for both Prometheus and OTLP metric stores.
func createMeasures(meter otelmetric.Meter) (*Measurements, error) {

	h := &Measurements{
		counters:       map[string]otelmetric.Int64Counter{},
		histograms:     map[string]otelmetric.Float64Histogram{},
		upDownCounters: map[string]otelmetric.Int64UpDownCounter{},
	}

	requestCounter, err := meter.Int64Counter(
		RequestCounter,
		RequestCounterOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create request counter: %w", err)
	}

	h.counters[RequestCounter] = requestCounter

	requestError, err := meter.Int64Counter(
		RequestError,
		RequestErrorCounterOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create request error counter: %w", err)
	}

	h.counters[RequestError] = requestError

	serverLatencyMeasure, err := meter.Float64Histogram(
		ServerLatencyHistogram,
		ServerLatencyHistogramOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create server latency measure: %w", err)
	}

	h.histograms[ServerLatencyHistogram] = serverLatencyMeasure

	requestContentLengthCounter, err := meter.Int64Counter(
		RequestContentLengthCounter,
		RequestContentLengthCounterOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create request content length counter: %w", err)
	}

	h.counters[RequestContentLengthCounter] = requestContentLengthCounter

	responseContentLengthCounter, err := meter.Int64Counter(
		ResponseContentLengthCounter,
		ResponseContentLengthCounterOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create response content length counter: %w", err)
	}

	h.counters[ResponseContentLengthCounter] = responseContentLengthCounter

	inFlightRequestsGauge, err := meter.Int64UpDownCounter(
		InFlightRequestsUpDownCounter,
		InFlightRequestsUpDownCounterOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create in flight requests gauge: %w", err)
	}

	h.upDownCounters[InFlightRequestsUpDownCounter] = inFlightRequestsGauge

	operationPlanningTime, err := meter.Float64Histogram(
		OperationPlanningTime,
		OperationPlanningTimeHistogramOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create operation planning time measure: %w", err)
	}

	h.histograms[OperationPlanningTime] = operationPlanningTime

	schemaFieldUsage, err := meter.Int64Counter(
		SchemaFieldUsageCounter,
		SchemaFieldUsageCounterOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create schema usage counter: %w", err)
	}

	h.counters[SchemaFieldUsageCounter] = schemaFieldUsage

	// Add connection and pool metrics
	dnsDuration, err := meter.Float64Histogram(DNSDurationKey)
	if err != nil {
		return nil, err
	}
	h.histograms[DNSDurationKey] = dnsDuration

	tcpDialDuration, err := meter.Float64Histogram(TCPDialDurationKey)
	if err != nil {
		return nil, err
	}
	h.histograms[TCPDialDurationKey] = tcpDialDuration

	tlsHandshakeDuration, err := meter.Float64Histogram(TLSHandshakeDurationKey)
	if err != nil {
		return nil, err
	}
	h.histograms[TLSHandshakeDurationKey] = tlsHandshakeDuration

	totalConnectionDuration, err := meter.Float64Histogram(TotalConnectionDurationKey)
	if err != nil {
		return nil, err
	}
	h.histograms[TotalConnectionDurationKey] = totalConnectionDuration

	poolWaitCountTotal, err := meter.Int64Counter(PoolWaitCountTotalKey)
	if err != nil {
		return nil, err
	}
	h.counters[PoolWaitCountTotalKey] = poolWaitCountTotal

	poolWaitDuration, err := meter.Float64Histogram(PoolWaitDurationKey)
	if err != nil {
		return nil, err
	}
	h.histograms[PoolWaitDurationKey] = poolWaitDuration

	connectionNewTotal, err := meter.Int64Counter(ConnectionNewTotalKey)
	if err != nil {
		return nil, err
	}
	h.counters[ConnectionNewTotalKey] = connectionNewTotal

	connectionReuseTotal, err := meter.Int64Counter(ConnectionReuseTotalKey)
	if err != nil {
		return nil, err
	}
	h.counters[ConnectionReuseTotalKey] = connectionReuseTotal

	poolActiveConnections, err := meter.Int64UpDownCounter(PoolActiveConnectionsKey)
	if err != nil {
		return nil, err
	}
	h.upDownCounters[PoolActiveConnectionsKey] = poolActiveConnections

	poolIdleConnections, err := meter.Int64UpDownCounter(PoolIdleConnectionsKey)
	if err != nil {
		return nil, err
	}
	h.upDownCounters[PoolIdleConnectionsKey] = poolIdleConnections

	return h, nil
}
