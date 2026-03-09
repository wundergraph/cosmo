package core

import (
	"fmt"
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
// It tracks the minimum-duration entry so that rejection of cheaper entries is O(1).
type expensivePlanCache struct {
	mu      sync.RWMutex
	entries map[uint64]*expensivePlanEntry
	maxSize int
	minKey  uint64
	minDur  time.Duration
}

func newExpensivePlanCache(maxSize int) (*expensivePlanCache, error) {
	if maxSize < 1 {
		return nil, fmt.Errorf("expensive query cache size must be at least 1, got %d", maxSize)
	}
	return &expensivePlanCache{
		entries: make(map[uint64]*expensivePlanEntry, maxSize),
		maxSize: maxSize,
	}, nil
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
		// If this was the tracked min, or the new duration is lower, refresh the min
		if key == c.minKey || duration < c.minDur {
			c.refreshMin()
		}
		return
	}

	// If not at capacity, just add and update min tracking
	if len(c.entries) < c.maxSize {
		c.entries[key] = &expensivePlanEntry{plan: plan, duration: duration}
		if len(c.entries) == 1 || duration < c.minDur {
			c.minKey = key
			c.minDur = duration
		}
		return
	}

	// At capacity: reject if new entry is not more expensive than the current minimum
	if duration <= c.minDur {
		return
	}

	// Evict the minimum and insert the new entry
	delete(c.entries, c.minKey)
	c.entries[key] = &expensivePlanEntry{plan: plan, duration: duration}
	c.refreshMin()
}

// refreshMin rescans the entries to find the new minimum. Must be called with mu held.
func (c *expensivePlanCache) refreshMin() {
	first := true
	for k, e := range c.entries {
		if first || e.duration < c.minDur {
			c.minKey = k
			c.minDur = e.duration
			first = false
		}
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
