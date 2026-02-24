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

// metricsLogExporter is a metric exporter that logs all collected metrics via zap.
type metricsLogExporter struct {
	logger         *zap.Logger
	excludeMetrics []*regexp.Regexp
}

func newMetricsLogExporter(logger *zap.Logger, excludeMetrics []*regexp.Regexp) *metricsLogExporter {
	return &metricsLogExporter{
		logger:         logger,
		excludeMetrics: excludeMetrics,
	}
}

func (s *metricsLogExporter) Temporality(_ sdkmetric.InstrumentKind) metricdata.Temporality {
	return metricdata.CumulativeTemporality
}

func (s *metricsLogExporter) Aggregation(_ sdkmetric.InstrumentKind) sdkmetric.Aggregation {
	return nil
}

func (s *metricsLogExporter) ForceFlush(_ context.Context) error {
	return nil
}

func (s *metricsLogExporter) Shutdown(_ context.Context) error {
	return nil
}

func (s *metricsLogExporter) Export(_ context.Context, rm *metricdata.ResourceMetrics) error {
	totalMetrics := 0
	for _, sm := range rm.ScopeMetrics {
		totalMetrics += len(sm.Metrics)
	}

	s.logger.Info("Metrics log export",
		zap.Int("scope_metrics", len(rm.ScopeMetrics)),
		zap.Int("total_metrics", totalMetrics),
	)

	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			// If metric is excluded by name, skip logging it
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
		logSumMetric(logger, m, "sum:int64", data)
	case metricdata.Sum[float64]:
		logSumMetric(logger, m, "sum:float64", data)
	case metricdata.Histogram[int64]:
		logHistogramMetric(logger, m, "histogram:int64", data)
	case metricdata.Histogram[float64]:
		logHistogramMetric(logger, m, "histogram:float64", data)
	case metricdata.ExponentialHistogram[int64]:
		logExpHistogramMetric(logger, m, "exponential_histogram:int64", data)
	case metricdata.ExponentialHistogram[float64]:
		logExpHistogramMetric(logger, m, "exponential_histogram:float64", data)
	case metricdata.Gauge[int64]:
		logGaugeMetric(logger, m, "gauge:int64", data)
	case metricdata.Gauge[float64]:
		logGaugeMetric(logger, m, "gauge:float64", data)
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
	parts := make([]string, 0, attrs.Len()+len(extra))

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
