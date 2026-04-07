package graphqlmetrics

import (
	"context"

	graphqlmetrics "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/router/internal/exporter"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	"go.uber.org/zap"
)

// PrometheusMetricsExporter wraps the generic Exporter for Prometheus metrics.
// It provides a cleaner API for exporting schema field usage to Prometheus.
type PrometheusMetricsExporter struct {
	exporter *exporter.Exporter[*graphqlmetrics.SchemaUsageInfo]
}

// NewPrometheusMetricsExporter creates a new exporter specifically for Prometheus metrics.
// This is a convenience function that wraps the generic NewExporter with PrometheusSink.
func NewPrometheusMetricsExporter(
	logger *zap.Logger,
	metricStore metric.Store,
	includeOpSha bool,
	settings *exporter.ExporterSettings,
) (*PrometheusMetricsExporter, error) {
	if logger == nil {
		logger = zap.NewNop()
	}

	if settings == nil {
		settings = exporter.NewDefaultExporterSettings()
	}

	sink := NewPrometheusSink(PrometheusSinkConfig{
		MetricStore:  metricStore,
		Logger:       logger,
		IncludeOpSha: includeOpSha,
	})

	// Prometheus metrics are local, so errors are generally not retryable
	// (they indicate programming errors or resource exhaustion)
	errorHandler := func(err error) bool {
		return false // Don't retry Prometheus errors
	}

	exporter, err := exporter.NewExporter(logger, sink, errorHandler, settings)
	if err != nil {
		return nil, err
	}

	return &PrometheusMetricsExporter{
		exporter: exporter,
	}, nil
}

// RecordUsage records a schema usage info item for Prometheus export.
// If synchronous is true, the item is processed immediately. Otherwise, it's queued for batch processing.
// Returns false if the queue is full or the exporter is shutting down.
func (e *PrometheusMetricsExporter) RecordUsage(usageInfo *graphqlmetrics.SchemaUsageInfo, synchronous bool) bool {
	return e.exporter.Record(usageInfo, synchronous)
}

// Shutdown gracefully shuts down the exporter.
// It stops accepting new items, drains the queue, waits for in-flight batches, and closes the sink.
func (e *PrometheusMetricsExporter) Shutdown(ctx context.Context) error {
	return e.exporter.Shutdown(ctx)
}
