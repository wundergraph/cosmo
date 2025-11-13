package graphqlmetrics

import (
	"context"

	graphqlmetrics "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1/graphqlmetricsv1connect"
	"go.uber.org/zap"
)

// GraphQLMetricsExporter wraps the generic Exporter for GraphQL metrics.
// It provides a cleaner API and backward compatibility with the old interface.
type GraphQLMetricsExporter struct {
	exporter *Exporter[*graphqlmetrics.SchemaUsageInfo]
}

// NewGraphQLMetricsExporter creates a new exporter specifically for GraphQL metrics.
// This is a convenience function that wraps the generic NewExporter with GraphQLMetricsSink.
func NewGraphQLMetricsExporter(
	logger *zap.Logger,
	client graphqlmetricsv1connect.GraphQLMetricsServiceClient,
	apiToken string,
	settings *ExporterSettings,
) (*GraphQLMetricsExporter, error) {
	sink := NewGraphQLMetricsSink(GraphQLMetricsSinkConfig{
		Client:   client,
		APIToken: apiToken,
		Logger:   logger,
	})

	exporter, err := NewExporter(logger, sink, IsRetryableError, settings)
	if err != nil {
		return nil, err
	}

	return &GraphQLMetricsExporter{
		exporter: exporter,
	}, nil
}

// RecordUsage records a schema usage info item for export.
// If synchronous is true, the item is sent immediately. Otherwise, it's queued for batch processing.
// Returns false if the queue is full or the exporter is shutting down.
func (e *GraphQLMetricsExporter) RecordUsage(usageInfo *graphqlmetrics.SchemaUsageInfo, synchronous bool) bool {
	return e.exporter.Record(usageInfo, synchronous)
}

// Shutdown gracefully shuts down the exporter.
// It stops accepting new items, drains the queue, waits for in-flight batches, and closes the sink.
func (e *GraphQLMetricsExporter) Shutdown(ctx context.Context) error {
	return e.exporter.Shutdown(ctx)
}
