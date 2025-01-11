package controlplane

import (
	"context"
	"math/rand"
	"time"
)

type Poller interface {
	// Subscribe subscribes to the poller with a handler function that will be invoked
	// Must only be called once. If the handler is busy during a tick, the next tick will be skipped.
	Subscribe(ctx context.Context, handler func())
	// Stop stops the poller. That means no more events will be emitted.
	Stop() error
}

type Poll struct {
	ticker *time.Ticker

	maxJitter time.Duration
}

// NewPoll creates a new poller that emits events at the given interval
// and executes the given handler function in a separate goroutine.
func NewPoll(interval time.Duration, maxJitter time.Duration) *Poll {
	p := &Poll{
		maxJitter: maxJitter,
	}

	// maxJitter must be positive, otherwise the random duration function will panic
	if maxJitter < 0 {
		panic("negative max jitter")
	}

	p.ticker = time.NewTicker(interval)

	return p
}

// Stop stops the poller. That means no more events will be emitted.
// After calling stop, the poller cannot be used again.
func (c *Poll) Stop() error {
	c.ticker.Stop()
	return nil
}

func (c *Poll) Subscribe(ctx context.Context, handler func()) {
	go func() {
		for {
			select {
			case <-ctx.Done():
				c.ticker.Stop()
				return
			case <-c.ticker.C:
				// If the current handler is still in progress
				// the next tick will be skipped. This is how a timer
				// is implemented in the standard library.

				// Add jitter to the interval
				// This is to prevent all clients from hitting the server at exactly the same time,
				// which could cause a burst load issue
				time.Sleep(randomDuration(c.maxJitter))

				handler()
			}
		}
	}()
}

// randomDuration returns a random duration between 0 and max
func randomDuration(max time.Duration) time.Duration {
	if max < 0 {
		panic("negative duration")
	}

	// rand.Int63n will panic if its argument <= 0
	if max == 0 {
		return 0
	}

	return time.Duration(rand.Int63n(int64(max)))
}
