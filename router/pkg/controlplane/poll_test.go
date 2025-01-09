package controlplane

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func Test_RandomDurationBetween(t *testing.T) {
	t.Run("should return durations within acceptable range", func(t *testing.T) {
		max := 10 * time.Millisecond

		durations := sampleRandomDurations(25, max)

		for _, duration := range durations {
			assert.GreaterOrEqual(t, duration, 0*time.Millisecond)
			assert.LessOrEqual(t, duration, max)
		}
	})

	t.Run("should return 0 when max is 0", func(t *testing.T) {
		max := 0 * time.Millisecond

		duration := randomDurationBetween(max)

		assert.Equal(t, 0*time.Millisecond, duration)
	})
}

func sampleRandomDurations(count int, max time.Duration) []time.Duration {
	durations := make([]time.Duration, count)

	for i := 0; i < count; i++ {
		durations[i] = randomDurationBetween(max)
	}

	return durations
}
