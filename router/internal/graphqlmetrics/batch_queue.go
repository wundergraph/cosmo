package graphqlmetrics

import (
	"time"
)

const (
	defaultBatchInterval = time.Duration(10) * time.Second
	defaultMaxBatchItems = 256
	defaultMaxQueueSize  = 4096
)

// BatchQueueOptions configure time interval and set a batch limit.
type BatchQueueOptions struct {
	Interval      time.Duration // wait time when batch quantity is insufficient
	MaxBatchItems int           // maximum items per batch
	MaxQueueSize  int           // maximum queue size
}

func (o *BatchQueueOptions) ensureDefaults() {
	if o.Interval == 0 {
		o.Interval = defaultBatchInterval
	}

	if o.MaxBatchItems == 0 {
		o.MaxQueueSize = defaultMaxBatchItems
	}

	if o.MaxQueueSize == 0 {
		o.MaxQueueSize = defaultMaxQueueSize
	}
}

// BatchQueue coordinates dispatching of queue items by time intervals
// or immediately after the batching limit is met. Items are enqueued without blocking
// and all items are buffered unless the queue is stopped forcefully with the stop() context.
type BatchQueue[T any] struct {
	config   *BatchQueueOptions
	timer    *time.Timer
	inQueue  chan T
	OutQueue chan []T
}

// NewBatchQueue returns an initialized instance of BatchQueue.
// Items are enqueued without blocking.
// The queue is dispatched by time intervals or immediately after the batching limit is met.
// Batches can be read from the OutQueue channel.
func NewBatchQueue[T any](config *BatchQueueOptions) *BatchQueue[T] {
	if config == nil {
		config = new(BatchQueueOptions)
	}
	config.ensureDefaults()

	bq := &BatchQueue[T]{
		config:   config,
		inQueue:  make(chan T, config.MaxQueueSize),
		OutQueue: make(chan []T, config.MaxQueueSize/config.MaxBatchItems),
	}

	return bq
}

// Enqueue adds an item to the queue. Returns false if the queue is stopped or not ready to accept items
func (b *BatchQueue[T]) Enqueue(item T) bool {
	select {
	case b.inQueue <- item:
		return true
	default:
		return false
	}
}

func (b *BatchQueue[T]) tick() {
	b.timer.Reset(b.config.Interval)
}

// dispatch sends items to the OutQueue. Only one dispatcher must be active at a time.
func (b *BatchQueue[T]) dispatch() {

	for {
		var items []T
		var stopped bool

		for {
			select {
			case <-b.timer.C:
				goto done
			case item, ok := <-b.inQueue:
				// queue is stopped
				if !ok {
					stopped = true
					goto done
				}

				items = append(items, item)

				// batch limit reached, dispatch
				if len(items) == b.config.MaxBatchItems {
					goto done
				}
			}
		}

	done:
		// skip empty batches
		if len(items) == 0 {
			// reset timer
			b.tick()

			// stop after empty batch
			if stopped {
				// signal the consumers no more items are coming
				close(b.OutQueue)
				return
			}

			continue
		}

		// reset timer
		b.tick()

		// dispatch
		b.OutQueue <- items

		// stop after last batch
		if stopped {
			// signal the consumers no more items are coming
			close(b.OutQueue)
			return
		}
	}
}

// Start begins item dispatching. Should be called only once from a single goroutine.
// The queue can be stopped by calling Stop().
func (b *BatchQueue[T]) Start() {
	// start timer
	b.timer = time.NewTimer(b.config.Interval)
	// start dispatcher
	go b.dispatch()
}

// Stop stops the internal dispatch and listen scheduler.
func (b *BatchQueue[T]) Stop() {
	close(b.inQueue)
}
