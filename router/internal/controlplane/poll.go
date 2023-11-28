package controlplane

import (
	"context"
	"time"
)

type Poller interface {
	// Subscribe subscribes to the poller with a handler function that will be invoked
	// Must only be called once. If the handler takes longer than the poll interval
	// to execute, the next invocation is missed.
	// poller will stop.
	Subscribe(ctx context.Context, handler func())
	// Stop stops the poller. That means no more events will be emitted.
	Stop() error
}

type Poll struct {
	pollInterval time.Duration
	ticker       *time.Ticker
}

func NewPoll(interval time.Duration) Poller {
	p := &Poll{
		pollInterval: interval,
	}

	p.ticker = time.NewTicker(p.pollInterval)

	return p
}

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
				handler()
			}
		}
	}()
}
