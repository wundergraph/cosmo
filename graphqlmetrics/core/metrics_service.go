package core

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dgraph-io/ristretto/v2"

	"connectrpc.com/connect"
	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/avast/retry-go"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/graphqlmetrics/pkg/batchprocessor"
	utils "github.com/wundergraph/cosmo/graphqlmetrics/pkg/utils"
	"go.uber.org/zap"
)

var (
	errNotAuthenticated = errors.New("authentication didn't succeed")
)

// SchemaUsageRequestItem is a struct which holds information about the schema usage
// and the JWT claims of a request.
type SchemaUsageRequestItem struct {
	SchemaUsage       []*graphqlmetricsv1.SchemaUsageInfo
	Claims            *utils.GraphAPITokenClaims
	TotalRequestCount uint64
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
func NewMetricsService(logger *zap.Logger, chConn clickhouse.Conn, processorConfig ProcessorConfig) *MetricsService {
	cacheConfig := &ristretto.Config[string, struct{}]{
		MaxCost:            50_000,
		NumCounters:        50_000 * 10,
		BufferItems:        64,
		IgnoreInternalCost: true,
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
		SchemaUsage:       req.Msg.SchemaUsage,
		Claims:            claims,
		TotalRequestCount: 1,
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

	var totalRequestCount uint64

	schemaUsage := make([]*graphqlmetricsv1.SchemaUsageInfo, len(req.Msg.Aggregation))
	for i, agg := range req.Msg.Aggregation {
		totalRequestCount += agg.RequestCount
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
		SchemaUsage:       schemaUsage,
		Claims:            claims,
		TotalRequestCount: totalRequestCount,
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

// prepareClickhouseBatches prepares the clickhouse batches for the given batch
// of schema usage items. It returns the operation, metric and request count batches.
// If there is nothing to be processed, the corresponding batch will be nil.
func (s *MetricsService) prepareClickhouseBatches(
	ctx context.Context, insertTime time.Time, batch []SchemaUsageRequestItem,
) (driver.Batch, driver.Batch, driver.Batch) {
	var (
		err               error
		operationBatch    driver.Batch
		metricBatch       driver.Batch
		requestCountBatch driver.Batch

		hasMetrics = false
	)

	if len(batch) == 0 {
		return nil, nil, nil
	}

	if requestCountBatch, err = s.conn.PrepareBatch(ctx, `INSERT INTO gql_metrics_router_requests`); err != nil {
		s.logger.Error("Failed to prepare request count batch", zap.Error(err))
	}

	for _, item := range batch {
		if requestCountBatch != nil {
			err = requestCountBatch.Append(
				insertTime,
				item.Claims.OrganizationID,
				item.Claims.FederatedGraphID,
				item.TotalRequestCount,
			)
			if err != nil {
				s.logger.Error("Failed to append request count to batch", zap.Error(err))
			}
		}

		for _, su := range item.SchemaUsage {
			// We will take care of metrics later, but we can already check if there are any
			// metrics to process to save some time later.
			if getSchemaUsageMetricCount(su) > 0 {
				hasMetrics = true
			}

			if _, exists := s.opGuardCache.Get(su.OperationInfo.Hash); su.RequestDocument == "" || exists {
				continue
			}

			// At this point we know that we have at least one operation to write.
			// Therefore, we need to ensure the operation batch is prepared.
			if operationBatch == nil {
				// We only prepare the operation batch if there are operations to write
				// Aborting the operation will log an error in clickhouse
				operationBatch, err = s.conn.PrepareBatch(ctx, `INSERT INTO gql_metrics_operations`)

				if err != nil {
					s.logger.Error("Failed to prepare operation batch", zap.Error(err))
					continue
				}
			}

			err = operationBatch.Append(
				insertTime,
				su.OperationInfo.Name,
				su.OperationInfo.Hash,
				strings.ToLower(su.OperationInfo.Type.String()),
				su.RequestDocument,
				item.Claims.OrganizationID,
				item.Claims.FederatedGraphID,
			)

			if err != nil {
				s.logger.Error("Failed to append operation to batch", zap.Error(err))
				continue
			}
		}
	}

	// If we do not have any metrics to process, we can return early.
	if !hasMetrics {
		return operationBatch, nil, requestCountBatch
	}

	for _, item := range batch {
		for _, su := range item.SchemaUsage {
			if getSchemaUsageMetricCount(su) == 0 {
				// Skip schema usage items without metrics
				continue
			}

			if metricBatch == nil {
				// If any of the schema usage items has metrics to process, we need to ensure the metric batch is prepared once.
				metricBatch, err = s.conn.PrepareBatch(ctx, `INSERT INTO gql_metrics_schema_usage`)
				if err != nil {
					s.logger.Error("Failed to prepare metric batch", zap.Error(err))
					continue
				}
			}

			err := s.appendUsageMetrics(metricBatch, insertTime, item.Claims, su)
			if err != nil {
				s.logger.Error("Failed to append usage metrics", zap.Error(err))
			}
		}
	}

	return operationBatch, metricBatch, requestCountBatch
}

func (s *MetricsService) appendUsageMetrics(
	metricBatch driver.Batch,
	insertTime time.Time,
	claims *utils.GraphAPITokenClaims,
	schemaUsage *graphqlmetricsv1.SchemaUsageInfo,
) error {
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
			return fmt.Errorf("failed to append field metric to batch: %w", err)
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
			false,
		)
		if err != nil {
			return fmt.Errorf("failed to append argument metric to batch: %w", err)
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
			false,
		)
		if err != nil {
			return fmt.Errorf("failed to append input metric to batch: %w", err)
		}
	}

	return nil
}

func (s *MetricsService) processBatch(_ context.Context, batch []SchemaUsageRequestItem) {
	var storedOperations, storedMetrics int

	insertTime := time.Now()
	insertCtx := context.Background()

	operationsBatch, metricsBatch, requestCountBatch := s.prepareClickhouseBatches(insertCtx, insertTime, batch)

	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()

		if operationsBatch == nil {
			return
		}

		err := retryOnError(insertCtx, s.logger.With(zap.String("component", "operations")), func(ctx context.Context) error {
			if err := operationsBatch.Send(); err != nil {
				return fmt.Errorf("failed to send operation batch: %w", err)
			}

			for _, item := range batch {
				for _, su := range item.SchemaUsage {
					// Add the operation to the cache once it has been written
					// We use a TTL of 30 days to prevent caching of operations that are no in our database
					// due to storage retention policies
					s.opGuardCache.SetWithTTL(su.OperationInfo.Hash, struct{}{}, 1, 30*24*time.Hour)
				}
			}

			s.opGuardCache.Wait()

			storedOperations += operationsBatch.Rows()
			return nil
		})

		if err != nil {
			s.logger.Error("Failed to write operations", zap.Error(err))
		}
	}()

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

	wg.Add(1)
	go func() {
		defer wg.Done()

		if requestCountBatch == nil {
			return
		}

		err := retryOnError(insertCtx, s.logger.With(zap.String("component", "total_requests")), func(ctx context.Context) error {
			if err := requestCountBatch.Send(); err != nil {
				return fmt.Errorf("failed to send total request batch: %w", err)
			}

			return nil
		})

		if err != nil {
			s.logger.Error("Failed to write total requests", zap.Error(err))
		}
	}()

	wg.Wait()

	s.logger.Debug("operations write finished",
		zap.Duration("duration", time.Since(insertTime)),
		zap.Int("stored_operations", storedOperations),
		zap.Int("stored_metrics", storedMetrics),
	)
}

// getSchemaUsageMetricCount returns the total number of entries of a schema usage.
func getSchemaUsageMetricCount(schemaUsage *graphqlmetricsv1.SchemaUsageInfo) int {
	return len(schemaUsage.ArgumentMetrics) + len(schemaUsage.InputMetrics) + len(schemaUsage.TypeFieldMetrics)
}

// calculateRequestCost the total number of entries of metrics batch.
func calculateRequestCost(items []SchemaUsageRequestItem) int {
	total := 0
	for _, item := range items {
		for _, schemaUsage := range item.SchemaUsage {
			total += getSchemaUsageMetricCount(schemaUsage)
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
