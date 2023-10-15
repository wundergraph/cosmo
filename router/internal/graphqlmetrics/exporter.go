package graphqlmetrics

import (
	"connectrpc.com/connect"
	"context"
	"errors"
	"fmt"
	"github.com/cloudflare/backoff"
	graphqlmetricsv12 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1/graphqlmetricsv1connect"
	"go.uber.org/zap"
	brotli "go.withmatt.com/connect-brotli"
	"net/http"
	"sync"
	"time"
)

type Exporter struct {
	queue          *BatchQueue[*graphqlmetricsv12.SchemaUsageInfo]
	settings       *ExporterSettings
	logger         *zap.Logger
	outQueue       <-chan []*graphqlmetricsv12.SchemaUsageInfo
	stopWG         sync.WaitGroup
	client         graphqlmetricsv1connect.GraphQLMetricsServiceClient
	apiToken       string
	cancelShutdown context.CancelFunc
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
	defaultExportRetryInterval    = time.Duration(1) * time.Second
	defaultNumConsumers           = 3
)

type ExporterSettings struct {
	// NumConsumers is the number of consumers from the queue.
	NumConsumers int
	// BatchSize is the maximum number of items to be sent in a single batch.
	BatchSize int
	// QueueSize is the maximum number of batches allowed in queue at a given time.
	QueueSize int
	// Interval is the interval at which the queue is flushed.
	Interval time.Duration
	// Retry is the retry options for the exporter.
	Retry RetryOptions
	// ExportTimeout is the timeout for the export request.
	ExportTimeout time.Duration
}

func NewDefaultExporterSettings() *ExporterSettings {
	return &ExporterSettings{
		NumConsumers:  defaultNumConsumers,
		BatchSize:     defaultMaxBatchItems,
		QueueSize:     defaultMaxQueueSize,
		Interval:      defaultBatchInterval,
		ExportTimeout: defaultExportTimeout,
		Retry: RetryOptions{
			Enabled:     true,
			MaxRetry:    3,
			MaxDuration: defaultExportRetryMaxDuration,
			Interval:    defaultExportRetryInterval,
		},
	}
}

// NewExporter creates a new GraphQL metrics exporter. The collectorEndpoint is the endpoint to which the metrics
// are sent. The apiToken is the token used to authenticate with the collector. The collector supports Brotli compression
// and retries on failure. Underling queue implementation sends batches of metrics at the specified interval and batch size.
func NewExporter(logger *zap.Logger, collectorEndpoint string, apiToken string, settings *ExporterSettings) *Exporter {

	bq := NewBatchQueue[*graphqlmetricsv12.SchemaUsageInfo](&BatchQueueOptions{
		Interval:      settings.Interval,
		MaxBatchItems: settings.BatchSize,
		MaxQueueSize:  settings.QueueSize,
	})

	client := graphqlmetricsv1connect.NewGraphQLMetricsServiceClient(
		http.DefaultClient,
		collectorEndpoint,
		brotli.WithCompression(),
		// Compress requests with Brotli.
		connect.WithSendCompression(brotli.Name),
	)

	return &Exporter{
		queue:    bq,
		outQueue: bq.OutQueue,
		logger:   logger.With(zap.String("component", "graphqlmetrics_exporter")),
		settings: settings,
		client:   client,
		apiToken: apiToken,
	}
}

func (e *Exporter) Validate() error {
	if e.settings.BatchSize <= 0 {
		return errors.New("batch size must be positive")
	}

	if e.settings.QueueSize <= 0 {
		return errors.New("queue size must be positive")
	}

	if e.settings.NumConsumers <= 0 {
		return errors.New("number of queue consumers must be positive")
	}

	if e.settings.Interval <= 0 {
		return errors.New("interval must be positive")
	}

	if e.settings.ExportTimeout <= 0 {
		return errors.New("export timeout must be positive")
	}

	if e.settings.Retry.MaxDuration <= 0 {
		return errors.New("retry max duration must be positive")
	}

	if e.settings.Retry.Interval <= 0 {
		return errors.New("retry interval must be positive")
	}

	if e.settings.Retry.MaxRetry <= 0 {
		return errors.New("retry max retry must be positive")
	}

	return nil
}

// Record records the items as potential metrics to be exported.
func (e *Exporter) Record(item *graphqlmetricsv12.SchemaUsageInfo) bool {
	return e.queue.Enqueue(item)
}

func (e *Exporter) send(ctx context.Context, items []*graphqlmetricsv12.SchemaUsageInfo) error {
	if e.settings.ExportTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, e.settings.ExportTimeout)
		defer cancel()
	}

	batchSize := len(items)
	e.logger.Debug("sending batch", zap.Int("size", batchSize))

	req := connect.NewRequest(&graphqlmetricsv12.PublishGraphQLRequestMetricsRequest{
		SchemaUsage: items,
	})

	req.Header().Set("Authorization", "Bearer "+e.apiToken)

	_, err := e.client.PublishGraphQLMetrics(ctx, req)
	if err != nil {
		e.logger.Debug("Failed to export batch", zap.Error(err), zap.Int("batch_size", batchSize))
		return err
	}

	return err
}

// export sends the batch to the configured endpoint.
func (e *Exporter) export(ctx context.Context, batch []*graphqlmetricsv12.SchemaUsageInfo) error {
	b := backoff.New(e.settings.Retry.MaxDuration, e.settings.Retry.Interval)
	defer b.Reset()

	batchSize := len(batch)

	err := e.send(ctx, batch)
	if err == nil {
		return nil
	}

	var retry int
	var lastErr error

	for retry <= e.settings.Retry.MaxRetry {

		retry++

		// Wait for the specified backoff period
		sleepDuration := b.Duration()

		e.logger.Debug(fmt.Sprintf("Retrying export in %s ...", sleepDuration.String()),
			zap.Int("batch_size", batchSize),
			zap.Int("retry", retry),
			zap.Duration("sleep", sleepDuration),
		)

		// Wait for the specified backoff period
		time.Sleep(sleepDuration)

		err := e.send(ctx, batch)
		if err == nil {
			return nil
		}
	}

	e.logger.Error("Failed to export batch after retries",
		zap.Error(lastErr),
		zap.Int("batch_size", batchSize),
		zap.Int("retries", retry),
	)

	return lastErr
}

// Start starts the exporter.
func (e *Exporter) Start(ctx context.Context) {
	var startWG sync.WaitGroup
	go e.queue.Start(ctx)

	shutdownCtx, cancel := context.WithCancel(context.Background())
	e.cancelShutdown = cancel
	defer cancel()

	for i := 0; i < e.settings.NumConsumers; i++ {
		startWG.Add(1)
		e.stopWG.Add(1)

		go func() {
			defer e.stopWG.Done()

			for {
				select {
				case <-shutdownCtx.Done():
					return
				case batch, more := <-e.outQueue:
					if more {
						_ = e.export(shutdownCtx, Aggregate(batch))
					} else {
						// Close current exporter when queues was closed from producer side
						return
					}
				}
			}
		}()
	}

	startWG.Wait()
}

// Shutdown the exporter but waits until all export jobs has been finished or timeout.
func (e *Exporter) Shutdown(ctx context.Context) error {

	// stop dispatching new items
	e.queue.Stop()

	go func() {
		select {
		// cancel consumers and work immediately
		case <-ctx.Done():
			e.cancelShutdown()
		}
	}()

	// wait for all items to be processed
	e.stopWG.Wait()

	return nil
}
