package sandbox

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
)

// defaultPoolSize is the default concurrency limit when size <= 0.
const defaultPoolSize = 4

// ErrPoolClosed is returned when Execute is called on a closed pool.
var ErrPoolClosed = errors.New("sandbox pool is closed")

// Pool manages sandbox execution with concurrency control.
// It is not a pre-warmed pool — each Execute call creates a fresh runtime.
// The semaphore limits how many sandbox executions can run concurrently.
type Pool struct {
	config ExecutionConfig
	sem    chan struct{} // semaphore for concurrency control
	closed atomic.Bool
}

// NewPool creates a pool with the given concurrency limit and config.
func NewPool(size int, config ExecutionConfig) *Pool {
	if size <= 0 {
		size = defaultPoolSize
	}
	return &Pool{
		config: config,
		sem:    make(chan struct{}, size),
	}
}

// Execute acquires a slot, runs the code in a fresh sandbox, and returns the result.
// If all slots are in use, blocks until one is available or context is cancelled.
func (p *Pool) Execute(ctx context.Context, jsCode string, syncFuncs []SyncFunc, asyncFuncs []AsyncFunc, objects []ObjectDef) (*Result, error) {
	if p.closed.Load() {
		return nil, ErrPoolClosed
	}

	// Acquire semaphore slot
	select {
	case p.sem <- struct{}{}:
		defer func() { <-p.sem }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	if p.config.MaxInputBytes > 0 && len(jsCode) > p.config.MaxInputBytes {
		return nil, fmt.Errorf("input size %d exceeds limit %d", len(jsCode), p.config.MaxInputBytes)
	}

	rt := NewRuntime(p.config)
	return rt.Execute(ctx, jsCode, syncFuncs, asyncFuncs, objects)
}

// Close shuts down the pool. Subsequent Execute calls return ErrPoolClosed.
func (p *Pool) Close() {
	p.closed.Store(true)
}

// Config returns the pool's execution config.
func (p *Pool) Config() ExecutionConfig {
	return p.config
}
