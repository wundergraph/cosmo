package observability

import (
	"context"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

const meterName = "wundergraph.cosmo.router.mcp.code_mode"

type Meter struct {
	executionsCounter metric.Int64Counter
	durationHistogram metric.Float64Histogram
}

func NewMeter(meterProvider metric.MeterProvider) (*Meter, error) {
	if meterProvider == nil {
		meterProvider = otel.GetMeterProvider()
	}
	meter := meterProvider.Meter(meterName)

	executionsCounter, err := meter.Int64Counter(
		"mcp.code_mode.sandbox.executions",
		metric.WithDescription("Code Mode sandbox executions."),
	)
	if err != nil {
		return nil, err
	}
	durationHistogram, err := meter.Float64Histogram(
		"mcp.code_mode.sandbox.duration",
		metric.WithDescription("Code Mode sandbox execution duration."),
		metric.WithUnit("ms"),
	)
	if err != nil {
		return nil, err
	}

	return &Meter{
		executionsCounter: executionsCounter,
		durationHistogram: durationHistogram,
	}, nil
}

func (m *Meter) Record(ctx context.Context, toolName, status string, durationMs float64) {
	if m == nil {
		return
	}
	attrs := metric.WithAttributes(
		attribute.String("mcp.tool", toolName),
		attribute.String("mcp.status", status),
	)
	m.executionsCounter.Add(ctx, 1, attrs)
	m.durationHistogram.Record(ctx, durationMs, attrs)
}
