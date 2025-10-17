package controlplane

import (
	"context"
	"time"

	"github.com/wundergraph/cosmo/router/internal/timex"
)

type Poller interface {
	// Subscribe subscribes to the poller with a handler function that will be invoked
	// Must only be called once. If the handler is busy during a tick, the next tick will be skipped.
	Subscribe(ctx context.Context, handler func())
}

type Poll struct {
	interval  time.Duration
	maxJitter time.Duration
}

// NewPoll creates a new poller that emits events at the given interval
// and executes the given handler function in a separate goroutine.
func NewPoll(interval time.Duration, maxJitter time.Duration) *Poll {
	// interval must be positive
	if interval <= 0 {
		panic("non-positive interval")
	}

	// maxJitter must be non-negative, otherwise the random duration function will panic
	if maxJitter < 0 {
		panic("negative max jitter")
	}

	return &Poll{
		interval:  interval,
		maxJitter: maxJitter,
	}
}

func (c *Poll) Subscribe(ctx context.Context, handler func()) {
	go func() {
		// Calculate initial delay: interval + jitter
		jitter := timex.RandomDuration(c.maxJitter)
		timer := time.NewTimer(c.interval + jitter)
		defer timer.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				// Check if context was cancelled while waiting for timer
				if ctx.Err() != nil {
					return
				}

				// Execute handler
				handler()

				// Calculate next execution time: interval + new jitter
				// This ensures we always wait at least 'interval' time between executions
				jitter := timex.RandomDuration(c.maxJitter)
				nextDelay := c.interval + jitter
				timer.Reset(nextDelay)
			}
		}
	}()
}
