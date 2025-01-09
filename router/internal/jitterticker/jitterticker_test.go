package jitterticker

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func Test_JitterTicker(t *testing.T) {
	t.Run("should jitter the interval within acceptable range", func(t *testing.T) {
		interval := 20 * time.Millisecond
		maxJitter := 10 * time.Millisecond

		ticker := NewTicker(interval, maxJitter)

		durations := collectTickDurations(ticker, 25)

		for _, duration := range durations {
			assert.GreaterOrEqual(t, duration, interval)

			// Adds 1 millisecond to account for actual OS jitter
			assert.LessOrEqual(t, duration, interval+maxJitter+1*time.Millisecond)
		}
	})

	t.Run("should not jitter when max is set to 0", func(t *testing.T) {
		interval := 20 * time.Millisecond
		maxJitter := 0 * time.Millisecond

		ticker := NewTicker(interval, maxJitter)
		durations := collectTickDurations(ticker, 25)

		for _, duration := range durations {
			assert.GreaterOrEqual(t, duration, interval)

			// Adds 1 millisecond to account for actual OS jitter
			assert.LessOrEqual(t, duration, interval+1*time.Millisecond)
		}
	})

	t.Run("should stop correctly", func(t *testing.T) {
		interval := 20 * time.Millisecond
		maxJitter := 10 * time.Millisecond

		ticker := NewTicker(interval, maxJitter)

		go collectTickDurations(ticker, 25)

		ticker.Stop()
	})
}

func collectTickDurations(ticker *Ticker, count int) []time.Duration {
	durations := make([]time.Duration, count)
	lastTime := time.Now()

	for i := 0; i < count; i++ {
		<-ticker.C
		now := time.Now()
		durations[i] = now.Sub(lastTime)
		lastTime = now
	}

	return durations
}
