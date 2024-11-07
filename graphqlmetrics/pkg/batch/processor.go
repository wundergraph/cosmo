package batch

import (
	"context"
	"errors"
	"time"

	"go.uber.org/zap"
)

// ProcessorConfig represents the configuration for the batch processor.
type ProcessorConfig struct {
	// MaxCostThreshold defines the maximum number of buffer items, to be evaluated against
	// a cost function before sending the batch. The cost function is custom to the user.
	MaxCostThreshold int

	// MaxQueueSize is the maximum number of batches to be stored in the queue.
	MaxQueueSize int

	// Interval is the time interval to wait before sending the batch.
	Interval time.Duration
}

// Processor is a batch processor to perform batch operations
// based on a given configuration.
type Processor[T any] struct {
	logger       *zap.Logger
	closeChan    chan struct{}
	shutdownChan chan struct{}
	// Config is the configuration for the batch processor.
	config ProcessorConfig

	// queue is the channel to receive batches of buffer.
	queue chan T

	// buffer holds the buffered items which will be sent in a batch.
	buffer []T

	processBatch func([]T) error

	// costFunc is a custom provided function, which will calculate a delta for
	// each element that is added to the buffer.
	costFunc func(T) int

	// currentThreshold holds the current total cost of the buffer.
	currentThreshold int
}

const defaultBufferSize = 10000

// NewProcessor creates a new batch processor for a given configuration.
// The ProcessFunc is the function to be invoked once a batch is ready.
func NewProcessor[T any](
	logger *zap.Logger,
	config ProcessorConfig,
	processFunc func([]T) error,
	costFunc func(T) int,
) *Processor[T] {
	return &Processor[T]{
		logger:       logger,
		closeChan:    make(chan struct{}),
		shutdownChan: make(chan struct{}),
		config:       config,

		queue:  make(chan T, config.MaxQueueSize),
		buffer: make([]T, 0, defaultBufferSize),

		processBatch: processFunc,
		costFunc:     costFunc,
	}
}

// Enqueue attempts to one or more elements to the queue. If the queue is full,
// it will wait until the queue can accept more data or the context is cancelled.
func (p *Processor[T]) Enqueue(ctx context.Context, element ...T) error {
	for _, e := range element {
		if !p.canAcceptBatch() {
			return errors.New("processor is closed")
		}

		select {
		case p.queue <- e:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	return nil
}

// Start starts the batch processor.
func (p *Processor[T]) Start(ctx context.Context) {
	ticker := time.NewTicker(p.config.Interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			p.process()
		case batch := <-p.queue:
			p.receiveElement(batch)
		case <-ctx.Done():
			p.process()
			p.Stop()
			return
		case <-p.closeChan:
			close(p.shutdownChan)
			return
		}
	}
}

// Stop instructs to processor to shut down.
// It will ensure that all remaining items in the queue and buffer are processed.
func (p *Processor[T]) Stop() {
	close(p.closeChan)
	close(p.queue)

	<-p.shutdownChan

	for batch := range p.queue {
		p.receiveElement(batch)
	}

	if len(p.buffer) > 0 {
		p.process()
	}
}

func (p *Processor[T]) canAcceptBatch() bool {
	select {
	case <-p.closeChan:
		return false
	default:
		return true
	}
}

func (p *Processor[T]) process() {
	if err := p.processBatch(p.buffer); err != nil {
		p.logger.Error("Failed to process batch", zap.Error(err))
		return
	}

	p.buffer = p.buffer[:0]
	p.currentThreshold = 0
}

// receiveElement receives a batch of buffer adds them to the buffer.
// If the buffer is full, the batch processing will be invoked.
func (p *Processor[T]) receiveElement(element T) {
	p.logger.Debug("Received element", zap.Any("element", element))

	p.buffer = append(p.buffer, element)

	if p.costFunc != nil {
		p.currentThreshold += p.costFunc(element)
	}

	if p.currentThreshold >= p.config.MaxCostThreshold || len(p.buffer) == defaultBufferSize {
		p.process()
	}

}
