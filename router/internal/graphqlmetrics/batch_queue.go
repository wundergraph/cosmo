package graphqlmetrics

import (
	"time"
)

import (
	"context"
)

const (
	defaultBatchInterval = time.Duration(10) * time.Second
	defaultMaxBatchItems = 64
	defaultMaxQueueSize  = 1024
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
// or immediately after the batching limit is met.
type BatchQueue[T any] struct {
	config   *BatchQueueOptions
	ctx      context.Context
	cancel   context.CancelFunc
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
			case <-b.ctx.Done():
				b.timer.Stop()
				stopped = true
				goto done
			}
		}

	done:
		// skip empty batches
		if len(items) == 0 {
			// reset timer
			b.tick()

			// stop while queue is empty
			if stopped {
				// signal the consumers no more items are coming
				close(b.OutQueue)
				return
			}

			continue
		}

		// dispatch
		b.OutQueue <- items

		// reset timer
		b.tick()

		// stop after last batch
		if stopped {
			// signal the consumers no more items are coming
			close(b.OutQueue)
			return
		}
	}
}

// Start begins item dispatching. Should be called only once from a single goroutine.
func (b *BatchQueue[T]) Start(ctx context.Context) {
	b.ctx, b.cancel = context.WithCancel(ctx)
	// start timer
	b.timer = time.NewTimer(b.config.Interval)
	// start dispatcher
	go b.dispatch()
}

// Stop stops the internal dispatch and listen scheduler.
func (b *BatchQueue[T]) Stop() {
	b.cancel()
}
