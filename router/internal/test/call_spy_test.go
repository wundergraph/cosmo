package test_test

import (
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/internal/test"
)

func TestCallSpy(t *testing.T) {
	t.Run("initial count is zero", func(t *testing.T) {
		spy := test.NewCallSpy()
		assert.Equal(t, 0, spy.GetCount(), "Initial count should be zero")
	})

	t.Run("Call increments count", func(t *testing.T) {
		spy := test.NewCallSpy()
		spy.Call()
		assert.Equal(t, 1, spy.GetCount(), "Count should be incremented to 1")

		spy.Call()
		assert.Equal(t, 2, spy.GetCount(), "Count should be incremented to 2")
	})

	t.Run("Reset sets count to zero", func(t *testing.T) {
		spy := test.NewCallSpy()
		spy.Call()
		spy.Call()
		assert.Equal(t, 2, spy.GetCount(), "Count should be 2 before reset")

		spy.Reset()
		assert.Equal(t, 0, spy.GetCount(), "Count should be reset to 0")
	})

	t.Run("AssertCalled passes with correct count", func(t *testing.T) {
		spy := test.NewCallSpy()
		spy.Call()
		spy.Call()

		mockT := new(testing.T)
		spy.AssertCalled(mockT, 2)
		assert.False(t, mockT.Failed(), "AssertCalled should not fail with correct count")
	})

	t.Run("AssertCalled fails with incorrect count", func(t *testing.T) {
		spy := test.NewCallSpy()
		spy.Call()

		mockT := new(testing.T)
		spy.AssertCalled(mockT, 2)
		assert.True(t, mockT.Failed(), "AssertCalled should fail with incorrect count")
	})

	t.Run("thread safety with concurrent calls", func(t *testing.T) {
		spy := test.NewCallSpy()
		const iterations = 1000
		const goroutines = 10

		var wg sync.WaitGroup
		wg.Add(goroutines)

		for i := 0; i < goroutines; i++ {
			go func() {
				defer wg.Done()
				for j := 0; j < iterations; j++ {
					spy.Call()
				}
			}()
		}

		wg.Wait()
		assert.Equal(t, goroutines*iterations, spy.GetCount(), "Count should match total number of calls")
	})
}
