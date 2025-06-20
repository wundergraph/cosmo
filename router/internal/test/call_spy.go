package test

import (
	"sync/atomic"

	"github.com/stretchr/testify/assert"
)

// CallSpy is a thread-safe counter for method calls.
type CallSpy struct {
	count int32
}

// NewCallSpy creates a new CallSpy instance.
func NewCallSpy() *CallSpy {
	return &CallSpy{
		count: 0,
	}
}

// Call increments the call count and can be used as a callback.
func (c *CallSpy) Call() {
	atomic.AddInt32(&c.count, 1)
}

// GetCount returns the current call count.
func (c *CallSpy) GetCount() int {
	return int(atomic.LoadInt32(&c.count))
}

// AssertCalled asserts that the spy was called the expected number of times.
func (c *CallSpy) AssertCalled(t assert.TestingT, expectedCalls int) {
	actualCalls := c.GetCount()
	assert.Equal(t, expectedCalls, actualCalls, "Expected %d calls but got %d", expectedCalls, actualCalls)
}

// AssertCalledInBetween asserts that the spy was called between the expected number of times.
func (c *CallSpy) AssertCalledInBetween(t assert.TestingT, minCalls, maxCalls int) {
	actualCalls := c.GetCount()
	assert.GreaterOrEqual(t, actualCalls, minCalls, "Expected at least %d calls but got %d", minCalls, actualCalls)
	assert.LessOrEqual(t, actualCalls, maxCalls, "Expected at most %d calls but got %d", maxCalls, actualCalls)
}

// Reset resets the call count to zero.
func (c *CallSpy) Reset() {
	atomic.StoreInt32(&c.count, 0)
}
