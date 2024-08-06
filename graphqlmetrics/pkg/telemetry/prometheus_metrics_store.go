package telemetry

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	"go.uber.org/zap"

	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
)

const (
	graphqlmetricsMeterName    = "cosmo.graphqlmetrics.prometheus"
	graphqlmetricsMeterVersion = "0.0.1"
)

type PromMetricStore struct {
	meter          otelmetric.Meter
	baseAttributes []attribute.KeyValue
	meterProvider  *metric.MeterProvider
	logger         *zap.Logger

	measurements *CustomMetrics
}

type Provider interface {
	MeasureRequestCount(ctx context.Context, attr ...attribute.KeyValue)
}

func NewPromMetricStore(logger *zap.Logger, meterProvider *metric.MeterProvider, baseAttributes []attribute.KeyValue) (Provider, error) {
	meter := meterProvider.Meter(
		graphqlmetricsMeterName,
		otelmetric.WithInstrumentationVersion(graphqlmetricsMeterVersion),
	)

	m := &PromMetricStore{
		meter:          meter,
		baseAttributes: baseAttributes,
		logger:         logger,
		meterProvider:  meterProvider,
	}

	measures, err := initializeCustomMetrics(meter)
	if err != nil {
		return nil, err
	}

	m.measurements = measures

	return m, nil
}

func initializeCustomMetrics(meter otelmetric.Meter) (*CustomMetrics, error) {
	counters := map[string]otelmetric.Int64Counter{}

	requestCount, err := meter.Int64Counter(
		RequestCount,
		otelmetric.WithDescription("Total number of requests"),
	)

	if err != nil {
		return nil, err
	}

	counters[RequestCount] = requestCount

	return &CustomMetrics{
		counters: counters,
	}, nil
}

func (h *PromMetricStore) MeasureRequestCount(ctx context.Context, attr ...attribute.KeyValue) {
	var baseKeys []attribute.KeyValue

	baseKeys = append(baseKeys, h.baseAttributes...)
	baseKeys = append(baseKeys, attr...)

	baseAttributes := otelmetric.WithAttributes(baseKeys...)

	if c, ok := h.measurements.counters[RequestCount]; ok {
		c.Add(ctx, 1, baseAttributes)
	}
}
