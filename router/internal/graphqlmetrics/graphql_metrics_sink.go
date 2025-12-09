package graphqlmetrics

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	graphqlmetrics "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1/graphqlmetricsv1connect"
	"go.uber.org/zap"
)

// GraphQLMetricsSink implements the Sink interface for sending aggregated GraphQL metrics
// to the Cosmo GraphQL Metrics Service via Connect RPC.
type GraphQLMetricsSink struct {
	client   graphqlmetricsv1connect.GraphQLMetricsServiceClient
	apiToken string
	logger   *zap.Logger
}

// GraphQLMetricsSinkConfig contains configuration for creating a GraphQLMetricsSink.
type GraphQLMetricsSinkConfig struct {
	Client   graphqlmetricsv1connect.GraphQLMetricsServiceClient
	APIToken string
	Logger   *zap.Logger
}

// NewGraphQLMetricsSink creates a new sink that sends metrics to the GraphQL Metrics Service.
func NewGraphQLMetricsSink(cfg GraphQLMetricsSinkConfig) *GraphQLMetricsSink {
	return &GraphQLMetricsSink{
		client:   cfg.Client,
		apiToken: cfg.APIToken,
		logger:   cfg.Logger.With(zap.String("component", "graphql_metrics_sink")),
	}
}

// Export sends a batch of SchemaUsageInfo items to the GraphQL Metrics Service.
// It aggregates the items before sending to reduce payload size and improve efficiency.
func (s *GraphQLMetricsSink) Export(ctx context.Context, batch []*graphqlmetrics.SchemaUsageInfo) error {
	if len(batch) == 0 {
		return nil
	}

	s.logger.Debug("Exporting batch", zap.Int("size", len(batch)))

	// Aggregate the batch to reduce payload size
	request := AggregateSchemaUsageInfoBatch(batch)

	req := connect.NewRequest(request)
	req.Header().Set("Authorization", fmt.Sprintf("Bearer %s", s.apiToken))

	_, err := s.client.PublishAggregatedGraphQLMetrics(ctx, req)
	if err != nil {
		s.logger.Debug("Failed to export batch", zap.Error(err), zap.Int("batch_size", len(request.Aggregation)))
		return err
	}

	s.logger.Debug("Successfully exported batch", zap.Int("batch_size", len(request.Aggregation)))
	return nil
}

// Close performs cleanup when shutting down the sink.
// For GraphQLMetricsSink, there's no specific cleanup needed.
func (s *GraphQLMetricsSink) Close(ctx context.Context) error {
	s.logger.Debug("Closing GraphQL metrics sink")
	return nil
}

// IsRetryableError determines if an error from the GraphQL Metrics Service is retryable.
// Authentication errors should not be retried, while network and server errors should be.
func IsRetryableError(err error) bool {
	if err == nil {
		return false
	}

	var connectErr *connect.Error
	if errors.As(err, &connectErr) {
		switch connectErr.Code() {
		case connect.CodeUnauthenticated, connect.CodePermissionDenied, connect.CodeInvalidArgument:
			// Don't retry authentication, authorization, or validation errors
			return false
		default:
			// Retry other errors (network issues, server errors, etc.)
			return true
		}
	}

	// Unknown errors are retryable by default
	return true
}
