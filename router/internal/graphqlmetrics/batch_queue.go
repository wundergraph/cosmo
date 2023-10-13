package graphqlmetrics

import "time"

// Inspired by https://github.com/wind-c/bqueue

import (
	"context"
	"sync/atomic"
)

const (
	defaultInterval      = time.Duration(5) * time.Second
	defaultMaxBatchItems = 1024
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
		o.Interval = defaultInterval
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
type BatchQueue struct {
	config          *BatchQueueOptions
	ctx             context.Context
	cancel          context.CancelFunc
	doWork          chan struct{}
	stopped         *atomic.Bool
	timer           *time.Timer
	inQueue         chan any
	midQueue        chan any
	OutQueue        chan []any
	dispatchedCount int
}

// NewBatchQueue returns an initialized instance of BatchQueue.
// Items are enqueued without blocking.
// The queue is dispatched by time intervals or immediately after the batching limit is met.
// Batches can be read from the OutQueue channel.
func NewBatchQueue(config *BatchQueueOptions) *BatchQueue {
	if config == nil {
		config = new(BatchQueueOptions)
	}
	config.ensureDefaults()

	bq := &BatchQueue{
		config:          config,
		doWork:          make(chan struct{}),
		inQueue:         make(chan any, config.MaxQueueSize/2),
		midQueue:        make(chan any, config.MaxQueueSize/2),
		OutQueue:        make(chan []any, config.MaxQueueSize/config.MaxBatchItems),
		stopped:         &atomic.Bool{},
		dispatchedCount: 0,
	}

	return bq
}

// Enqueue adds an item to the queue. Returns false if the queue is stopped or not ready to accept items
func (b *BatchQueue) Enqueue(item any) bool {
	if b.stopped.Load() {
		return false
	}

	select {
	case b.inQueue <- item:
		return true
	default:
		return false
	}
}

func (b *BatchQueue) tick() {
	b.timer.Reset(b.config.Interval)
}

// dispatch sends items to the OutQueue. Only one dispatch must be active at a time.
func (b *BatchQueue) dispatch() {
	for {
		select {
		case <-b.doWork:
			var items []any
			for b := range b.midQueue {
				if b == struct{}{} {
					break
				}
				items = append(items, b)
			}
			if len(items) == 0 {
				b.tick()
				continue
			}
			// dispatch
			b.dispatchedCount += len(items)
			b.OutQueue <- items
			b.tick()
		case <-b.ctx.Done():
			return
		}
	}
}

// Start begins item dispatching.
func (b *BatchQueue) Start(ctx context.Context) {
	b.ctx, b.cancel = context.WithCancel(ctx)
	// start dispatcher
	go b.dispatch()

	// start timer
	b.timer = time.AfterFunc(b.config.Interval, func() {
		// add split flag
		b.midQueue <- struct{}{}
		// do work
		b.doWork <- struct{}{}
	})

	// batch take
	for {
		select {
		case m := <-b.inQueue:
			b.midQueue <- m
			if len(b.midQueue) == b.config.MaxBatchItems {
				// add split flag
				b.midQueue <- struct{}{}
				// do work
				b.doWork <- struct{}{}
			}
		case <-b.ctx.Done():
			b.timer.Stop()
			b.dispatchedCount = 0
			close(b.OutQueue)
			return
		}
	}
}

// Stop stops the internal dispatch and listen scheduler.
func (b *BatchQueue) Stop() {
	b.stopped.Store(true) // disable producer
	b.cancel()
}

func (b *BatchQueue) GetDispatchedCount() int {
	return b.dispatchedCount
}
