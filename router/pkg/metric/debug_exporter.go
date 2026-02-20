package metric

import (
	"context"
	"fmt"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"regexp"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.uber.org/zap"
)

// standaloneDebugExporter is a metric exporter that logs all collected metrics via zap.
type standaloneDebugExporter struct {
	logger         *zap.Logger
	excludeMetrics []*regexp.Regexp
}

func newStandaloneDebugExporter(logger *zap.Logger, excludeMetrics []*regexp.Regexp) sdkmetric.Exporter {
	return &standaloneDebugExporter{
		logger:         logger.Named("metrics-debug"),
		excludeMetrics: excludeMetrics,
	}
}

func (s *standaloneDebugExporter) Temporality(_ sdkmetric.InstrumentKind) metricdata.Temporality {
	return metricdata.CumulativeTemporality
}

func (s *standaloneDebugExporter) Aggregation(_ sdkmetric.InstrumentKind) sdkmetric.Aggregation {
	return nil
}

func (s *standaloneDebugExporter) ForceFlush(_ context.Context) error {
	return nil
}

func (s *standaloneDebugExporter) Shutdown(_ context.Context) error {
	return nil
}

func (s *standaloneDebugExporter) Export(_ context.Context, rm *metricdata.ResourceMetrics) error {
	totalMetrics := 0
	for _, sm := range rm.ScopeMetrics {
		totalMetrics += len(sm.Metrics)
	}

	s.logger.Info("Debug metric export",
		zap.Int("scope_metrics", len(rm.ScopeMetrics)),
		zap.Int("total_metrics", totalMetrics),
	)

	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if isMetricExcluded(m.Name, s.excludeMetrics) {
				continue
			}
			logMetricData(s.logger, m)
		}
	}

	return nil
}

func isMetricExcluded(name string, excludeMetrics []*regexp.Regexp) bool {
	for _, re := range excludeMetrics {
		if re.MatchString(name) {
			return true
		}
	}
	return false
}

func logMetricData(logger *zap.Logger, m metricdata.Metrics) {
	switch data := m.Data.(type) {
	case metricdata.Sum[int64]:
		logSumMetric(logger, m, "Sum[int64]", data)
	case metricdata.Sum[float64]:
		logSumMetric(logger, m, "Sum[float64]", data)
	case metricdata.Histogram[int64]:
		logHistogramMetric(logger, m, "Histogram[int64]", data)
	case metricdata.Histogram[float64]:
		logHistogramMetric(logger, m, "Histogram[float64]", data)
	case metricdata.ExponentialHistogram[int64]:
		logExpHistogramMetric(logger, m, "ExponentialHistogram[int64]", data)
	case metricdata.ExponentialHistogram[float64]:
		logExpHistogramMetric(logger, m, "ExponentialHistogram[float64]", data)
	case metricdata.Gauge[int64]:
		logGaugeMetric(logger, m, "Gauge[int64]", data)
	case metricdata.Gauge[float64]:
		logGaugeMetric(logger, m, "Gauge[float64]", data)
	default:
		logger.Info("Metric",
			zap.String("name", m.Name),
			zap.String("unit", m.Unit),
			zap.String("type", fmt.Sprintf("%T", m.Data)),
		)
	}
}

func logSumMetric[N int64 | float64](logger *zap.Logger, m metricdata.Metrics, typeName string, data metricdata.Sum[N]) {
	points := make([]string, len(data.DataPoints))
	for i, dp := range data.DataPoints {
		points[i] = formatAttributes(dp.Attributes, timeRange(dp.StartTime, dp.Time), fmt.Sprintf("value=%v", dp.Value))
	}
	logger.Info("Metric",
		zap.String("name", m.Name),
		zap.String("unit", m.Unit),
		zap.String("type", typeName),
		zap.String("temporality", data.Temporality.String()),
		zap.Bool("monotonic", data.IsMonotonic),
		zap.Strings("data_points", points),
	)
}

func logHistogramMetric[N int64 | float64](logger *zap.Logger, m metricdata.Metrics, typeName string, data metricdata.Histogram[N]) {
	points := make([]string, len(data.DataPoints))
	for i, dp := range data.DataPoints {
		points[i] = formatAttributes(dp.Attributes, fmt.Sprintf("count=%d sum=%v", dp.Count, dp.Sum))
	}
	logger.Info("Metric",
		zap.String("name", m.Name),
		zap.String("unit", m.Unit),
		zap.String("type", typeName),
		zap.String("temporality", data.Temporality.String()),
		zap.Strings("data_points", points),
	)
}

func logExpHistogramMetric[N int64 | float64](logger *zap.Logger, m metricdata.Metrics, typeName string, data metricdata.ExponentialHistogram[N]) {
	points := make([]string, len(data.DataPoints))
	for i, dp := range data.DataPoints {
		points[i] = formatAttributes(dp.Attributes, timeRange(dp.StartTime, dp.Time), fmt.Sprintf("count=%d sum=%v scale=%d", dp.Count, dp.Sum, dp.Scale))
	}
	logger.Info("Metric",
		zap.String("name", m.Name),
		zap.String("unit", m.Unit),
		zap.String("type", typeName),
		zap.String("temporality", data.Temporality.String()),
		zap.Strings("data_points", points),
	)
}

func logGaugeMetric[N int64 | float64](logger *zap.Logger, m metricdata.Metrics, typeName string, data metricdata.Gauge[N]) {
	points := make([]string, len(data.DataPoints))
	for i, dp := range data.DataPoints {
		points[i] = formatAttributes(dp.Attributes, timeRange(dp.StartTime, dp.Time), fmt.Sprintf("value=%v", dp.Value))
	}
	logger.Info("Metric",
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
