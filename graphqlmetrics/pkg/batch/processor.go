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

	// currentBufferCost holds the current total cost of the buffer.
	currentBufferCost int
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
		if !p.canAcceptElement() {
			return errors.New("processor is closed")
		}

		select {
		case p.queue <- e:
			p.logger.Debug("element added to the queue")
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	return nil
}

// Start starts the batch processor.
func (p *Processor[T]) Start() {
	p.logger.Debug("Starting processor")

	ticker := time.NewTicker(p.config.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if len(p.buffer) > 0 {
				p.process()
			}
		case element, ok := <-p.queue:
			if !ok {
				return
			}

			ticker.Reset(p.config.Interval)
			p.receiveElement(element)
		case <-p.closeChan:
			close(p.shutdownChan)
			return
		}
	}
}

// Stop instructs to processor to shut down.
// It will ensure that all remaining items in the queue and buffer are processed.
func (p *Processor[T]) Stop() {
	p.logger.Info("Shutdown requested - stopping processor")
	close(p.closeChan)
	close(p.queue)

	<-p.shutdownChan

	p.logger.Info("processing remaining items in the queue", zap.Int("queue_size", len(p.queue)))
	for batch := range p.queue {
		p.receiveElement(batch)
	}

	p.logger.Info("processing remaining items in the buffer", zap.Int("buffer_size", len(p.buffer)))
	if len(p.buffer) > 0 {
		p.process()
	}
}

func (p *Processor[T]) canAcceptElement() bool {
	select {
	case <-p.closeChan:
		return false
	default:
		return true
	}
}

func (p *Processor[T]) process() {
	p.logger.Debug("Processing batch", zap.Int("buffer_size", len(p.buffer)))

	cpyBuff := make([]T, len(p.buffer))
	copy(cpyBuff, p.buffer)

	if err := p.processBatch(cpyBuff); err != nil {
		p.logger.Error("Failed to process batch", zap.Error(err))
		return
	}

	p.buffer = p.buffer[:0]
	p.currentBufferCost = 0

	p.logger.Debug("Batch processed successfully")
}

// receiveElement receives a batch of buffer adds them to the buffer.
// If the buffer is full, the batch processing will be invoked.
func (p *Processor[T]) receiveElement(element T) {
	p.buffer = append(p.buffer, element)

	if p.costFunc != nil {
		p.currentBufferCost += p.costFunc(element)
	}

	p.logger.Debug("current buffer cost", zap.Int("currentCost", p.currentBufferCost))

	if p.currentBufferCost >= p.config.MaxCostThreshold || len(p.buffer) == defaultBufferSize {
		p.logger.Debug("buffer threshold reached - processing batch",
			zap.Int("buffer_size", len(p.buffer)),
			zap.Int("current_cost", p.currentBufferCost),
			zap.Int("max_cost_threshold", p.config.MaxCostThreshold))

		p.process()
	}
}
