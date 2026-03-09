package entityanalytics

import (
	"context"

	"go.uber.org/zap"

	entityanalyticsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/entityanalytics/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/entityanalytics/v1/entityanalyticsv1connect"
	"github.com/wundergraph/cosmo/router/internal/exporter"
)

// EntityAnalyticsExporter wraps the generic Exporter for entity analytics.
type EntityAnalyticsExporter struct {
	exporter *exporter.Exporter[*entityanalyticsv1.EntityAnalyticsInfo]
}

// NewEntityAnalyticsExporter creates a new exporter for entity analytics.
func NewEntityAnalyticsExporter(
	logger *zap.Logger,
	client entityanalyticsv1connect.EntityAnalyticsServiceClient,
	apiToken string,
	settings *exporter.ExporterSettings,
) (*EntityAnalyticsExporter, error) {
	sink := NewEntityAnalyticsSink(EntityAnalyticsSinkConfig{
		Client:   client,
		APIToken: apiToken,
		Logger:   logger,
	})

	if logger == nil {
		logger = zap.NewNop()
	}

	if settings == nil {
		settings = exporter.NewDefaultExporterSettings()
	}

	exp, err := exporter.NewExporter(logger, sink, IsRetryableError, settings)
	if err != nil {
		return nil, err
	}

	return &EntityAnalyticsExporter{
		exporter: exp,
	}, nil
}

// RecordAnalytics records an entity analytics info item for export.
// If synchronous is true, the item is sent immediately. Otherwise, it's queued for batch processing.
// Returns false if the queue is full or the exporter is shutting down.
func (e *EntityAnalyticsExporter) RecordAnalytics(info *entityanalyticsv1.EntityAnalyticsInfo, synchronous bool) bool {
	return e.exporter.Record(info, synchronous)
}

// Shutdown gracefully shuts down the exporter.
func (e *EntityAnalyticsExporter) Shutdown(ctx context.Context) error {
	return e.exporter.Shutdown(ctx)
}
