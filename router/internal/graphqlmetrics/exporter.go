package graphqlmetrics

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/cloudflare/backoff"
	"go.uber.org/atomic"
	"go.uber.org/zap"
)

// Exporter is a generic, thread-safe batch exporter that queues items and sends them
// to a sink in batches at regular intervals or when the batch size is reached.
// It supports configurable retry logic and graceful shutdown.
type Exporter[T any] struct {
	settings          *ExporterSettings
	logger            *zap.Logger
	sink              Sink[T]
	isRetryableError  SinkErrorHandler
	shutdownSignal    chan struct{}
	acceptTrafficSema chan struct{}
	queue             chan T
	inflightBatches   *atomic.Int64
	batchBufferPool   *sync.Pool // Pool for batch slice buffers to reduce allocations

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

// NewExporter creates a new generic batch exporter.
// The sink is responsible for actually sending the batches to their destination.
// The isRetryableError function determines whether failed exports should be retried.
// If isRetryableError is nil, all errors are considered retryable.
func NewExporter[T any](logger *zap.Logger, sink Sink[T], isRetryableError SinkErrorHandler, settings *ExporterSettings) (*Exporter[T], error) {
	if sink == nil {
		return nil, fmt.Errorf("sink cannot be nil")
	}

	ctx, cancel := context.WithCancel(context.Background())

	// Default error handler treats all errors as retryable
	if isRetryableError == nil {
		isRetryableError = func(err error) bool { return true }
	}

	e := &Exporter[T]{
		logger:                  logger.With(zap.String("component", "exporter")),
		settings:                settings,
		sink:                    sink,
		isRetryableError:        isRetryableError,
		queue:                   make(chan T, settings.QueueSize),
		shutdownSignal:          make(chan struct{}),
		acceptTrafficSema:       make(chan struct{}),
		inflightBatches:         atomic.NewInt64(0),
		exportRequestContext:    ctx,
		cancelAllExportRequests: cancel,
		batchBufferPool: &sync.Pool{
			New: func() any {
				// Pre-allocate slice with batch size capacity
				buffer := make([]T, 0, settings.BatchSize)
				return &buffer
			},
		},
	}
	if err := e.validate(); err != nil {
		return nil, err
	}
	go e.start()
	return e, nil
}

func (e *Exporter[T]) validate() error {
	if e.settings.BatchSize <= 0 {
		return fmt.Errorf("batch size must be positive")
	}

	if e.settings.QueueSize <= 0 {
		return fmt.Errorf("queue size must be positive")
	}

	if e.settings.Interval <= 0 {
		return fmt.Errorf("interval must be positive")
	}

	if e.settings.ExportTimeout <= 0 {
		return fmt.Errorf("export timeout must be positive")
	}

	if e.settings.RetryOptions.MaxDuration <= 0 {
		return fmt.Errorf("retry max duration must be positive")
	}

	if e.settings.RetryOptions.Interval <= 0 {
		return fmt.Errorf("retry interval must be positive")
	}

	if e.settings.RetryOptions.MaxRetry <= 0 {
		return fmt.Errorf("retry max retry must be positive")
	}

	return nil
}

// getBatchBuffer retrieves a batch buffer from the pool.
// The returned buffer is ready to use with zero length and appropriate capacity.
func (e *Exporter[T]) getBatchBuffer() []T {
	bufferPtr := e.batchBufferPool.Get().(*[]T)
	buffer := *bufferPtr
	// Ensure the buffer is empty (should already be, but be defensive)
	return buffer[:0]
}

// putBatchBuffer returns a batch buffer to the pool for reuse.
// The buffer is reset to zero length before being pooled.
func (e *Exporter[T]) putBatchBuffer(buffer []T) {
	// Reset the slice to zero length while keeping capacity
	buffer = buffer[:0]
	e.batchBufferPool.Put(&buffer)
}

func (e *Exporter[T]) acceptTraffic() bool {
	// while the channel is not closed, the select will always return the default case
	// once it's closed, the select will always return _,false (closed channel) from the channel
	select {
	case <-e.acceptTrafficSema:
		return false
	default:
		return true
	}
}

// Record adds an item to the export queue.
// If synchronous is true, the item is sent immediately in the current goroutine.
// Otherwise, it's added to the queue for batch processing.
// Returns false if the queue is full or if the exporter is shutting down.
func (e *Exporter[T]) Record(item T, synchronous bool) (ok bool) {
	if synchronous {
		var batch []T
		batch = append(batch, item)
		_ = e.exportBatch(batch)
		return true
	}
	if !e.acceptTraffic() {
		return false
	}
	select {
	case e.queue <- item:
		return true
	default:
		e.logger.Warn("Record: Queue is full, dropping item")
		return false
	}
}

// exportBatch sends a batch of items to the sink with timeout handling.
func (e *Exporter[T]) exportBatch(batch []T) error {
	if len(batch) == 0 {
		return nil
	}

	e.logger.Debug("Exporting batch", zap.Int("size", len(batch)))

	ctx := e.exportRequestContext
	if e.settings.ExportTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(e.exportRequestContext, e.settings.ExportTimeout)
		defer cancel()
	}

	err := e.sink.Export(ctx, batch)
	if err != nil {
		e.logger.Debug("Failed to export batch", zap.Error(err), zap.Int("batch_size", len(batch)))
		return err
	}

	e.logger.Debug("Successfully exported batch", zap.Int("batch_size", len(batch)))
	return nil
}

// prepareAndSendBatch starts a goroutine to export the batch with retry logic.
// The goroutine takes ownership of the batch slice and will return it to the pool when done.
func (e *Exporter[T]) prepareAndSendBatch(batch []T) {
	e.logger.Debug("Preparing to send batch", zap.Int("batch_size", len(batch)))
	e.inflightBatches.Inc()
	go func() {
		defer e.inflightBatches.Dec()
		defer e.putBatchBuffer(batch) // Return buffer to pool after export completes
		e.exportBatchWithRetry(batch)
	}()
}

// exportBatchWithRetry attempts to export a batch with exponential backoff retry logic.
func (e *Exporter[T]) exportBatchWithRetry(batch []T) {
	b := backoff.New(e.settings.RetryOptions.MaxDuration, e.settings.RetryOptions.Interval)
	defer b.Reset()

	err := e.exportBatch(batch)
	if err == nil {
		return
	}

	// Check if error is retryable
	if !e.isRetryableError(err) {
		e.logger.Error("Failed to export batch with non-retryable error",
			zap.Error(err),
			zap.Int("batch_size", len(batch)),
		)
		return
	}

	if !e.settings.RetryOptions.Enabled {
		e.logger.Error("Failed to export batch, retries disabled",
			zap.Error(err),
			zap.Int("batch_size", len(batch)),
		)
		return
	}

	var retry int
	var lastErr error

	for retry < e.settings.RetryOptions.MaxRetry {
		retry++

		// Wait for the specified backoff period
		sleepDuration := b.Duration()

		e.logger.Debug("Retrying export after backoff",
			zap.Int("batch_size", len(batch)),
			zap.Int("retry", retry),
			zap.Duration("sleep", sleepDuration),
		)

		time.Sleep(sleepDuration)

		err = e.exportBatch(batch)
		if err == nil {
			e.logger.Debug("Export succeeded after retry", zap.Int("retry", retry))
			return
		}

		// Check if the new error is retryable
		if !e.isRetryableError(err) {
			e.logger.Error("Failed to export batch with non-retryable error during retry",
				zap.Error(err),
				zap.Int("batch_size", len(batch)),
				zap.Int("retry", retry),
			)
			return
		}

		lastErr = err
	}

	e.logger.Error("Failed to export batch after all retries",
		zap.Error(lastErr),
		zap.Int("batch_size", len(batch)),
		zap.Int("retries", retry),
	)
}

// start starts the exporter and blocks until the exporter is shutdown.
func (e *Exporter[T]) start() {
	e.logger.Debug("Starting exporter")
	ticker := time.NewTicker(e.settings.Interval)
	defer func() {
		ticker.Stop()
		e.logger.Debug("Exporter stopped")
	}()

	var buffer []T

	for {
		if buffer == nil {
			// Get a buffer from the pool instead of allocating
			buffer = e.getBatchBuffer()
		}
		select {
		case <-ticker.C:
			e.logger.Debug("Tick: flushing buffer", zap.Int("buffer_size", len(buffer)))
			if len(buffer) > 0 {
				e.prepareAndSendBatch(buffer)
				// Ownership transferred to goroutine, get a new buffer
				buffer = nil
			}
		case item := <-e.queue:
			buffer = append(buffer, item)
			if len(buffer) == e.settings.BatchSize {
				e.logger.Debug("Buffer full, sending batch", zap.Int("batch_size", len(buffer)))
				e.prepareAndSendBatch(buffer)
				// Ownership transferred to goroutine, get a new buffer
				buffer = nil
			}
		case <-e.shutdownSignal:
			e.logger.Debug("Shutdown signal received, draining queue")
			e.drainQueue(buffer)
			return
		}
	}
}

// drainQueue processes all remaining items in the queue during shutdown.
func (e *Exporter[T]) drainQueue(buffer []T) {
	e.logger.Debug("Draining queue")
	drainedItems := 0
	for {
		select {
		case item := <-e.queue:
			drainedItems++
			buffer = append(buffer, item)
			if len(buffer) == e.settings.BatchSize {
				e.prepareAndSendBatch(buffer)
				// Ownership transferred to goroutine, get a new buffer
				buffer = e.getBatchBuffer()
			}
		default:
			if len(buffer) > 0 {
				e.prepareAndSendBatch(buffer)
				// Ownership transferred to goroutine
			}
			e.logger.Debug("Queue drained", zap.Int("drained_items", drainedItems))
			return
		}
	}
}

// Shutdown gracefully shuts down the exporter.
// It stops accepting new items, drains the queue, waits for in-flight batches to complete,
// and closes the sink. If the context is cancelled, shutdown is forced.
func (e *Exporter[T]) Shutdown(ctx context.Context) error {
	e.logger.Debug("Shutdown started")

	ticker := time.NewTicker(time.Millisecond * 100)
	defer func() {
		ticker.Stop()
		// Cancel all export requests
		e.cancelAllExportRequests()
		// Close the sink
		if err := e.sink.Close(ctx); err != nil {
			e.logger.Error("Error closing sink", zap.Error(err))
		}
		e.logger.Debug("Shutdown complete")
	}()

	// First close the acceptTrafficSema to stop accepting new items
	close(e.acceptTrafficSema)
	// Then trigger the shutdown signal for the exporter goroutine to stop
	// It will drain the queue and send the remaining items
	close(e.shutdownSignal)

	// Poll the inflightBatches to wait for all in-flight batches to finish or timeout
	// We're not using a wait group here because you can't wait for a wait group with a timeout
	for {
		select {
		case <-ctx.Done():
			e.logger.Warn("Shutdown cancelled by context", zap.Error(ctx.Err()))
			return ctx.Err()
		case <-ticker.C:
			if e.inflightBatches.Load() == 0 {
				return nil
			}
		}
	}
}
