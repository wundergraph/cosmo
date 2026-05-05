package cacheevents

import (
	"context"

	"connectrpc.com/connect"
	cacheeventsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/cacheevents/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/cacheevents/v1/cacheeventsv1connect"
	"go.uber.org/zap"
)

// Sink ships batches of CacheEvent records to the cosmo cache-events endpoint
// over Connect/gRPC.
type Sink struct {
	client cacheeventsv1connect.CacheEventsServiceClient
	logger *zap.Logger
}

// SinkConfig is the constructor input for Sink.
type SinkConfig struct {
	Client cacheeventsv1connect.CacheEventsServiceClient
	Logger *zap.Logger
}

// NewSink wraps a Connect client into a router exporter.Sink.
func NewSink(cfg SinkConfig) *Sink {
	return &Sink{
		client: cfg.Client,
		logger: cfg.Logger.With(zap.String("component", "cache_events_sink")),
	}
}

// Export sends the batch via PublishEntityCacheEvents.
func (s *Sink) Export(ctx context.Context, batch []*cacheeventsv1.CacheEvent) error {
	if len(batch) == 0 {
		return nil
	}
	if _, err := s.client.PublishEntityCacheEvents(ctx, connect.NewRequest(BuildRequest(batch))); err != nil {
		s.logger.Debug("Failed to export cache events batch", zap.Error(err), zap.Int("size", len(batch)))
		return err
	}
	s.logger.Debug("Cache events batch exported", zap.Int("size", len(batch)))
	return nil
}

// Close is a no-op — the underlying Connect client has nothing to clean up.
func (s *Sink) Close(ctx context.Context) error { return nil }
