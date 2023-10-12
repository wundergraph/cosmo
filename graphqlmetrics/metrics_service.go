package graphqlmetrics

import (
	"context"
	"database/sql"
	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/bufbuild/connect-go"
	lru "github.com/hashicorp/golang-lru/v2"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"go.uber.org/zap"
	"time"
)

type MetricsService struct {
	logger *zap.Logger

	// db is the clickhouse connection
	db *sql.DB

	// opGuardCache is used to prevent duplicate writes of the same operation
	opGuardCache *lru.Cache[string, struct{}]
}

func NewMetricsService(logger *zap.Logger, chConn *sql.DB) *MetricsService {
	c, err := lru.New[string, struct{}](10000)
	if err != nil {
		panic(err)
	}
	return &MetricsService{
		logger:       logger,
		db:           chConn,
		opGuardCache: c,
	}
}

func (s *MetricsService) PublishGraphQLMetrics(
	ctx context.Context,
	req *connect.Request[graphqlmetricsv1.PublishGraphQLRequestMetricsRequest],
) (*connect.Response[graphqlmetricsv1.PublishOperationCoverageReportResponse], error) {
	res := connect.NewResponse(&graphqlmetricsv1.PublishOperationCoverageReportResponse{})

	ctx = clickhouse.Context(ctx, clickhouse.WithStdAsync(true))

	scopeOperationBatch, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer scopeOperationBatch.Rollback()

	scopeFieldUsageBatch, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer scopeOperationBatch.Rollback()

	// Write batches in async mode to let clickhouse deal with batching and backpressure
	// Important: Wait for completion of all queries before returning to guarantee that all data is written
	ctx = clickhouse.Context(ctx, clickhouse.WithStdAsync(true))

	batchOperationStmts, err := scopeOperationBatch.PrepareContext(ctx, `INSERT INTO cosmo.graphql_operations`)
	if err != nil {
		return nil, err
	}

	batchSchemaUsageStmts, err := scopeFieldUsageBatch.PrepareContext(ctx, `INSERT INTO cosmo.graphql_schema_field_usage_reports`)
	if err != nil {
		return nil, err
	}

	insertTime := time.Now()

	for _, schemaUsage := range req.Msg.SchemaUsage {

		// If the operation is already in the cache, we can skip it and don't write it again
		if _, ok := s.opGuardCache.Get(schemaUsage.OperationInfo.OperationHash); !ok {
			_, err := batchOperationStmts.ExecContext(ctx,
				insertTime,
				schemaUsage.OperationInfo.OperationHash,
				schemaUsage.OperationDocument,
			)
			if err != nil {
				return nil, err
			}
		}

		for _, fieldUsage := range schemaUsage.TypeFieldMetrics {
			_, err := batchSchemaUsageStmts.ExecContext(ctx,
				insertTime,
				schemaUsage.RequestInfo.OrganizationID,
				schemaUsage.RequestInfo.FederatedGraphID,
				schemaUsage.RequestInfo.RouterConfigVersion,
				schemaUsage.OperationInfo.OperationHash,
				schemaUsage.OperationInfo.OperationType,
				fieldUsage.Count,
				fieldUsage.Path,
				fieldUsage.TypeNames,
				schemaUsage.Attributes,
			)
			if err != nil {
				return nil, err
			}
		}

	}

	err = scopeOperationBatch.Commit()
	if err != nil {
		return nil, err
	}

	// Update the cache with the operations we just wrote. Due to asynchronicity, it possibly happens
	// that we still write some operations twice, but that's fine since clickhouse will deduplicate them anyway
	for _, schemaUsage := range req.Msg.SchemaUsage {
		s.opGuardCache.Add(schemaUsage.OperationInfo.OperationHash, struct{}{})
	}

	err = scopeFieldUsageBatch.Commit()
	if err != nil {
		return nil, err
	}

	return res, nil
}
