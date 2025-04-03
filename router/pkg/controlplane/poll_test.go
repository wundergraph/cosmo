package controlplane

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
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

	// This is a guarunteed pass because Poll.Stop() always returns nil,
	// but it's good to have a test for it should there be an error in the future
	t.Run("stopping should work correctly", func(t *testing.T) {
		p := NewPoll(1*time.Second, 0*time.Second)

		err := p.Stop()

		assert.NoError(t, err)
	})
}
