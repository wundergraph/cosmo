package batchprocessor

import (
	"context"
	"errors"
	"sync"
	"time"
)

// Options defines configuration options for the BatchProcessor.
type Options[T any] struct {
	MaxQueueSize  int                        // Size of the internal queue
	CostFunc      func([]T) int              // Function to calculate the cost of a batch
	CostThreshold int                        // Threshold at which the batch should be dispatched
	Dispatcher    func(context.Context, []T) // Function to process the batch
	Interval      time.Duration              // Interval at which the batch should be dispatched if the cost threshold is not met
	MaxWorkers    int                        // Number of worker goroutines
}

// BatchProcessor is a generic batch processing module.
type BatchProcessor[T any] struct {
	queue          chan T
	batch          []T
	costFunction   func([]T) int
	dispatcherFunc func(context.Context, []T)
	interval       time.Duration
	doneChan       chan struct{}
	costThreshold  int
	ctx            context.Context
	cancel         context.CancelFunc
	dispatchChan   chan []T
	workerCount    int
	wg             sync.WaitGroup
}

// New creates a new BatchProcessor with the provided options.
func New[T any](opts Options[T]) *BatchProcessor[T] {
	ctx, cancel := context.WithCancel(context.Background())
	if opts.MaxWorkers <= 0 {
		opts.MaxWorkers = 1 // Ensure at least one worker
	}
	bp := &BatchProcessor[T]{
		queue:          make(chan T, opts.MaxQueueSize),
		batch:          make([]T, 0),
		costFunction:   opts.CostFunc,
		costThreshold:  opts.CostThreshold,
		dispatcherFunc: opts.Dispatcher,
		interval:       opts.Interval,
		doneChan:       make(chan struct{}),
		ctx:            ctx,
		cancel:         cancel,
		dispatchChan:   make(chan []T),
		workerCount:    opts.MaxWorkers,
	}

	// Start the batch manager goroutine
	go bp.runBatchManager()

	// Start worker goroutines
	bp.wg.Add(bp.workerCount)
	for i := 0; i < bp.workerCount; i++ {
		go bp.runWorker()
	}

	return bp
}

// Push adds an item to the queue. Returns an error if the processor is stopped.
func (bp *BatchProcessor[T]) Push(item T) error {
	select {
	case bp.queue <- item:
		return nil
	case <-bp.doneChan: // Processor stopped when doneChan is closed
		return errors.New("batch processor stopped")
	}
}

// StopAndWait stops the processor and waits until all items are processed or the context is done.
func (bp *BatchProcessor[T]) StopAndWait(ctx context.Context) error {
	close(bp.doneChan) // Signal the manager to stop

	// Wait for worker goroutines to finish
	done := make(chan struct{})
	go func() {
		bp.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		// All workers have finished
		return nil
	case <-ctx.Done():
		// Context is canceled; cancel the context for dispatchers
		bp.cancel()

		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil
		} else {
			return ctx.Err()
		}
	}
}

func (bp *BatchProcessor[T]) runBatchManager() {
	ticker := time.NewTicker(bp.interval)
	defer ticker.Stop()

	defer close(bp.queue)        // Stop the queue
	defer close(bp.dispatchChan) // Stop the workers after draining / close the queue

	for {
		select {
		case item := <-bp.queue:
			bp.batch = append(bp.batch, item)
			cost := bp.costFunction(bp.batch)
			if cost >= bp.costThreshold {
				bp.dispatch()
				ticker.Reset(bp.interval) // Reset the timer after dispatching
			}
		case <-ticker.C:
			if len(bp.batch) > 0 {
				bp.dispatch()
			}
		case <-bp.doneChan:
			// Queue closed, process any remaining items
			if len(bp.batch) > 0 {
				bp.dispatch()
			}
			return
		case <-bp.ctx.Done():
			// Context canceled, exit batch manager
			return
		}
	}
}

func (bp *BatchProcessor[T]) dispatch() {
	// Create a copy of the batch to avoid data races
	batchCopy := make([]T, len(bp.batch))
	copy(batchCopy, bp.batch)
	// Reset the batch
	bp.batch = bp.batch[:0]
	// Send the batch to the dispatch channel
	select {
	case bp.dispatchChan <- batchCopy:
	case <-bp.ctx.Done():
	}
}

func (bp *BatchProcessor[T]) runWorker() {
	defer bp.wg.Done()
	for batch := range bp.dispatchChan {
		// Process the batch with the context
		bp.dispatcherFunc(bp.ctx, batch)
	}
}
