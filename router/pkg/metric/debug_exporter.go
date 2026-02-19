package metric

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.uber.org/zap"
)

// debugExporter wraps an sdkmetric.Exporter and logs export details when enabled.
type debugExporter struct {
	wrapped        sdkmetric.Exporter
	logger         *zap.Logger
	excludeMetrics []*regexp.Regexp
}

func newDebugExporter(wrapped sdkmetric.Exporter, logger *zap.Logger, excludeMetrics []*regexp.Regexp) sdkmetric.Exporter {
	return &debugExporter{wrapped: wrapped, logger: logger.Named("otlp-debug"), excludeMetrics: excludeMetrics}
}

func (d *debugExporter) Temporality(kind sdkmetric.InstrumentKind) metricdata.Temporality {
	return d.wrapped.Temporality(kind)
}

func (d *debugExporter) Aggregation(kind sdkmetric.InstrumentKind) sdkmetric.Aggregation {
	return d.wrapped.Aggregation(kind)
}

func (d *debugExporter) ForceFlush(ctx context.Context) error {
	return d.wrapped.ForceFlush(ctx)
}

func (d *debugExporter) Shutdown(ctx context.Context) error {
	return d.wrapped.Shutdown(ctx)
}

func (d *debugExporter) Export(ctx context.Context, rm *metricdata.ResourceMetrics) error {
	start := time.Now()

	totalMetrics := 0
	for _, sm := range rm.ScopeMetrics {
		totalMetrics += len(sm.Metrics)
	}

	d.logger.Info("Starting OTLP metric export",
		zap.Int("scope_metrics", len(rm.ScopeMetrics)),
		zap.Int("total_metrics", totalMetrics),
		zap.String("resource", formatAttributes(*rm.Resource.Set())),
	)

	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			d.logMetric(m)
		}
	}

	err := d.wrapped.Export(ctx, rm)
	duration := time.Since(start)

	if err != nil {
		d.logger.Error("OTLP metric export failed",
			zap.Error(err),
			zap.Duration("duration", duration),
		)
	} else {
		d.logger.Info("OTLP metric export succeeded",
			zap.Int("total_metrics", totalMetrics),
			zap.Duration("duration", duration),
		)
	}

	return err
}

func (d *debugExporter) isExcludedMetric(name string) bool {
	for _, re := range d.excludeMetrics {
		if re.MatchString(name) {
			return true
		}
	}
	return false
}

func (d *debugExporter) logMetric(m metricdata.Metrics) {
	if d.isExcludedMetric(m.Name) {
		return
	}

	switch data := m.Data.(type) {
	case metricdata.Sum[int64]:
		logSumMetric(d, m, "Sum[int64]", data)
	case metricdata.Sum[float64]:
		logSumMetric(d, m, "Sum[float64]", data)
	case metricdata.Histogram[int64]:
		logHistogramMetric(d, m, "Histogram[int64]", data)
	case metricdata.Histogram[float64]:
		logHistogramMetric(d, m, "Histogram[float64]", data)
	case metricdata.ExponentialHistogram[int64]:
		logExpHistogramMetric(d, m, "ExponentialHistogram[int64]", data)
	case metricdata.ExponentialHistogram[float64]:
		logExpHistogramMetric(d, m, "ExponentialHistogram[float64]", data)
	case metricdata.Gauge[int64]:
		logGaugeMetric(d, m, "Gauge[int64]", data)
	case metricdata.Gauge[float64]:
		logGaugeMetric(d, m, "Gauge[float64]", data)
	default:
		d.logger.Info("Metric",
			zap.String("name", m.Name),
			zap.String("unit", m.Unit),
			zap.String("type", fmt.Sprintf("%T", m.Data)),
		)
	}
}

func logSumMetric[N int64 | float64](d *debugExporter, m metricdata.Metrics, typeName string, data metricdata.Sum[N]) {
	points := make([]string, len(data.DataPoints))
	for i, dp := range data.DataPoints {
		points[i] = formatAttributes(dp.Attributes, timeRange(dp.StartTime, dp.Time), fmt.Sprintf("value=%v", dp.Value))
	}
	d.logger.Info("Metric",
		zap.String("name", m.Name),
		zap.String("unit", m.Unit),
		zap.String("type", typeName),
		zap.String("temporality", data.Temporality.String()),
		zap.Bool("monotonic", data.IsMonotonic),
		zap.Strings("data_points", points),
	)
}

func logHistogramMetric[N int64 | float64](d *debugExporter, m metricdata.Metrics, typeName string, data metricdata.Histogram[N]) {
	points := make([]string, len(data.DataPoints))
	for i, dp := range data.DataPoints {
		points[i] = formatAttributes(dp.Attributes, fmt.Sprintf("count=%d sum=%v", dp.Count, dp.Sum))
	}
	d.logger.Info("Metric",
		zap.String("name", m.Name),
		zap.String("unit", m.Unit),
		zap.String("type", typeName),
		zap.String("temporality", data.Temporality.String()),
		zap.Strings("data_points", points),
	)
}

func logExpHistogramMetric[N int64 | float64](d *debugExporter, m metricdata.Metrics, typeName string, data metricdata.ExponentialHistogram[N]) {
	points := make([]string, len(data.DataPoints))
	for i, dp := range data.DataPoints {
		points[i] = formatAttributes(dp.Attributes, timeRange(dp.StartTime, dp.Time), fmt.Sprintf("count=%d sum=%v scale=%d", dp.Count, dp.Sum, dp.Scale))
	}
	d.logger.Info("Metric",
		zap.String("name", m.Name),
		zap.String("unit", m.Unit),
		zap.String("type", typeName),
		zap.String("temporality", data.Temporality.String()),
		zap.Strings("data_points", points),
	)
}

func logGaugeMetric[N int64 | float64](d *debugExporter, m metricdata.Metrics, typeName string, data metricdata.Gauge[N]) {
	points := make([]string, len(data.DataPoints))
	for i, dp := range data.DataPoints {
		points[i] = formatAttributes(dp.Attributes, timeRange(dp.StartTime, dp.Time), fmt.Sprintf("value=%v", dp.Value))
	}
	d.logger.Info("Metric",
		zap.String("name", m.Name),
		zap.String("unit", m.Unit),
		zap.String("type", typeName),
		zap.Strings("data_points", points),
	)
}

func timeRange(start, end time.Time) string {
	return fmt.Sprintf("start=%s end=%s", start.Format(time.RFC3339Nano), end.Format(time.RFC3339Nano))
}

func formatAttributes(attrs attribute.Set, extra ...string) string {
	var parts []string
	iter := attrs.Iter()
	for iter.Next() {
		kv := iter.Attribute()
		parts = append(parts, fmt.Sprintf("%s=%s", string(kv.Key), kv.Value.Emit()))
	}
	for _, e := range extra {
		if e != "" {
			parts = append(parts, e)
		}
	}
	if len(parts) == 0 {
		return "{}"
	}
	return "{" + strings.Join(parts, ", ") + "}"
}
