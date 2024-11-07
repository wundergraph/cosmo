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
	stopChan       chan struct{}
	doneChan       chan struct{}
	costThreshold  int
	mutex          sync.Mutex
	ctx            context.Context
	cancel         context.CancelFunc
	workerCount    int
	wg             sync.WaitGroup
}

// New creates a new BatchProcessor with the provided options.
func New[T any](opts Options[T]) *BatchProcessor[T] {
	ctx, cancel := context.WithCancel(context.Background())
	bp := &BatchProcessor[T]{
		queue:          make(chan T, opts.MaxQueueSize),
		batch:          make([]T, 0),
		costFunction:   opts.CostFunc,
		costThreshold:  opts.CostThreshold,
		dispatcherFunc: opts.Dispatcher,
		interval:       opts.Interval,
		stopChan:       make(chan struct{}),
		doneChan:       make(chan struct{}),
		ctx:            ctx,
		cancel:         cancel,
		workerCount:    opts.MaxWorkers,
	}
	if bp.workerCount <= 0 {
		bp.workerCount = 1 // Ensure at least one worker
	}
	bp.wg.Add(bp.workerCount)
	for i := 0; i < bp.workerCount; i++ {
		go bp.runWorker()
	}
	go bp.monitor()
	return bp
}

// Push adds an item to the queue. Blocks if the queue is full.
func (bp *BatchProcessor[T]) Push(item T) {
	bp.queue <- item
}

// StopAndWait stops the processor and waits until all items are processed or the context is done.
// It will call bp.cancel() only after ctx is canceled.
func (bp *BatchProcessor[T]) StopAndWait(ctx context.Context) error {
	// Signal the processor to stop accepting new items
	close(bp.stopChan)
	select {
	case <-bp.doneChan:
		// Processor has finished processing all items
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

func (bp *BatchProcessor[T]) runWorker() {
	defer bp.wg.Done()
	for {
		select {
		case item, ok := <-bp.queue:
			if !ok {
				return
			}
			bp.addToBatch(item)
		case <-bp.stopChan:
			return
		case <-bp.ctx.Done():
			return
		}
	}
}

func (bp *BatchProcessor[T]) addToBatch(item T) {
	bp.mutex.Lock()
	defer bp.mutex.Unlock()
	bp.batch = append(bp.batch, item)
	cost := bp.costFunction(bp.batch)
	if cost >= bp.costThreshold {
		bp.dispatch()
	}
}

func (bp *BatchProcessor[T]) monitor() {
	ticker := time.NewTicker(bp.interval)
	defer ticker.Stop()
	defer close(bp.doneChan)

	for {
		select {
		case <-ticker.C:
			bp.mutex.Lock()
			if len(bp.batch) > 0 {
				bp.dispatch()
			}
			bp.mutex.Unlock()
		case <-bp.stopChan:
			// Wait for workers to finish
			bp.wg.Wait()
			// Dispatch any remaining items
			bp.mutex.Lock()
			if len(bp.batch) > 0 {
				bp.dispatch()
			}
			bp.mutex.Unlock()
			return
		case <-bp.ctx.Done():
			// Context canceled, exit monitor
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
	// Process the batch with the context
	bp.dispatcherFunc(bp.ctx, batchCopy)
}
