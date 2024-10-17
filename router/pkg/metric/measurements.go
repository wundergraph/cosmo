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

	return h, nil
}
