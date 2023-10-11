package graphqlmetrics

import (
	"context"
	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/bufbuild/connect-go"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"go.uber.org/zap"
)

type MetricsService struct {
	logger *zap.Logger
	chConn clickhouse.Conn
}

func NewMetricsService(logger *zap.Logger, chConn clickhouse.Conn) *MetricsService {
	return &MetricsService{
		logger: logger,
		chConn: chConn,
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
