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

type setRequest struct {
	key      uint64
	plan     *planWithMetaData
	duration time.Duration
	waitCh   chan struct{} // if non-nil, closed after this request is processed
}

// expensivePlanCache is a bounded map that holds expensive plans
// that should not be subject to TinyLFU eviction in the main cache.
// Writes are buffered through a channel and applied asynchronously by a
// background goroutine, making Set non-blocking. Reads are protected by a RWMutex.
// It tracks the minimum-duration entry so that rejection of cheaper entries is O(1).
type expensivePlanCache struct {
	mu        sync.RWMutex
	entries   map[uint64]*expensivePlanEntry
	maxSize   int
	threshold time.Duration
	minKey    uint64
	minDur    time.Duration

	writeCh chan setRequest
	stop    chan struct{}
	done    chan struct{}
}

// We use the same value as ristretto (this would be the buffer size if we used ristretto as the backing cache)
const defaultWriteBufferSize = 32 * 1024

func newExpensivePlanCache(maxSize int, threshold time.Duration) (*expensivePlanCache, error) {
	if maxSize < 1 {
		return nil, fmt.Errorf("expensive query cache size must be at least 1, got %d", maxSize)
	}
	c := &expensivePlanCache{
		entries:   make(map[uint64]*expensivePlanEntry, maxSize),
		maxSize:   maxSize,
		threshold: threshold,
		writeCh:   make(chan setRequest, defaultWriteBufferSize),
		stop:      make(chan struct{}),
		done:      make(chan struct{}),
	}
	go c.processWrites()
	return c, nil
}

// processWrites drains the write channel and applies sets under the write lock.
// It exits when the stop channel is closed.
func (c *expensivePlanCache) processWrites() {
	for {
		select {
		case req := <-c.writeCh:
			if req.waitCh != nil {
				close(req.waitCh)
				continue
			}
			c.applySet(req.key, req.plan, req.duration)
		case <-c.stop:
			c.done <- struct{}{}
			return
		}
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

// Set enqueues a write to the cache. The write is applied asynchronously.
// If the write buffer is full, the entry is silently dropped.
func (c *expensivePlanCache) Set(key uint64, plan *planWithMetaData, duration time.Duration) {
	select {
	case c.writeCh <- setRequest{key: key, plan: plan, duration: duration}:
	default:
	}
}

// Wait blocks until all pending writes in the buffer have been processed.
func (c *expensivePlanCache) Wait() {
	ch := make(chan struct{})
	c.writeCh <- setRequest{waitCh: ch}
	<-ch
}

// applySet performs the actual cache mutation. Must only be called from processWrites.
func (c *expensivePlanCache) applySet(key uint64, plan *planWithMetaData, duration time.Duration) {
	// Reject entries that don't meet the threshold
	if duration < c.threshold {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	// If key already exists, update it
	if currEntry, ok := c.entries[key]; ok {
		// Consider worst case, if the previous run was faster then increase
		if currEntry.duration < duration {
			c.entries[key] = &expensivePlanEntry{plan: plan, duration: duration}

			// If the minKey duration was increased, there can be a new minKey
			if c.minKey == key {
				c.refreshMin()
			}
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

	// When at max capacity
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

// Close stops the background goroutine and releases resources.
// Pending writes in the buffer may be dropped.
func (c *expensivePlanCache) Close() {
	close(c.stop)
	<-c.done

	close(c.done)
	c.mu.Lock()
	c.entries = nil
	c.mu.Unlock()
}
