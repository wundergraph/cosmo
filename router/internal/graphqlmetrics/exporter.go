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
	queue    *BatchQueue
	settings *ExporterSettings
	logger   *zap.Logger
	outQueue chan []any
	stopWG   sync.WaitGroup
	client   graphqlmetricsv1connect.GraphQLMetricsServiceClient
	apiToken string
}

type RetryOptions struct {
	Enabled     bool
	MaxDuration time.Duration
	Interval    time.Duration
	MaxRetry    int
}

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
}

func NewDefaultExporterSettings() *ExporterSettings {
	return &ExporterSettings{
		NumConsumers: 3,
		BatchSize:    defaultMaxBatchItems,
		QueueSize:    defaultMaxQueueSize,
		Interval:     time.Duration(5) * time.Second,
		Retry: RetryOptions{
			Enabled:     true,
			MaxRetry:    3,
			MaxDuration: time.Duration(15) * time.Second,
			Interval:    time.Duration(3) * time.Second,
		},
	}
}

// NewExporter creates a new GraphQL metrics exporter. The collectorEndpoint is the endpoint to which the metrics
// are sent. The apiToken is the token used to authenticate with the collector. The collector supports Brotli compression
// and retries on failure. Underling queue implementation sends batches of metrics at the specified interval and batch size.
func NewExporter(logger *zap.Logger, collectorEndpoint string, apiToken string, settings *ExporterSettings) *Exporter {

	bq := NewBatchQueue(&BatchQueueOptions{
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

	return nil
}

// Record records the items as potential metrics to be exported.
func (e *Exporter) Record(item *graphqlmetricsv12.SchemaUsageInfo) bool {
	return e.queue.Enqueue(item)
}

// send sends the batch to the configured endpoint.
func (e *Exporter) send(items []*graphqlmetricsv12.SchemaUsageInfo) error {
	b := backoff.New(e.settings.Retry.MaxDuration, e.settings.Retry.Interval)
	defer b.Reset()

	batchSize := len(items)
	e.logger.Debug("sending batch", zap.Int("size", batchSize))

	req := connect.NewRequest(&graphqlmetricsv12.PublishGraphQLRequestMetricsRequest{
		SchemaUsage: items,
	})

	req.Header().Set("Authorization", "Bearer "+e.apiToken)

	_, err := e.client.PublishGraphQLMetrics(context.Background(), req)
	if err == nil {
		return nil
	}

	e.logger.Debug("Failed to export batch", zap.Error(err), zap.Int("batch_size", batchSize))

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

		req := connect.NewRequest(&graphqlmetricsv12.PublishGraphQLRequestMetricsRequest{
			SchemaUsage: items,
		})

		req.Header().Set("Authorization", "Bearer "+e.apiToken)

		_, lastErr = e.client.PublishGraphQLMetrics(context.Background(), req)
		if lastErr == nil {
			return nil
		}
		e.logger.Debug("Failed to export batch",
			zap.Error(lastErr),
			zap.Int("retry", retry),
			zap.Int("batch_size", batchSize),
		)
	}

	e.logger.Error("Failed to export batch after retries",
		zap.Error(lastErr),
		zap.Int("batch_size", batchSize),
		zap.Int("retries", retry),
	)

	return nil
}

// Start starts the exporter.
func (e *Exporter) Start(ctx context.Context) {
	var startWG sync.WaitGroup
	go e.queue.Start(ctx)

	for i := 0; i < e.settings.NumConsumers; i++ {
		startWG.Add(1)
		e.stopWG.Add(1)

		go func() {
			defer e.stopWG.Done()

			for {
				select {
				case batch, more := <-e.outQueue:
					if more {
						if err := e.send(e.Aggregate(batch)); err != nil {
							e.logger.Error("failed to send batch", zap.Error(err))
						}
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

// Aggregate aggregates the same operation metrics into a single metric with the sum of the counts.
func (e *Exporter) Aggregate(items []any) []*graphqlmetricsv12.SchemaUsageInfo {
	hashBuckets := make(map[string][]*graphqlmetricsv12.SchemaUsageInfo)

	for _, item := range items {
		m, ok := item.(*graphqlmetricsv12.SchemaUsageInfo)
		if !ok {
			continue
		}
		hashBuckets[m.OperationInfo.OperationHash] = append(hashBuckets[m.OperationInfo.OperationHash], m)
	}

	aggregated := make([]*graphqlmetricsv12.SchemaUsageInfo, 0, len(hashBuckets))

	for _, hashBucket := range hashBuckets {
		first := hashBucket[0]
		for _, metric := range first.TypeFieldMetrics {
			metric.Count = uint64(len(hashBucket))
		}
		aggregated = append(aggregated, first)
	}

	return aggregated
}

// Stop the exporter but waits until all export jobs has been finished
func (e *Exporter) Stop() {
	// stop dispatching new items
	e.queue.Stop()
	// wait for all items to be processed
	e.stopWG.Wait()
}
