package core

import (
	"sync"
	"time"
)

// expensivePlanEntry holds a cached plan and the duration it took to plan.
type expensivePlanEntry struct {
	plan     *planWithMetaData
	duration time.Duration
}

// expensivePlanCache is a bounded, mutex-protected map that holds expensive plans
// that should not be subject to TinyLFU eviction in the main cache.
type expensivePlanCache struct {
	mu      sync.RWMutex
	entries map[uint64]*expensivePlanEntry
	maxSize int
}

func newExpensivePlanCache(maxSize int) *expensivePlanCache {
	return &expensivePlanCache{
		entries: make(map[uint64]*expensivePlanEntry, maxSize),
		maxSize: maxSize,
	}
}

func (c *expensivePlanCache) Get(key uint64) (*planWithMetaData, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, ok := c.entries[key]
	if !ok {
		return nil, false
	}
	return entry.plan, true
}

// Set stores a plan in the expensive cache. When at capacity, it only adds the
// new entry if its duration exceeds the current minimum; otherwise, it is skipped.
func (c *expensivePlanCache) Set(key uint64, plan *planWithMetaData, duration time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.entries == nil {
		return
	}

	// If key already exists, update it
	if _, ok := c.entries[key]; ok {
		c.entries[key] = &expensivePlanEntry{plan: plan, duration: duration}
		return
	}

	// If not at capacity, just add
	if len(c.entries) < c.maxSize {
		c.entries[key] = &expensivePlanEntry{plan: plan, duration: duration}
		return
	}

	// At capacity: find the minimum and only evict if new entry is more expensive
	var minKey uint64
	var minDur time.Duration
	first := true
	for k, e := range c.entries {
		if first || e.duration < minDur {
			minKey = k
			minDur = e.duration
			first = false
		}
	}

	if duration > minDur {
		delete(c.entries, minKey)
		c.entries[key] = &expensivePlanEntry{plan: plan, duration: duration}
	}
}

func (c *expensivePlanCache) IterValues(cb func(v *planWithMetaData) bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	for _, e := range c.entries {
		if cb(e.plan) {
			return
		}
	}
}

func (c *expensivePlanCache) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.entries = nil
}

