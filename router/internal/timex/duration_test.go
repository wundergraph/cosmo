package timex_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/internal/timex"
)

func Test_RandomDuration(t *testing.T) {
	t.Run("should return durations within acceptable range", func(t *testing.T) {
		maximum := 10 * time.Millisecond

		durations := sampleRandomDurations(25, maximum)

		for _, duration := range durations {
			assert.GreaterOrEqual(t, duration, 0*time.Millisecond)
			assert.LessOrEqual(t, duration, maximum)
		}
	})

	t.Run("should return 0 when maximum is 0", func(t *testing.T) {
		maximum := 0 * time.Millisecond

		duration := timex.RandomDuration(maximum)

		assert.Equal(t, 0*time.Millisecond, duration)
	})

	t.Run("should panic when maximum is less than zero", func(t *testing.T) {
		maximum := -1 * time.Millisecond

		assert.Panics(t, func() {
			timex.RandomDuration(maximum)
		})
	})
}

func sampleRandomDurations(count int, maximum time.Duration) []time.Duration {
	durations := make([]time.Duration, count)

	for i := range count {
		durations[i] = timex.RandomDuration(maximum)
	}

	return durations
}
