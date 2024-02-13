package metric

import (
	"fmt"
	otelmetric "go.opentelemetry.io/otel/metric"
)

// RequestMeasurements holds the metrics for the request.
type RequestMeasurements struct {
	counters       map[string]otelmetric.Int64Counter
	histograms     map[string]otelmetric.Float64Histogram
	upDownCounters map[string]otelmetric.Int64UpDownCounter
}

// createRequestMeasures creates the request measures. Used to create measures for both Prometheus and OTLP metric stores.
func createRequestMeasures(meter otelmetric.Meter) (*RequestMeasurements, error) {

	h := &RequestMeasurements{
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

	return h, nil
}
