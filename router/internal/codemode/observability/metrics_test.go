package observability

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

func TestMeterRecordEmitsCounterAndDurationHistogram(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	meter, err := NewMeter(provider)
	require.NoError(t, err)

	meter.Record(context.Background(), "code_mode_run_js", "success", 12.5)

	var got metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &got))
	counter, histogram := codeModeMetrics(t, got)

	counterData, ok := counter.Data.(metricdata.Sum[int64])
	require.True(t, ok)
	require.Len(t, counterData.DataPoints, 1)
	counterPoint := counterData.DataPoints[0]
	counterPoint.StartTime = time.Time{}
	counterPoint.Time = time.Time{}
	assert.Equal(t, metricdata.DataPoint[int64]{
		Attributes: attribute.NewSet(
			attribute.String("mcp.tool", "code_mode_run_js"),
			attribute.String("mcp.status", "success"),
		),
		Value: 1,
	}, counterPoint)

	histogramData, ok := histogram.Data.(metricdata.Histogram[float64])
	require.True(t, ok)
	require.Len(t, histogramData.DataPoints, 1)
	histogramPoint := histogramData.DataPoints[0]
	histogramPoint.StartTime = time.Time{}
	histogramPoint.Time = time.Time{}
	assert.Equal(t, metricdata.HistogramDataPoint[float64]{
		Attributes: attribute.NewSet(
			attribute.String("mcp.tool", "code_mode_run_js"),
			attribute.String("mcp.status", "success"),
		),
		Count:        1,
		Bounds:       histogramPoint.Bounds,
		BucketCounts: histogramPoint.BucketCounts,
		Min:          histogramPoint.Min,
		Max:          histogramPoint.Max,
		Sum:          12.5,
	}, histogramPoint)
}

func codeModeMetrics(t *testing.T, metrics metricdata.ResourceMetrics) (metricdata.Metrics, metricdata.Metrics) {
	t.Helper()
	require.Len(t, metrics.ScopeMetrics, 1)
	assert.Equal(t, "wundergraph.cosmo.router.mcp.code_mode", metrics.ScopeMetrics[0].Scope.Name)

	byName := make(map[string]metricdata.Metrics, len(metrics.ScopeMetrics[0].Metrics))
	for _, metric := range metrics.ScopeMetrics[0].Metrics {
		byName[metric.Name] = metric
	}

	counter, ok := byName["mcp.code_mode.sandbox.executions"]
	require.True(t, ok)
	histogram, ok := byName["mcp.code_mode.sandbox.duration"]
	require.True(t, ok)
	return counter, histogram
}
