package core

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/alitto/pond"
	"github.com/avast/retry-go"
	lru "github.com/hashicorp/golang-lru/v2"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1"
	utils "github.com/wundergraph/cosmo/graphqlmetrics/pkg/utils"
	"go.uber.org/zap"
)

var (
	errNotAuthenticated = errors.New("authentication didn't succeed")
	errPublishFailed    = errors.New("failed to publish metrics. Please retry")
)

type MetricsService struct {
	logger *zap.Logger

	// conn is the clickhouse connection
	conn clickhouse.Conn

	// opGuardCache is used to prevent duplicate writes of the same operation
	opGuardCache *lru.Cache[string, struct{}]

	pool *pond.WorkerPool
}

// NewMetricsService creates a new metrics service
func NewMetricsService(logger *zap.Logger, chConn clickhouse.Conn) *MetricsService {
	c, err := lru.New[string, struct{}](25000)
	if err != nil {
		panic(err)
	}
	return &MetricsService{
		logger:       logger,
		conn:         chConn,
		opGuardCache: c,
		pool:         pond.New(100, 500, pond.MinWorkers(10)),
	}
}

// saveOperations saves the operation documents to the storage in a batch
func (s *MetricsService) saveOperations(ctx context.Context, insertTime time.Time, schemaUsage []*graphqlmetricsv1.SchemaUsageInfo) (int, error) {

	opBatch, err := s.conn.PrepareBatch(ctx, `INSERT INTO gql_metrics_operations`)
	if err != nil {
		return 0, fmt.Errorf("failed to prepare batch for operations: %w", err)
	}

	for _, schemaUsage := range schemaUsage {

		operationType := strings.ToLower(schemaUsage.OperationInfo.Type.String())

		// If the operation is already in the cache, we can skip it and don't write it again
		if _, ok := s.opGuardCache.Get(schemaUsage.OperationInfo.Hash); !ok {
			err := opBatch.Append(
				insertTime,
				schemaUsage.OperationInfo.Name,
				schemaUsage.OperationInfo.Hash,
				operationType,
				schemaUsage.RequestDocument,
			)
			if err != nil {
				return 0, fmt.Errorf("failed to append operation to batch: %w", err)
			}
		}

	}

	if err := opBatch.Send(); err != nil {
		return 0, fmt.Errorf("failed to send operation batch: %w", err)
	}

	for _, su := range schemaUsage {
		// Add the operation to the cache once it has been written
		s.opGuardCache.Add(su.OperationInfo.Hash, struct{}{})
	}

	return opBatch.Rows(), nil
}

// saveUsageMetrics saves the usage metrics to the storage in a batch
func (s *MetricsService) saveUsageMetrics(ctx context.Context, insertTime time.Time, claims *utils.GraphAPITokenClaims, schemaUsage []*graphqlmetricsv1.SchemaUsageInfo) (int, error) {

	metricBatch, err := s.conn.PrepareBatch(ctx, `INSERT INTO gql_metrics_schema_usage`)
	if err != nil {
		return 0, fmt.Errorf("failed to prepare batch for metrics: %w", err)
	}

	for _, schemaUsage := range schemaUsage {

		operationType := strings.ToLower(schemaUsage.OperationInfo.Type.String())

		for _, fieldUsage := range schemaUsage.TypeFieldMetrics {

			// Sort stable for fields where the order doesn't matter
			// This reduce cardinality and improves compression

			sort.SliceStable(fieldUsage.SubgraphIDs, func(i, j int) bool {
				return fieldUsage.SubgraphIDs[i] < fieldUsage.SubgraphIDs[j]
			})
			sort.SliceStable(fieldUsage.TypeNames, func(i, j int) bool {
				return fieldUsage.TypeNames[i] < fieldUsage.TypeNames[j]
			})

			err := metricBatch.Append(
				insertTime,
				claims.OrganizationID,
				claims.FederatedGraphID,
				schemaUsage.SchemaInfo.Version,
				schemaUsage.OperationInfo.Hash,
				schemaUsage.OperationInfo.Name,
				operationType,
				fieldUsage.Count,
				fieldUsage.Path,
				fieldUsage.TypeNames,
				fieldUsage.NamedType,
				schemaUsage.ClientInfo.Name,
				schemaUsage.ClientInfo.Version,
				strconv.FormatInt(int64(schemaUsage.RequestInfo.StatusCode), 10),
				schemaUsage.RequestInfo.Error,
				fieldUsage.SubgraphIDs,
				false,
				false,
				schemaUsage.Attributes,
			)
			if err != nil {
				return 0, fmt.Errorf("failed to append field metric to batch: %w", err)
			}
		}

		for _, argumentUsage := range schemaUsage.ArgumentMetrics {

			err := metricBatch.Append(
				insertTime,
				claims.OrganizationID,
				claims.FederatedGraphID,
				schemaUsage.SchemaInfo.Version,
				schemaUsage.OperationInfo.Hash,
				schemaUsage.OperationInfo.Name,
				operationType,
				argumentUsage.Count,
				argumentUsage.Path,
				[]string{argumentUsage.TypeName},
				argumentUsage.NamedType,
				schemaUsage.ClientInfo.Name,
				schemaUsage.ClientInfo.Version,
				strconv.FormatInt(int64(schemaUsage.RequestInfo.StatusCode), 10),
				schemaUsage.RequestInfo.Error,
				[]string{},
				true,
				false,
				schemaUsage.Attributes,
			)
			if err != nil {
				return 0, fmt.Errorf("failed to append argument metric to batch: %w", err)
			}
		}

		for _, inputUsage := range schemaUsage.InputMetrics {

			err := metricBatch.Append(
				insertTime,
				claims.OrganizationID,
				claims.FederatedGraphID,
				schemaUsage.SchemaInfo.Version,
				schemaUsage.OperationInfo.Hash,
				schemaUsage.OperationInfo.Name,
				operationType,
				inputUsage.Count,
				inputUsage.Path,
				[]string{inputUsage.TypeName},
				inputUsage.NamedType,
				schemaUsage.ClientInfo.Name,
				schemaUsage.ClientInfo.Version,
				strconv.FormatInt(int64(schemaUsage.RequestInfo.StatusCode), 10),
				schemaUsage.RequestInfo.Error,
				[]string{},
				false,
				true,
				schemaUsage.Attributes,
			)
			if err != nil {
				return 0, fmt.Errorf("failed to append input metric to batch: %w", err)
			}
		}
	}

	if err := metricBatch.Send(); err != nil {
		return 0, fmt.Errorf("failed to send metrics batch: %w", err)
	}

	return metricBatch.Rows(), nil
}

func (s *MetricsService) PublishGraphQLMetrics(
	ctx context.Context,
	req *connect.Request[graphqlmetricsv1.PublishGraphQLRequestMetricsRequest],
) (*connect.Response[graphqlmetricsv1.PublishOperationCoverageReportResponse], error) {

	requestLogger := s.logger.With(zap.String("procedure", req.Spec().Procedure))
	res := connect.NewResponse(&graphqlmetricsv1.PublishOperationCoverageReportResponse{})

	claims, err := utils.GetClaims(ctx)
	if err != nil {
		return nil, errNotAuthenticated
	}

	dispatched := s.pool.TrySubmit(func() {
		var sentOps, sentMetrics = 0, 0
		insertTime := time.Now()

		defer func() {
			requestLogger.Debug("operations write finished",
				zap.Duration("duration", time.Since(insertTime)),
				zap.Int("metrics", sentMetrics),
				zap.Int("operations", sentOps),
			)
		}()

		insertCtx := context.Background()

		err = retryOnError(insertCtx, requestLogger.With(zap.String("component", "operations")), func(ctx context.Context) error {
			writtenOps, err := s.saveOperations(ctx, insertTime, req.Msg.SchemaUsage)
			if err != nil {
				return err
			}
			sentOps += writtenOps
			return nil
		})

		if err != nil {
			requestLogger.Error("Failed to write operations", zap.Error(err))
		}

		err = retryOnError(insertCtx, requestLogger.With(zap.String("component", "metrics")), func(ctx context.Context) error {
			writtenMetrics, err := s.saveUsageMetrics(ctx, insertTime, claims, req.Msg.SchemaUsage)
			if err != nil {
				return err
			}
			sentMetrics += writtenMetrics
			return nil
		})

		if err != nil {
			requestLogger.Error("Failed to write metrics", zap.Error(err))
		}
	})

	if !dispatched {
		requestLogger.Error("Failed to dispatch request to worker pool")

		// Will force the client (router) to retry the request
		return nil, errPublishFailed
	}

	return res, nil
}

func (s *MetricsService) Shutdown(deadline time.Duration) {
	s.pool.StopAndWaitFor(deadline)
}

func retryOnError(ctx context.Context, logger *zap.Logger, f func(ctx context.Context) error) error {
	opts := []retry.Option{
		retry.Attempts(3),
		retry.Delay(100 * time.Millisecond),
		retry.MaxJitter(1000 * time.Millisecond),
		retry.DelayType(retry.CombineDelay(retry.BackOffDelay, retry.RandomDelay)),
		retry.OnRetry(func(n uint, err error) {
			logger.Debug("retrying after error",
				zap.Error(err),
				zap.Uint("attempt", n),
			)
		}),
	}

	err := retry.Do(
		func() error {
			err := f(ctx)

			if err != nil {
				return err
			}

			return nil
		},
		opts...,
	)
	if err != nil {
		return err
	}

	return nil
}
