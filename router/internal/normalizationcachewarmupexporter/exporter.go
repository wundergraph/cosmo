package normalizationcachewarmupexporter

import (
	"context"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"github.com/cloudflare/backoff"
	graphqlmetrics "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1/graphqlmetricsv1connect"
	"github.com/wundergraph/cosmo/router/internal/exporter"
	"go.uber.org/atomic"
	"go.uber.org/zap"
)

type Exporter struct {
	settings *exporter.Settings
	logger   *zap.Logger
	client   graphqlmetricsv1connect.GraphQLMetricsServiceClient
	apiToken string

	shutdownSignal    chan struct{}
	acceptTrafficSema chan struct{}

	queue           chan *graphqlmetrics.NormalizationCacheWarmupData
	inflightBatches *atomic.Int64

	// exportRequestContext is used to cancel all requests that started before the shutdown
	exportRequestContext context.Context
	// cancelAllExportRequests will be called when we return from the Shutdown func
	// this means that we cancel all requests
	cancelAllExportRequests context.CancelFunc
}

// NewExporter creates a new GraphQL metrics exporter. The collectorEndpoint is the endpoint to which the metrics
// are sent. The apiToken is the token used to authenticate with the collector. The collector supports Brotli compression
// and retries on failure. Underling queue implementation sends batches of metrics at the specified interval and batch size.
func NewExporter(logger *zap.Logger, client graphqlmetricsv1connect.GraphQLMetricsServiceClient, apiToken string, settings *exporter.Settings) (*Exporter, error) {
	ctx, cancel := context.WithCancel(context.Background())
	e := &Exporter{
		logger:                  logger.With(zap.String("component", "graphqlmetrics_exporter")),
		settings:                settings,
		client:                  client,
		apiToken:                apiToken,
		queue:                   make(chan *graphqlmetrics.NormalizationCacheWarmupData, settings.QueueSize),
		shutdownSignal:          make(chan struct{}),
		acceptTrafficSema:       make(chan struct{}),
		inflightBatches:         atomic.NewInt64(0),
		exportRequestContext:    ctx,
		cancelAllExportRequests: cancel,
	}
	if err := e.validate(); err != nil {
		return nil, err
	}
	go e.start()
	return e, nil
}

func (e *Exporter) validate() error {
	if e.settings.BatchSize <= 0 {
		return errors.New("batch size must be positive")
	}

	if e.settings.QueueSize <= 0 {
		return errors.New("queue size must be positive")
	}

	if e.settings.Interval <= 0 {
		return errors.New("interval must be positive")
	}

	if e.settings.ExportTimeout <= 0 {
		return errors.New("export timeout must be positive")
	}

	if e.settings.RetryOptions.MaxDuration <= 0 {
		return errors.New("retry max duration must be positive")
	}

	if e.settings.RetryOptions.Interval <= 0 {
		return errors.New("retry interval must be positive")
	}

	if e.settings.RetryOptions.MaxRetry <= 0 {
		return errors.New("retry max retry must be positive")
	}

	return nil
}

func (e *Exporter) acceptTraffic() bool {
	// while the channel is not closed, the select will always return the default case
	// once it's closed, the select will always return _,false (closed channel) from the channel
	select {
	case <-e.acceptTrafficSema:
		return false
	default:
		return true
	}
}

func (e *Exporter) RecordUsage(data *graphqlmetrics.NormalizationCacheWarmupData, synchronous bool) (ok bool) {
	if synchronous {
		_ = e.send(&graphqlmetrics.NormalizationCacheWarmupDataAggregation{
			Operations: map[uint64]*graphqlmetrics.NormalizationCacheWarmupData{
				data.Query.Hash: data,
			},
		})
		return true
	}
	if !e.acceptTraffic() {
		return false
	}
	select {
	case e.queue <- data:
		return true
	default:
		e.logger.Warn("RecordAsync: Queue is full, dropping item")
		return false
	}
}

func (e *Exporter) send(aggregation *graphqlmetrics.NormalizationCacheWarmupDataAggregation) error {
	e.logger.Debug("sending item")
	ctx := e.exportRequestContext
	if e.settings.ExportTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(e.exportRequestContext, e.settings.ExportTimeout)
		defer cancel()
	}

	req := connect.NewRequest(&graphqlmetrics.PublishNormalizationCacheWarmupDataRequest{
		Aggregation: aggregation,
	})

	req.Header().Set("Authorization", fmt.Sprintf("Bearer %s", e.apiToken))

	_, err := e.client.PublishNormalizationCacheWarmupData(ctx, req)
	if err != nil {
		e.logger.Debug("Failed to export batch", zap.Error(err))
		return err
	}

	e.logger.Debug("Successfully exported batch")

	return nil
}

func (e *Exporter) prepareAndSendBatch(batch []*graphqlmetrics.NormalizationCacheWarmupData) {
	e.logger.Debug("Exporter.prepareAndSendBatch", zap.Int("batch_size", len(batch)))
	e.inflightBatches.Inc()
	go func() {
		defer e.inflightBatches.Dec()
		e.aggregateAndSendBatch(batch)
	}()
}

// export sends the batch to the configured endpoint.
func (e *Exporter) aggregateAndSendBatch(batch []*graphqlmetrics.NormalizationCacheWarmupData) {
	b := backoff.New(e.settings.RetryOptions.MaxDuration, e.settings.RetryOptions.Interval)
	defer b.Reset()

	request := e.aggregate(batch)

	err := e.send(request)
	if err == nil {
		return
	}

	var connectErr *connect.Error
	if errors.As(err, &connectErr) && connectErr.Code() == connect.CodeUnauthenticated {
		e.logger.Error("Failed to export batch due to unauthenticated error, not retrying",
			zap.Error(err),
			zap.Int("batch_size", len(request.Operations)),
		)
		return
	}

	if !e.settings.RetryOptions.Enabled {
		e.logger.Error("Failed to export batch",
			zap.Error(err),
			zap.Int("batch_size", len(request.Operations)),
		)
		return
	}

	var retry int
	var lastErr error

	for retry <= e.settings.RetryOptions.MaxRetry {

		retry++

		// Wait for the specified backoff period
		sleepDuration := b.Duration()

		e.logger.Debug(fmt.Sprintf("Retrying export in %s ...", sleepDuration.String()),
			zap.Int("batch_size", len(request.Operations)),
			zap.Int("retry", retry),
			zap.Duration("sleep", sleepDuration),
		)

		// Wait for the specified backoff period
		time.Sleep(sleepDuration)

		err = e.send(request)
		if err == nil {
			return
		}
		if errors.As(err, &connectErr) && connectErr.Code() == connect.CodeUnauthenticated {
			e.logger.Error("Failed to export batch due to unauthenticated error, not retrying",
				zap.Error(err),
				zap.Int("batch_size", len(request.Operations)),
			)
			return
		}
		lastErr = err
	}

	e.logger.Error("Failed to export batch after retries",
		zap.Error(lastErr),
		zap.Int("batch_size", len(request.Operations)),
		zap.Int("retries", retry),
	)
}

func (e *Exporter) aggregate(batch []*graphqlmetrics.NormalizationCacheWarmupData) *graphqlmetrics.NormalizationCacheWarmupDataAggregation {
	aggregation := &graphqlmetrics.NormalizationCacheWarmupDataAggregation{
		Operations: make(map[uint64]*graphqlmetrics.NormalizationCacheWarmupData),
	}

	for _, item := range batch {
		if existing, ok := aggregation.Operations[item.Query.Hash]; ok {
			for k, v := range item.VariableVariations {
				existing.VariableVariations[k] = v
			}
		} else {
			aggregation.Operations[item.Query.Hash] = item
		}
	}

	return aggregation
}

// start starts the exporter and blocks until the exporter is shutdown.
func (e *Exporter) start() {
	e.logger.Debug("Starting exporter")
	ticker := time.NewTicker(e.settings.Interval)
	defer func() {
		ticker.Stop()
		e.logger.Debug("Exporter stopped")
	}()

	var buffer []*graphqlmetrics.NormalizationCacheWarmupData

	for {
		if buffer == nil {
			buffer = make([]*graphqlmetrics.NormalizationCacheWarmupData, 0, e.settings.BatchSize)
		}
		select {
		case <-ticker.C:
			e.logger.Debug("Exporter.start: tick")
			if len(buffer) > 0 {
				e.prepareAndSendBatch(buffer)
				buffer = nil
			}
		case item := <-e.queue:
			e.logger.Debug("Exporter.start: item")
			buffer = append(buffer, item)
			if len(buffer) == e.settings.BatchSize {
				e.prepareAndSendBatch(buffer)
				buffer = nil
			}
		case <-e.shutdownSignal:
			e.logger.Debug("Exporter.start: shutdown")
			e.drainQueue(buffer)
			return
		}
	}
}

func (e *Exporter) drainQueue(buffer []*graphqlmetrics.NormalizationCacheWarmupData) {
	e.logger.Debug("Exporter.closeAndDrainQueue")
	drainedItems := 0
	for {
		select {
		case item := <-e.queue:
			drainedItems++
			buffer = append(buffer, item)
			if len(buffer) == e.settings.BatchSize {
				e.prepareAndSendBatch(buffer)
				buffer = make([]*graphqlmetrics.NormalizationCacheWarmupData, 0, e.settings.BatchSize)
			}
		default:
			if len(buffer) > 0 {
				e.prepareAndSendBatch(buffer)
			}
			e.logger.Debug("Exporter.closeAndDrainQueue: done", zap.Int("drained_items", drainedItems))
			return
		}
	}
}

// Shutdown the exporter but waits until all export jobs has been finished or timeout.
// If the context is canceled, the exporter will be shutdown immediately.
func (e *Exporter) Shutdown(ctx context.Context) error {
	ticker := time.NewTicker(time.Millisecond * 100)
	defer func() {
		ticker.Stop()
		// cancel all requests
		e.cancelAllExportRequests()
		e.logger.Debug("Exporter.Shutdown: done")
	}()

	// first close the acceptTrafficSema to stop accepting new items
	close(e.acceptTrafficSema)
	// then trigger the shutdown signal for the exporter goroutine to stop
	// it will then drain the queue and send the remaining items
	close(e.shutdownSignal)

	// we're polling the inflightBatches to wait for all inflight batches to finish or timeout
	// we're not using a wait group here because you can't wait for a wait group with a timeout

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if e.inflightBatches.Load() == 0 {
				return nil
			}
		}
	}
}
