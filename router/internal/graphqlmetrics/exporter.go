package graphqlmetrics

import (
	"context"
	"errors"
	graphqlmetricsv12 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"go.uber.org/zap"
	"sync"
	"time"
)

type Exporter struct {
	queue    *BatchQueue
	settings *ExporterSettings
	logger   *zap.Logger
	outQueue chan []any
	stopWG   sync.WaitGroup
}

type ExporterSettings struct {
	// NumConsumers is the number of consumers from the queue.
	NumConsumers int
	// BatchSize is the maximum number of items to be sent in a single batch.
	BatchSize int
	// QueueSize is the maximum number of batches allowed in queue at a given time.
	QueueSize int
}

func NewDefaultExporterSettings() *ExporterSettings {
	return &ExporterSettings{
		NumConsumers: 3,
		BatchSize:    1024,
		QueueSize:    1024,
	}
}

func NewExporter(logger *zap.Logger, settings *ExporterSettings) *Exporter {

	bq := NewBatchQueue(&BatchQueueOptions{
		Interval:      time.Duration(5) * time.Second,
		MaxBatchItems: settings.BatchSize,
		MaxQueueSize:  settings.QueueSize,
	})

	return &Exporter{
		queue:    bq,
		outQueue: bq.OutQueue,
		logger:   logger,
		settings: settings,
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
	// TODO: send to metrics server
	return nil
}

// Start starts the exporter.
func (e *Exporter) Start(ctx context.Context) {

	go e.queue.Start(ctx)

	for i := 0; i < e.settings.NumConsumers; i++ {
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
}

// Aggregate aggregates the same operation metrics into a single metric with the sum of the counts.
func (e *Exporter) Aggregate(items []any) []*graphqlmetricsv12.SchemaUsageInfo {
	aggregatedMap := make(map[string]*graphqlmetricsv12.SchemaUsageInfo)

	for _, item := range items {
		m, ok := item.(*graphqlmetricsv12.SchemaUsageInfo)
		if !ok {
			continue
		}
		if existing, ok := aggregatedMap[m.OperationInfo.OperationHash]; ok {
			for _, metric := range existing.TypeFieldMetrics {
				// Just sum it up because both are the same
				metric.Count += metric.Count
			}
		} else {
			aggregatedMap[m.OperationInfo.OperationHash] = m
		}
	}

	aggregated := make([]*graphqlmetricsv12.SchemaUsageInfo, 0, len(aggregatedMap))

	for _, item := range aggregatedMap {
		aggregated = append(aggregated, item)
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
