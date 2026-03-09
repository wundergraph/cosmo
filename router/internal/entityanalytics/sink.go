package entityanalytics

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"go.uber.org/zap"

	entityanalyticsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/entityanalytics/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/entityanalytics/v1/entityanalyticsv1connect"
)

// EntityAnalyticsSink implements exporter.Sink for sending aggregated entity analytics
// to the Entity Analytics Service via Connect RPC.
type EntityAnalyticsSink struct {
	client   entityanalyticsv1connect.EntityAnalyticsServiceClient
	apiToken string
	logger   *zap.Logger
}

// EntityAnalyticsSinkConfig contains configuration for creating an EntityAnalyticsSink.
type EntityAnalyticsSinkConfig struct {
	Client   entityanalyticsv1connect.EntityAnalyticsServiceClient
	APIToken string
	Logger   *zap.Logger
}

// NewEntityAnalyticsSink creates a new sink that sends analytics to the Entity Analytics Service.
func NewEntityAnalyticsSink(cfg EntityAnalyticsSinkConfig) *EntityAnalyticsSink {
	return &EntityAnalyticsSink{
		client:   cfg.Client,
		apiToken: cfg.APIToken,
		logger:   cfg.Logger.With(zap.String("component", "entity_analytics_sink")),
	}
}

// Export sends a batch of EntityAnalyticsInfo items to the Entity Analytics Service.
func (s *EntityAnalyticsSink) Export(ctx context.Context, batch []*entityanalyticsv1.EntityAnalyticsInfo) error {
	if len(batch) == 0 {
		return nil
	}

	s.logger.Debug("Exporting batch", zap.Int("size", len(batch)))

	request := AggregateEntityAnalyticsBatch(batch)

	req := connect.NewRequest(request)
	req.Header().Set("Authorization", fmt.Sprintf("Bearer %s", s.apiToken))

	_, err := s.client.PublishEntityAnalytics(ctx, req)
	if err != nil {
		s.logger.Debug("Failed to export batch", zap.Error(err), zap.Int("batch_size", len(request.Aggregations)))
		return err
	}

	s.logger.Debug("Successfully exported batch", zap.Int("batch_size", len(request.Aggregations)))
	return nil
}

// Close performs cleanup when shutting down the sink.
func (s *EntityAnalyticsSink) Close(_ context.Context) error {
	s.logger.Debug("Closing entity analytics sink")
	return nil
}

// IsRetryableError determines if an error from the Entity Analytics Service is retryable.
func IsRetryableError(err error) bool {
	if err == nil {
		return false
	}

	var connectErr *connect.Error
	if errors.As(err, &connectErr) {
		switch connectErr.Code() {
		case connect.CodeUnauthenticated, connect.CodePermissionDenied, connect.CodeInvalidArgument:
			return false
		default:
			return true
		}
	}

	return true
}
