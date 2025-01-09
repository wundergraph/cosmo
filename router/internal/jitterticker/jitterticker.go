package jitterticker

import (
	"math/rand"
	"time"
)

// Ticker is a time.Ticker-like struct that adds jitter to the interval
type Ticker struct {
	interval time.Duration

	maxJitter time.Duration

	C    <-chan time.Time
	stop chan struct{}
}

func NewTicker(interval time.Duration, maxJitter time.Duration) *Ticker {
	if interval < 0 {
		panic("negative interval")
	}

	if maxJitter < 0 {
		panic("negative max jitter")
	}

	c := make(chan time.Time)
	stop := make(chan struct{})

	ticker := &Ticker{
		C:         c,
		stop:      stop,
		interval:  interval,
		maxJitter: maxJitter,
	}

	go func() {
		defer close(c)

		for {
			time.Sleep(ticker.getDelay())

			select {
			case <-ticker.stop:
				close(c)
				return
			case c <- time.Now():
			default:
			}
		}
	}()

	return ticker
}

func (t *Ticker) getDelay() time.Duration {
	if t.maxJitter == 0 {
		return t.interval
	}

	return t.interval + time.Duration(rand.Int63n(int64(t.maxJitter)))
}

func (t *Ticker) Stop() {
	t.stop <- struct{}{}
}
