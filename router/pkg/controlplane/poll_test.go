package controlplane

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func Test_Poller(t *testing.T) {
	// This test passing seems obvious, but it asserts that behavior remains the same after refactoring
	t.Run("creating with invalid parameters should panic", func(t *testing.T) {
		assert.Panics(t, func() {
			NewPoll(-1*time.Second, 0*time.Second)
		})

		assert.Panics(t, func() {
			NewPoll(1*time.Second, -1*time.Second)
		})

		assert.Panics(t, func() {
			NewPoll(0*time.Second, 1*time.Second)
		})
	})

	t.Run("interval plus jitter timing should work correctly", func(t *testing.T) {
		interval := 100 * time.Millisecond
		maxJitter := 50 * time.Millisecond
		expectedMinInterval := interval
		expectedMaxInterval := interval + maxJitter

		p := NewPoll(interval, maxJitter)

		// Record execution timestamps
		var timestamps []time.Time
		executionCount := 0
		targetExecutions := 4

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		p.Subscribe(ctx, func() {
			timestamps = append(timestamps, time.Now())
			executionCount++

			// Cancel after we have enough executions
			if executionCount >= targetExecutions {
				cancel()
			}
		})

		// Wait for context to be cancelled or timeout
		<-ctx.Done()

		// We should have at least 2 executions to measure intervals
		require.GreaterOrEqual(t, len(timestamps), 2, "should have at least 2 executions")

		// Calculate intervals between executions
		for i := 1; i < len(timestamps); i++ {
			actualInterval := timestamps[i].Sub(timestamps[i-1])

			// Each interval should be at least the minimum interval
			assert.GreaterOrEqual(t, actualInterval, expectedMinInterval,
				"execution %d: actual interval %v should be >= minimum interval %v",
				i, actualInterval, expectedMinInterval)

			// Each interval should be at most interval + maxJitter, small delay to account for system scheduling delays
			assert.LessOrEqual(t, actualInterval, expectedMaxInterval+20,
				"execution %d: actual interval %v should be <= maximum interval %v",
				i, actualInterval, expectedMaxInterval)

			t.Logf("execution %d: interval = %v (expected: %v to %v)",
				i, actualInterval, expectedMinInterval, expectedMaxInterval)
		}
	})

	t.Run("should not allow concurrent handler invocations", func(t *testing.T) {
		interval := 50 * time.Millisecond
		maxJitter := 0 * time.Millisecond // No jitter for predictable timing

		p := NewPoll(interval, maxJitter)

		var concurrentInvocations int32
		var maxConcurrentInvocations int32
		var totalInvocations int32

		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		defer cancel()

		p.Subscribe(ctx, func() {
			// Increment concurrent counter
			current := atomic.AddInt32(&concurrentInvocations, 1)

			// Track the maximum concurrent invocations we've seen
			for {
				max := atomic.LoadInt32(&maxConcurrentInvocations)
				if current <= max || atomic.CompareAndSwapInt32(&maxConcurrentInvocations, max, current) {
					break
				}
			}

			// Increment total invocations
			atomic.AddInt32(&totalInvocations, 1)

			// Simulate work that takes longer than the interval
			// This should cause subsequent timer events to be skipped
			time.Sleep(150 * time.Millisecond)

			// Decrement concurrent counter
			atomic.AddInt32(&concurrentInvocations, -1)
		})

		// Wait for context timeout
		<-ctx.Done()

		// Verify that we never had more than 1 concurrent invocation
		maxConcurrent := atomic.LoadInt32(&maxConcurrentInvocations)
		totalInvoked := atomic.LoadInt32(&totalInvocations)

		assert.Equal(t, int32(1), maxConcurrent,
			"should never have more than 1 concurrent handler invocation")

		// We should have fewer invocations than if they were all allowed to run
		// (500ms test duration / 50ms interval = 10 possible, but many should be skipped)
		assert.Greater(t, int32(10), totalInvoked,
			"some invocations should have been skipped due to handler still running")

		// But we should have at least some invocations
		assert.Greater(t, totalInvoked, int32(0),
			"should have at least some handler invocations")

		t.Logf("total invocations: %d, max concurrent: %d", totalInvoked, maxConcurrent)
	})

	t.Run("should stop polling when context is cancelled", func(t *testing.T) {
		interval := 50 * time.Millisecond
		maxJitter := 0 * time.Millisecond // No jitter for predictable timing

		p := NewPoll(interval, maxJitter)

		var executionCount int32

		ctx, cancel := context.WithCancel(context.Background())

		// Start polling
		go p.Subscribe(ctx, func() {
			atomic.AddInt32(&executionCount, 1)
		})

		// Let it run for a bit to ensure polling starts
		time.Sleep(150 * time.Millisecond)
		countBeforeCancel := atomic.LoadInt32(&executionCount)

		// Cancel the context
		cancel()

		// Wait for any pending executions to complete and verify no new ones occur
		time.Sleep(200 * time.Millisecond)
		countAfterCancel := atomic.LoadInt32(&executionCount)

		// Verify that we had some executions before cancellation
		assert.Greater(t, countBeforeCancel, int32(0),
			"should have had executions before context cancellation")

		// Verify that no new executions occurred after cancellation
		assert.Equal(t, countBeforeCancel, countAfterCancel,
			"should not have new executions after context cancellation")

		t.Logf("executions before cancel: %d, executions after cancel: %d",
			countBeforeCancel, countAfterCancel)
	})
}
