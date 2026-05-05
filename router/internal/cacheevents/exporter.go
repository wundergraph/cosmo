package cacheevents

import (
	cacheeventsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/cacheevents/v1"
	"github.com/wundergraph/cosmo/router/internal/exporter"
	"go.uber.org/zap"
)

// Exporter is the type alias used by callers; it is a thin wrapper around
// the generic batched async exporter.
type Exporter = exporter.Exporter[*cacheeventsv1.CacheEvent]

// NewExporter constructs the cache-events exporter. The sink is responsible
// for the actual Connect call; this exporter handles queueing, batching,
// retry, and graceful shutdown.
func NewExporter(logger *zap.Logger, sink *Sink, settings *exporter.ExporterSettings) (*Exporter, error) {
	return exporter.NewExporter(logger, sink, exporter.IsRetryableConnectError, settings)
}
