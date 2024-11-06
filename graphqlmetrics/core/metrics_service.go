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

	"connectrpc.com/connect"
	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/avast/retry-go"
	lru "github.com/hashicorp/golang-lru/v2"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/graphqlmetrics/pkg/batch"
	utils "github.com/wundergraph/cosmo/graphqlmetrics/pkg/utils"
	"go.uber.org/zap"
)

var (
	errNotAuthenticated = errors.New("authentication didn't succeed")
	errPublishFailed    = errors.New("failed to publish metrics. Please retry")
)

// SchemaUsageRequestItem is a struct which holds information about the schema usage
// and the JWT claims of a request.
type SchemaUsageRequestItem struct {
	SchemaUsage []*graphqlmetricsv1.SchemaUsageInfo
	Claims      *utils.GraphAPITokenClaims
}

type MetricsService struct {
	logger *zap.Logger

	// conn is the clickhouse connection
	conn clickhouse.Conn

	// opGuardCache is used to prevent duplicate writes of the same operation
	opGuardCache *lru.Cache[string, struct{}]

	processor *batch.Processor[SchemaUsageRequestItem]
}

// NewMetricsService creates a new metrics service
func NewMetricsService(ctx context.Context, logger *zap.Logger, chConn clickhouse.Conn) *MetricsService {
	c, err := lru.New[string, struct{}](25000)
	if err != nil {
		panic(err)
	}

	ms := &MetricsService{
		logger:       logger,
		conn:         chConn,
		opGuardCache: c,
	}

	setupAndStartBatchProcessor(ctx, logger, ms)
	return ms
}

// TODO make this configurable
func setupAndStartBatchProcessor(ctx context.Context, logger *zap.Logger, ms *MetricsService) {
	processor := batch.NewProcessor[SchemaUsageRequestItem](
		logger,
		batch.ProcessorConfig{
			MaxBatchSize: 1000,
			MaxThreshold: 10000,
			MaxQueueSize: 50,
			Interval:     20 * time.Second,
		}, ms.processBatch, calculateRequestCost)

	ms.processor = processor

	go ms.processor.Start(ctx)
}

// saveOperations saves the operation documents to the storage in a batch
func (s *MetricsService) saveOperations(ctx context.Context, insertTime time.Time, schemaUsage []*graphqlmetricsv1.SchemaUsageInfo) (int, error) {

	opBatch, err := s.conn.PrepareBatch(ctx, `INSERT INTO gql_metrics_operations`)
	if err != nil {
		return 0, fmt.Errorf("failed to prepare batch for operations: %w", err)
	}

	hasItems := false

	for _, schemaUsage := range schemaUsage {
		// Skip if there are no request document
		if schemaUsage.RequestDocument == "" {
			continue
		}
		// If the operation is already in the cache, we can skip it and don't write it again
		if _, exists := s.opGuardCache.Get(schemaUsage.OperationInfo.Hash); exists {
			continue
		}
		err := opBatch.Append(
			insertTime,
			schemaUsage.OperationInfo.Name,
			schemaUsage.OperationInfo.Hash,
			strings.ToLower(schemaUsage.OperationInfo.Type.String()),
			schemaUsage.RequestDocument,
		)
		if err != nil {
			return 0, fmt.Errorf("failed to append operation to batch: %w", err)
		}

		hasItems = true
	}

	// if we skipped saving all operations, in case they were already stored (known from the cache),
	// we can abort the batch as there is nothing to write
	if !hasItems {
		return 0, opBatch.Abort()
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

// prepareClickhouseBatches prepares the operation and metric batches for the given schema usage.
func (s *MetricsService) prepareClickhouseBatches(
	ctx context.Context, insertTime time.Time, batch []SchemaUsageRequestItem,
) (operationBatch, metricBatch driver.Batch, err error) {
	opTempBatch, err := s.conn.PrepareBatch(ctx, `INSERT INTO gql_metrics_operations`)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to prepare operation batch for metrics: %w", err)
	}

	metricTempBatch, err := s.conn.PrepareBatch(ctx, `INSERT INTO gql_metrics_schema_usage`)
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
			err := opTempBatch.Append(
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

			added, err := s.appendUsageMetrics(metricTempBatch, insertTime, item.Claims, schemaUsage)
			if err != nil {
				return nil, nil, err
			}

			metricsHasItems = metricsHasItems || added
		}
	}

	// declaring and returning an interface in go which has been assigned a value before will not be nil anymore
	// even when assigning nil
	if operationHasItems {
		operationBatch = opTempBatch
	} else {
		err = opTempBatch.Abort()
	}

	if metricsHasItems {
		metricBatch = metricTempBatch
	} else {
		err = metricTempBatch.Abort()
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

// saveUsageMetrics saves the usage metrics to the storage in a batch
func (s *MetricsService) saveUsageMetrics(ctx context.Context, insertTime time.Time, claims *utils.GraphAPITokenClaims, schemaUsage []*graphqlmetricsv1.SchemaUsageInfo) (int, error) {

	metricBatch, err := s.conn.PrepareBatch(ctx, `INSERT INTO gql_metrics_schema_usage`)
	if err != nil {
		return 0, fmt.Errorf("failed to prepare batch for metrics: %w", err)
	}

	hasItems := false

	for _, schemaUsage := range schemaUsage {
		added, err := s.appendUsageMetrics(metricBatch, insertTime, claims, schemaUsage)
		if err != nil {
			return 0, err
		}

		hasItems = hasItems || added
	}

	if !hasItems {
		return 0, metricBatch.Abort()
	}

	if err := metricBatch.Send(); err != nil {
		return 0, fmt.Errorf("failed to send metrics batch: %w", err)
	}

	return metricBatch.Rows(), nil
}

func (s *MetricsService) processBatch(batch []SchemaUsageRequestItem) error {
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
		s.logger.Error("Failed to prepare metrics batches", zap.Error(err))
		return err
	}

	wg := sync.WaitGroup{}

	wg.Add(2)
	go func() {
		defer wg.Done()

		if operationsBatch == nil {
			return
		}

		err = retryOnError(insertCtx, s.logger.With(zap.String("component", "operations")), func(ctx context.Context) error {
			if err := operationsBatch.Send(); err != nil {
				return fmt.Errorf("failed to send operation batch: %w", err)
			}

			for _, su := range aggregated {
				// Add the operation to the cache once it has been written
				s.opGuardCache.Add(su.OperationInfo.Hash, struct{}{})
			}

			storedOperations += operationsBatch.Rows()
			return nil
		})

		if err != nil {
			s.logger.Error("Failed to write operations", zap.Error(err))
		}
	}()

	go func() {
		defer wg.Done()

		if metricsBatch == nil {
			return
		}

		err = retryOnError(insertCtx, s.logger.With(zap.String("component", "metrics")), func(ctx context.Context) error {
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

	wg.Wait()

	s.logger.Debug("operations write finished",
		zap.Duration("duration", time.Since(insertTime)),
		zap.Int("storedOperations", storedOperations),
		zap.Int("storedMetrics", storedMetrics),
	)

	return nil
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

	if len(req.Msg.SchemaUsage) == 0 {
		return res, nil
	}

	if err := s.processor.Enqueue(ctx, SchemaUsageRequestItem{
		SchemaUsage: req.Msg.SchemaUsage,
		Claims:      claims,
	}); err != nil {
		requestLogger.Error("Failed to enqueue request", zap.Error(err))
		return nil, errPublishFailed
	}

	return res, nil
}

func (s *MetricsService) PublishAggregatedGraphQLMetrics(ctx context.Context, req *connect.Request[graphqlmetricsv1.PublishAggregatedGraphQLRequestMetricsRequest]) (*connect.Response[graphqlmetricsv1.PublishAggregatedGraphQLRequestMetricsResponse], error) {
	requestLogger := s.logger.With(zap.String("procedure", req.Spec().Procedure))
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

	if err := s.processor.Enqueue(ctx, SchemaUsageRequestItem{
		SchemaUsage: schemaUsage,
		Claims:      claims,
	}); err != nil {
		requestLogger.Error("Failed to enqueue request", zap.Error(err))
		return nil, errPublishFailed
	}

	return res, nil
}

func (s *MetricsService) Shutdown() {
	s.processor.Stop()
}

// calculateRequestCost the total number of entries of metrics batch.
func calculateRequestCost(item SchemaUsageRequestItem) int {
	total := 0
	for _, schemaUsage := range item.SchemaUsage {
		total += len(schemaUsage.ArgumentMetrics) + len(schemaUsage.InputMetrics) + len(schemaUsage.TypeFieldMetrics)
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
