package graphqlmetrics

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/bufbuild/connect-go"
	"github.com/golang-jwt/jwt/v5"
	lru "github.com/hashicorp/golang-lru/v2"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"go.uber.org/zap"
	"strings"
	"time"
)

var (
	errJWTInvalid                        = errors.New("the JWT is invalid")
	errInvalidAuthenticationHeaderFormat = errors.New("invalid authorization header format")
	errNotAuthenticated                  = errors.New("authentication didn't succeed")
	errMetricWriteFailed                 = errors.New("failed to write metrics")
	errOperationWriteFailed              = errors.New("operation write failed")
	errPublishFailed                     = errors.New("publish failed")
)

type GraphAPITokenClaims struct {
	OrganizationID   string `json:"organization_id"`
	FederatedGraphID string `json:"federated_graph_id"`
	jwt.RegisteredClaims
}

type MetricsService struct {
	logger *zap.Logger

	// db is the clickhouse connection
	db *sql.DB

	// opGuardCache is used to prevent duplicate writes of the same operation
	opGuardCache *lru.Cache[string, struct{}]

	// jwtSecret is the secret used to validate the JWT
	jwtSecret []byte
}

// NewMetricsService creates a new metrics service
func NewMetricsService(logger *zap.Logger, chConn *sql.DB, jwtSecret []byte) *MetricsService {
	c, err := lru.New[string, struct{}](25000)
	if err != nil {
		panic(err)
	}
	return &MetricsService{
		logger:       logger,
		db:           chConn,
		opGuardCache: c,
		jwtSecret:    jwtSecret,
	}
}

func (s *MetricsService) PublishGraphQLMetrics(
	ctx context.Context,
	req *connect.Request[graphqlmetricsv1.PublishGraphQLRequestMetricsRequest],
) (*connect.Response[graphqlmetricsv1.PublishOperationCoverageReportResponse], error) {
	res := connect.NewResponse(&graphqlmetricsv1.PublishOperationCoverageReportResponse{})

	parts := strings.Split(req.Header().Get("Authorization"), " ")
	if len(parts) != 2 {
		return nil, errInvalidAuthenticationHeaderFormat
	}

	token, err := jwt.ParseWithClaims(parts[1], &GraphAPITokenClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return s.jwtSecret, nil
	})
	if err != nil {
		s.logger.Debug("Failed to parse token", zap.Error(err))
		return nil, errNotAuthenticated
	}

	if !token.Valid {
		s.logger.Debug("Token is invalid", zap.Bool("valid", token.Valid))
		return nil, errJWTInvalid
	}

	claims, ok := token.Claims.(*GraphAPITokenClaims)
	if !ok {
		return nil, errJWTInvalid
	}

	ctx = clickhouse.Context(ctx, clickhouse.WithStdAsync(true))

	scopeOperationBatch, err := s.db.Begin()
	if err != nil {
		s.logger.Error("Failed to begin operation batch", zap.Error(err))
		return nil, errPublishFailed
	}
	defer scopeOperationBatch.Rollback()

	scopeFieldUsageBatch, err := s.db.Begin()
	if err != nil {
		s.logger.Error("Failed to begin field usage batch", zap.Error(err))
		return nil, errPublishFailed
	}
	defer scopeOperationBatch.Rollback()

	// Write batches in async mode to let clickhouse deal with batching and backpressure
	// Important: Wait for completion of all queries before returning to guarantee that all data is written
	ctx = clickhouse.Context(ctx, clickhouse.WithStdAsync(true))

	batchOperationStmts, err := scopeOperationBatch.PrepareContext(ctx, `INSERT INTO cosmo.graphql_operations`)
	if err != nil {
		s.logger.Error("Failed to prepare operation batch statement", zap.Error(err))
		return nil, errOperationWriteFailed
	}

	batchSchemaUsageStmts, err := scopeFieldUsageBatch.PrepareContext(ctx, `INSERT INTO cosmo.graphql_schema_field_usage_reports`)
	if err != nil {
		s.logger.Error("Failed to prepare field usage batch statement", zap.Error(err))
		return nil, errMetricWriteFailed
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
				s.logger.Error("Failed to write operation", zap.Error(err))
				return nil, errOperationWriteFailed
			}
		}

		for _, fieldUsage := range schemaUsage.TypeFieldMetrics {
			_, err := batchSchemaUsageStmts.ExecContext(ctx,
				insertTime,
				claims.OrganizationID,
				claims.FederatedGraphID,
				schemaUsage.RequestInfo.RouterConfigVersion,
				schemaUsage.OperationInfo.OperationHash,
				schemaUsage.OperationInfo.OperationType,
				fieldUsage.Count,
				fieldUsage.Path,
				fieldUsage.TypeNames,
				schemaUsage.Attributes,
			)
			if err != nil {
				s.logger.Error("Failed to write metrics", zap.Error(err))
				return nil, errMetricWriteFailed
			}
		}

	}

	err = scopeOperationBatch.Commit()
	if err != nil {
		s.logger.Error("Failed to commit operation batch", zap.Error(err))
		return nil, errOperationWriteFailed
	}

	// Update the cache with the operations we just wrote. Due to asynchronicity, it possibly happens
	// that we still write some operations twice, but that's fine since clickhouse will deduplicate them anyway
	for _, schemaUsage := range req.Msg.SchemaUsage {
		s.opGuardCache.Add(schemaUsage.OperationInfo.OperationHash, struct{}{})
	}

	err = scopeFieldUsageBatch.Commit()
	if err != nil {
		s.logger.Error("Failed to commit field usage batch", zap.Error(err))
		return nil, errMetricWriteFailed
	}

	return res, nil
}
