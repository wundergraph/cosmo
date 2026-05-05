package cacheevents

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"github.com/ClickHouse/clickhouse-go/v2"
	cacheeventsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/cacheevents/v1"
	"github.com/wundergraph/cosmo/graphqlmetrics/pkg/batchprocessor"
	utils "github.com/wundergraph/cosmo/graphqlmetrics/pkg/utils"
	"go.uber.org/zap"
)

var errNotAuthenticated = errors.New("authentication didn't succeed")

// Service is the Connect handler for CacheEventsService. It owns its own
// BatchProcessor instance, separate from the schema-usage path, so a
// cache-events spike does not block schema-usage ingestion.
type Service struct {
	logger    *zap.Logger
	processor *batchprocessor.BatchProcessor[BatchItem]
}

// NewService constructs the Connect handler. It wires a fresh ClickHouse
// writer + batch processor sized for high-volume per-fetch events.
func NewService(logger *zap.Logger, conn clickhouse.Conn, cfg ProcessorConfig) *Service {
	writer := NewWriter(logger, conn)

	bp := batchprocessor.New(batchprocessor.Options[BatchItem]{
		MaxQueueSize:  cfg.MaxQueueSize,
		CostFunc:      batchCost,
		CostThreshold: cfg.MaxBatchSize,
		Interval:      cfg.Interval,
		MaxWorkers:    cfg.MaxWorkers,
		Dispatcher:    writer.ProcessBatch,
	})

	return &Service{
		logger:    logger,
		processor: bp,
	}
}

// PublishEntityCacheEvents accepts a batch of CacheEvent records, validates
// the JWT claims, and enqueues them for async ClickHouse ingestion.
func (s *Service) PublishEntityCacheEvents(
	ctx context.Context,
	req *connect.Request[cacheeventsv1.PublishEntityCacheEventsRequest],
) (*connect.Response[cacheeventsv1.PublishEntityCacheEventsResponse], error) {
	res := connect.NewResponse(&cacheeventsv1.PublishEntityCacheEventsResponse{})

	claims, err := utils.GetClaims(ctx)
	if err != nil {
		return nil, errNotAuthenticated
	}

	if len(req.Msg.Events) == 0 {
		return res, nil
	}

	if err := s.processor.Push(BatchItem{
		Events: req.Msg.Events,
		Claims: claims,
	}); err != nil {
		s.logger.Warn("Cache events queue rejected push", zap.Error(err))
	}

	return res, nil
}

// Shutdown drains the in-flight batch processor.
func (s *Service) Shutdown(timeout time.Duration) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	_ = s.processor.StopAndWait(ctx)
}
