package graphqlmetrics

import (
	"context"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"github.com/cloudflare/backoff"
	graphqlmetrics "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1/graphqlmetricsv1connect"
	"go.uber.org/atomic"
	"go.uber.org/zap"
)

type Exporter struct {
	settings *ExporterSettings
	logger   *zap.Logger
	client   graphqlmetricsv1connect.GraphQLMetricsServiceClient
	apiToken string

	shutdownSignal    chan struct{}
	acceptTrafficSema chan struct{}

	queue           chan *graphqlmetrics.SchemaUsageInfo
	inflightBatches *atomic.Int64

	// exportRequestContext is used to cancel all requests that started before the shutdown
	exportRequestContext context.Context
	// cancelAllExportRequests will be called when we return from the Shutdown func
	// this means that we cancel all requests
	cancelAllExportRequests context.CancelFunc
}

type RetryOptions struct {
	Enabled     bool
	MaxDuration time.Duration
	Interval    time.Duration
	MaxRetry    int
}

const (
	defaultExportTimeout          = time.Duration(10) * time.Second
	defaultExportRetryMaxDuration = time.Duration(10) * time.Second
	defaultExportRetryInterval    = time.Duration(5) * time.Second
	defaultExportMaxRetryAttempts = 5
	defaultMaxBatchItems          = 1024
	defaultMaxQueueSize           = 1024 * 10
	defaultBatchInterval          = time.Duration(10) * time.Second
)

type ExporterSettings struct {
	// BatchSize is the maximum number of items to be sent in a single batch.
	BatchSize int
	// QueueSize is the maximum number of batches allowed in queue at a given time.
	QueueSize int
	// Interval is the interval at which the queue is flushed.
	Interval time.Duration
	// Retry is the retry options for the exporter.
	RetryOptions RetryOptions
	// ExportTimeout is the timeout for the export request.
	ExportTimeout time.Duration
}

func NewDefaultExporterSettings() *ExporterSettings {
	return &ExporterSettings{
		BatchSize:     defaultMaxBatchItems,
		QueueSize:     defaultMaxQueueSize,
		Interval:      defaultBatchInterval,
		ExportTimeout: defaultExportTimeout,
		RetryOptions: RetryOptions{
			Enabled:     true,
			MaxRetry:    defaultExportMaxRetryAttempts,
			MaxDuration: defaultExportRetryMaxDuration,
			Interval:    defaultExportRetryInterval,
		},
	}
}

// NewExporter creates a new GraphQL metrics exporter. The collectorEndpoint is the endpoint to which the metrics
// are sent. The apiToken is the token used to authenticate with the collector. The collector supports Brotli compression
// and retries on failure. Underling queue implementation sends batches of metrics at the specified interval and batch size.
func NewExporter(logger *zap.Logger, client graphqlmetricsv1connect.GraphQLMetricsServiceClient, apiToken string, settings *ExporterSettings) (*Exporter, error) {
	ctx, cancel := context.WithCancel(context.Background())
	e := &Exporter{
		logger:                  logger.With(zap.String("component", "graphqlmetrics_exporter")),
		settings:                settings,
		client:                  client,
		apiToken:                apiToken,
		queue:                   make(chan *graphqlmetrics.SchemaUsageInfo, settings.QueueSize),
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

func (e *Exporter) RecordUsage(usageInfo *graphqlmetrics.SchemaUsageInfo, synchronous bool) (ok bool) {
	if synchronous {
		_ = e.sendItems([]*graphqlmetrics.SchemaUsageInfo{usageInfo})
		return true
	}
	if !e.acceptTraffic() {
		return false
	}
	select {
	case e.queue <- usageInfo:
		return true
	default:
		e.logger.Warn("RecordAsync: Queue is full, dropping item")
		return false
	}
}

func (e *Exporter) sendItems(items []*graphqlmetrics.SchemaUsageInfo) error {
	e.logger.Debug("sending batch", zap.Int("size", len(items)))
	ctx := e.exportRequestContext
	if e.settings.ExportTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(e.exportRequestContext, e.settings.ExportTimeout)
		defer cancel()
	}

	req := connect.NewRequest(&graphqlmetrics.PublishGraphQLRequestMetricsRequest{
		SchemaUsage: items,
	})

	req.Header().Set("Authorization", fmt.Sprintf("Bearer %s", e.apiToken))

	_, err := e.client.PublishGraphQLMetrics(ctx, req)
	if err != nil {
		e.logger.Debug("Failed to export batch", zap.Error(err), zap.Int("batch_size", len(items)))
		return err
	}

	e.logger.Debug("Successfully exported batch", zap.Int("batch_size", len(items)))

	return nil
}

func (e *Exporter) sendAggregation(ctx context.Context, request *graphqlmetrics.PublishAggregatedGraphQLRequestMetricsRequest) error {
	e.logger.Debug("sendAggregation", zap.Int("size", len(request.Aggregation)))
	if e.settings.ExportTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, e.settings.ExportTimeout)
		defer cancel()
	}

	req := connect.NewRequest(request)

	req.Header().Set("Authorization", fmt.Sprintf("Bearer %s", e.apiToken))

	_, err := e.client.PublishAggregatedGraphQLMetrics(ctx, req)
	if err != nil {
		e.logger.Debug("sendAggregation failed", zap.Error(err), zap.Int("batch_size", len(request.Aggregation)))
		return err
	}

	e.logger.Debug("sendAggregation success", zap.Int("batch_size", len(request.Aggregation)))

	return nil
}

func (e *Exporter) prepareAndSendBatch(batch []*graphqlmetrics.SchemaUsageInfo) {
	e.logger.Debug("Exporter.prepareAndSendBatch", zap.Int("batch_size", len(batch)))
	e.inflightBatches.Inc()
	go func() {
		defer e.inflightBatches.Dec()
		e.aggregateAndSendBatch(batch)
	}()
}

// export sends the batch to the configured endpoint.
func (e *Exporter) aggregateAndSendBatch(batch []*graphqlmetrics.SchemaUsageInfo) {
	b := backoff.New(e.settings.RetryOptions.MaxDuration, e.settings.RetryOptions.Interval)
	defer b.Reset()

	request := AggregateSchemaUsageInfoBatch(batch)

	err := e.sendAggregation(e.exportRequestContext, request)
	if err == nil {
		return
	}

	var connectErr *connect.Error
	if errors.As(err, &connectErr) && connectErr.Code() == connect.CodeUnauthenticated {
		e.logger.Error("Failed to export batch due to unauthenticated error, not retrying",
			zap.Error(err),
			zap.Int("batch_size", len(request.Aggregation)),
		)
		return
	}

	if !e.settings.RetryOptions.Enabled {
		e.logger.Error("Failed to export batch",
			zap.Error(err),
			zap.Int("batch_size", len(request.Aggregation)),
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
			zap.Int("batch_size", len(request.Aggregation)),
			zap.Int("retry", retry),
			zap.Duration("sleep", sleepDuration),
		)

		// Wait for the specified backoff period
		time.Sleep(sleepDuration)

		err = e.sendAggregation(e.exportRequestContext, request)
		if err == nil {
			return
		}
		if errors.As(err, &connectErr) && connectErr.Code() == connect.CodeUnauthenticated {
			e.logger.Error("Failed to export batch due to unauthenticated error, not retrying",
				zap.Error(err),
				zap.Int("batch_size", len(request.Aggregation)),
			)
			return
		}
		lastErr = err
	}

	e.logger.Error("Failed to export batch after retries",
		zap.Error(lastErr),
		zap.Int("batch_size", len(request.Aggregation)),
		zap.Int("retries", retry),
	)
}

// start starts the exporter and blocks until the exporter is shutdown.
func (e *Exporter) start() {
	e.logger.Debug("Starting exporter")
	ticker := time.NewTicker(e.settings.Interval)
	defer func() {
		ticker.Stop()
		e.logger.Debug("Exporter stopped")
	}()

	var buffer []*graphqlmetrics.SchemaUsageInfo

	for {
		if buffer == nil {
			buffer = make([]*graphqlmetrics.SchemaUsageInfo, 0, e.settings.BatchSize)
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

func (e *Exporter) drainQueue(buffer []*graphqlmetrics.SchemaUsageInfo) {
	e.logger.Debug("Exporter.closeAndDrainQueue")
	drainedItems := 0
	for {
		select {
		case item := <-e.queue:
			drainedItems++
			buffer = append(buffer, item)
			if len(buffer) == e.settings.BatchSize {
				e.prepareAndSendBatch(buffer)
				buffer = make([]*graphqlmetrics.SchemaUsageInfo, 0, e.settings.BatchSize)
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
