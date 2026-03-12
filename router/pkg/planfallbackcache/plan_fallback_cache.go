package planfallbackcache

import (
	"fmt"
	"sync"
	"time"
)

// Entry holds a cached value and the duration it took to produce.
type Entry[V any] struct {
	value    V
	duration time.Duration
}

type setRequest[V any] struct {
	key    uint64
	value  V
	dur    time.Duration
	waitCh chan struct{} // if non-nil, closed after this request is processed
}

// Cache is a bounded map that holds expensive-to-compute values
// that should not be subject to TinyLFU eviction in the main cache.
// Writes are buffered through a channel and applied asynchronously by a
// background goroutine, making Set non-blocking. Reads are protected by a RWMutex.
// It tracks the minimum-duration entry so that rejection of cheaper entries is O(1).
type Cache[V any] struct {
	mu        sync.RWMutex
	entries   map[uint64]*Entry[V]
	maxSize   int
	threshold time.Duration
	minKey    uint64
	minDur    time.Duration

	writeCh chan setRequest[V]
	stop    chan struct{}
	done    chan struct{}
}

// We use the same value as ristretto (this would be the buffer size if we used ristretto as the backing cache)
const defaultWriteBufferSize = 32 * 1024

func New[V any](maxSize int, threshold time.Duration) (*Cache[V], error) {
	if maxSize < 1 {
		return nil, fmt.Errorf("plan fallback cache size must be at least 1, got %d", maxSize)
	}
	c := &Cache[V]{
		entries:   make(map[uint64]*Entry[V], maxSize),
		maxSize:   maxSize,
		threshold: threshold,
		writeCh:   make(chan setRequest[V], defaultWriteBufferSize),
		stop:      make(chan struct{}),
		done:      make(chan struct{}),
	}
	go c.processWrites()
	return c, nil
}

// processWrites drains the write channel and applies sets under the write lock.
// It exits when the stop channel is closed.
func (c *Cache[V]) processWrites() {
	for {
		select {
		case req := <-c.writeCh:
			if req.waitCh != nil {
				close(req.waitCh)
				continue
			}
			c.applySet(req.key, req.value, req.dur)
		case <-c.stop:
			c.done <- struct{}{}
			return
		}
	}
}

func (c *Cache[V]) Get(key uint64) (V, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, ok := c.entries[key]
	if !ok {
		var zero V
		return zero, false
	}
	return entry.value, true
}

// Set enqueues a write to the cache. The write is applied asynchronously.
// If the write buffer is full, the entry is silently dropped.
func (c *Cache[V]) Set(key uint64, value V, duration time.Duration) {
	select {
	case c.writeCh <- setRequest[V]{key: key, value: value, dur: duration}:
	default:
	}
}

// Wait blocks until all pending writes in the buffer have been processed.
func (c *Cache[V]) Wait() {
	ch := make(chan struct{})
	c.writeCh <- setRequest[V]{waitCh: ch}
	<-ch
}

// applySet performs the actual cache mutation. Must only be called from processWrites.
func (c *Cache[V]) applySet(key uint64, value V, duration time.Duration) {
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
			c.entries[key] = &Entry[V]{value: value, duration: duration}

			// If the minKey duration was increased, there can be a new minKey
			if c.minKey == key {
				c.refreshMin()
			}
		}
		return
	}

	// If not at capacity, just add and update min tracking
	if len(c.entries) < c.maxSize {
		c.entries[key] = &Entry[V]{value: value, duration: duration}
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
	c.entries[key] = &Entry[V]{value: value, duration: duration}
	c.refreshMin()
}

// refreshMin rescans the entries to find the new minimum. Must be called with mu held.
func (c *Cache[V]) refreshMin() {
	first := true
	for k, e := range c.entries {
		if first || e.duration < c.minDur {
			c.minKey = k
			c.minDur = e.duration
			first = false
		}
	}
}

func (c *Cache[V]) IterValues(cb func(v V) bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	for _, e := range c.entries {
		if cb(e.value) {
			return
		}
	}
}

// Close stops the background goroutine and releases resources.
// Pending writes in the buffer may be dropped.
func (c *Cache[V]) Close() {
	close(c.stop)
	<-c.done

	close(c.done)
	c.mu.Lock()
	c.entries = nil
	c.mu.Unlock()
}
