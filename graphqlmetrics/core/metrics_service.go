package core

import (
	"context"
	"errors"
	"fmt"
	"github.com/dgraph-io/ristretto"
	"github.com/wundergraph/cosmo/graphqlmetrics/pkg/batchprocessor"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"
	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/avast/retry-go"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1"
	utils "github.com/wundergraph/cosmo/graphqlmetrics/pkg/utils"
	"go.uber.org/zap"
)

var (
	errNotAuthenticated = errors.New("authentication didn't succeed")
)

// SchemaUsageRequestItem is a struct which holds information about the schema usage
// and the JWT claims of a request.
type SchemaUsageRequestItem struct {
	SchemaUsage []*graphqlmetricsv1.SchemaUsageInfo
	Claims      *utils.GraphAPITokenClaims
}

type ProcessorConfig struct {
	Interval     time.Duration
	MaxWorkers   int
	MaxBatchSize int
	MaxQueueSize int
}

type MetricsService struct {
	logger *zap.Logger

	// conn is the clickhouse connection
	conn clickhouse.Conn

	// opGuardCache is used to prevent duplicate writes of the same operation
	opGuardCache *ristretto.Cache[string, struct{}]

	processor *batchprocessor.BatchProcessor[SchemaUsageRequestItem]
}

// NewMetricsService creates a new metrics service
func NewMetricsService(ctx context.Context, logger *zap.Logger, chConn clickhouse.Conn, processorConfig ProcessorConfig) *MetricsService {
	cacheConfig := &ristretto.Config[string, struct{}]{
		MaxCost:     50_000,
		NumCounters: 50_000 * 10,
		BufferItems: 64,
	}
	opGuardCache, err := ristretto.NewCache[string, struct{}](cacheConfig)
	if err != nil {
		panic(err)
	}

	config := batchprocessor.Options[SchemaUsageRequestItem]{
		MaxQueueSize:  processorConfig.MaxQueueSize,
		CostFunc:      calculateRequestCost,
		CostThreshold: processorConfig.MaxBatchSize,
		Interval:      processorConfig.Interval,
		MaxWorkers:    processorConfig.MaxWorkers,
	}

	ms := &MetricsService{
		logger:       logger,
		conn:         chConn,
		opGuardCache: opGuardCache,
	}

	config.Dispatcher = ms.processBatch
	ms.processor = batchprocessor.New(config)

	return ms
}

func (s *MetricsService) PublishGraphQLMetrics(
	ctx context.Context,
	req *connect.Request[graphqlmetricsv1.PublishGraphQLRequestMetricsRequest],
) (*connect.Response[graphqlmetricsv1.PublishOperationCoverageReportResponse], error) {

	res := connect.NewResponse(&graphqlmetricsv1.PublishOperationCoverageReportResponse{})

	claims, err := utils.GetClaims(ctx)
	if err != nil {
		return nil, errNotAuthenticated
	}

	if len(req.Msg.SchemaUsage) == 0 {
		return res, nil
	}

	s.processor.Push(SchemaUsageRequestItem{
		SchemaUsage: req.Msg.SchemaUsage,
		Claims:      claims,
	})

	return res, nil
}

func (s *MetricsService) PublishAggregatedGraphQLMetrics(ctx context.Context, req *connect.Request[graphqlmetricsv1.PublishAggregatedGraphQLRequestMetricsRequest]) (*connect.Response[graphqlmetricsv1.PublishAggregatedGraphQLRequestMetricsResponse], error) {
	res := connect.NewResponse(&graphqlmetricsv1.PublishAggregatedGraphQLRequestMetricsResponse{})

	claims, err := utils.GetClaims(ctx)
	if err != nil {
		return nil, errNotAuthenticated
	}

	if len(req.Msg.Aggregation) == 0 {
		return res, nil
	}

	schemaUsage := make([]*graphqlmetricsv1.SchemaUsageInfo, len(req.Msg.Aggregation))
	for i, agg := range req.Msg.Aggregation {
		for j := range agg.SchemaUsage.ArgumentMetrics {
			agg.SchemaUsage.ArgumentMetrics[j].Count = agg.RequestCount
		}
		for j := range agg.SchemaUsage.InputMetrics {
			agg.SchemaUsage.InputMetrics[j].Count = agg.RequestCount
		}
		for j := range agg.SchemaUsage.TypeFieldMetrics {
			agg.SchemaUsage.TypeFieldMetrics[j].Count = agg.RequestCount
		}
		schemaUsage[i] = agg.SchemaUsage
	}

	s.processor.Push(SchemaUsageRequestItem{
		SchemaUsage: schemaUsage,
		Claims:      claims,
	})

	return res, nil
}

func (s *MetricsService) Shutdown(timeout time.Duration) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	_ = s.processor.StopAndWait(ctx)

	if s.opGuardCache != nil {
		s.opGuardCache.Close()
	}
}

// prepareClickhouseBatches prepares the operation and metric batches for the given schema usage.
func (s *MetricsService) prepareClickhouseBatches(
	ctx context.Context, insertTime time.Time, batch []SchemaUsageRequestItem,
) (driver.Batch, driver.Batch, error) {

	var err error

	operationBatch, err := s.conn.PrepareBatch(ctx, `INSERT INTO gql_metrics_operations`)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to prepare operation batch for metrics: %w", err)
	}

	metricBatch, err := s.conn.PrepareBatch(ctx, `INSERT INTO gql_metrics_schema_usage`)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to prepare metric batch for metrics: %w", err)
	}

	operationHasItems, metricsHasItems := false, false

	for _, item := range batch {
		for _, schemaUsage := range item.SchemaUsage {
			// Skip if there are no request document
			if schemaUsage.RequestDocument == "" {
				continue
			}
			// If the operation is already in the cache, we can skip it and don't write it again
			if _, exists := s.opGuardCache.Get(schemaUsage.OperationInfo.Hash); exists {
				continue
			}
			err := operationBatch.Append(
				insertTime,
				schemaUsage.OperationInfo.Name,
				schemaUsage.OperationInfo.Hash,
				strings.ToLower(schemaUsage.OperationInfo.Type.String()),
				schemaUsage.RequestDocument,
			)
			if err != nil {
				return nil, nil, fmt.Errorf("failed to append operation to batch: %w", err)
			}
			operationHasItems = true
		}
	}

	if !operationHasItems {
		err = operationBatch.Abort()
		operationBatch = nil
	}

	for _, item := range batch {
		for _, schemaUsage := range item.SchemaUsage {
			added, err := s.appendUsageMetrics(metricBatch, insertTime, item.Claims, schemaUsage)
			if err != nil {
				return nil, nil, err
			}
			metricsHasItems = added
		}
	}

	if !metricsHasItems {
		err = metricBatch.Abort()
		metricBatch = nil
	}

	return operationBatch, metricBatch, err
}

func (*MetricsService) appendUsageMetrics(
	metricBatch driver.Batch,
	insertTime time.Time,
	claims *utils.GraphAPITokenClaims,
	schemaUsage *graphqlmetricsv1.SchemaUsageInfo,
) (added bool, err error) {
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
			fieldUsage.IndirectInterfaceField,
		)
		if err != nil {
			return false, fmt.Errorf("failed to append field metric to batch: %w", err)
		}

		added = true
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
			false,
		)
		if err != nil {
			return false, fmt.Errorf("failed to append argument metric to batch: %w", err)
		}

		added = true
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
			false,
		)
		if err != nil {
			return false, fmt.Errorf("failed to append input metric to batch: %w", err)
		}

		added = true
	}

	return added, err
}

func (s *MetricsService) processBatch(ctx context.Context, batch []SchemaUsageRequestItem) {
	var (
		storedOperations, storedMetrics int
	)
	insertTime := time.Now()
	insertCtx := context.Background()

	aggregated := make([]*graphqlmetricsv1.SchemaUsageInfo, 0, len(batch))
	for _, item := range batch {
		aggregated = append(aggregated, item.SchemaUsage...)
	}

	operationsBatch, metricsBatch, err := s.prepareClickhouseBatches(insertCtx, insertTime, batch)
	if err != nil {
		s.logger.Error("Failed to prepare or abort metrics batches", zap.Error(err))
		return
	}

	var wg sync.WaitGroup

	if operationsBatch != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()

			err := retryOnError(insertCtx, s.logger.With(zap.String("component", "operations")), func(ctx context.Context) error {
				if err := operationsBatch.Send(); err != nil {
					return fmt.Errorf("failed to send operation batch: %w", err)
				}

				for _, su := range aggregated {
					// Add the operation to the cache once it has been written
					// We use a TTL of 30 days to prevent caching of operations that are no in our database
					// due to storage retention policies
					s.opGuardCache.SetWithTTL(su.OperationInfo.Hash, struct{}{}, 1, 30*24*time.Hour)
				}

				s.opGuardCache.Wait()

				storedOperations += operationsBatch.Rows()
				return nil
			})

			if err != nil {
				s.logger.Error("Failed to write operations", zap.Error(err))
			}
		}()
	}

	if metricsBatch != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()

			if metricsBatch == nil {
				return
			}

			err := retryOnError(insertCtx, s.logger.With(zap.String("component", "metrics")), func(ctx context.Context) error {
				if err := metricsBatch.Send(); err != nil {
					return fmt.Errorf("failed to send metrics batch: %w", err)
				}

				storedMetrics += metricsBatch.Rows()
				return nil
			})

			if err != nil {
				s.logger.Error("Failed to write metrics", zap.Error(err))
			}
		}()
	}

	wg.Wait()

	s.logger.Debug("operations write finished",
		zap.Duration("duration", time.Since(insertTime)),
		zap.Int("stored_operations", storedOperations),
		zap.Int("stored_metrics", storedMetrics),
	)
}

// calculateRequestCost the total number of entries of metrics batch.
func calculateRequestCost(items []SchemaUsageRequestItem) int {
	total := 0
	for _, item := range items {
		for _, schemaUsage := range item.SchemaUsage {
			total += len(schemaUsage.ArgumentMetrics) + len(schemaUsage.InputMetrics) + len(schemaUsage.TypeFieldMetrics)
		}
	}
	return total
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
