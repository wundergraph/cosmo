package graphqlmetrics

import (
	"context"
	"github.com/bufbuild/connect-go"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"go.uber.org/zap"
)

type MetricsService struct {
	logger *zap.Logger
}

func NewMetricsService(logger *zap.Logger) *MetricsService {
	return &MetricsService{
		logger: logger,
	}
}

func (s *MetricsService) PublishGraphQLMetrics(
	ctx context.Context,
	req *connect.Request[graphqlmetricsv1.PublishGraphQLRequestMetricsRequest],
) (*connect.Response[graphqlmetricsv1.PublishOperationCoverageReportResponse], error) {
	res := connect.NewResponse(&graphqlmetricsv1.PublishOperationCoverageReportResponse{})
	res.Header().Set("GraphQL-Metrics-Version", "v1")
	return res, nil
}
