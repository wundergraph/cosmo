package slowplancache

import (
	"fmt"
	"iter"
	"sync"
	"sync/atomic"
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
	waitCh chan struct{} // if non-nil, will be closed after previous requests in the buffer are processed
}

// Cache is a bounded map that holds expensive-to-compute values
// that should not be subject to TinyLFU eviction in the main cache.
// Writes are buffered through a channel and applied asynchronously by a
// background goroutine, making Set non-blocking. Reads use sync.Map for lock-free access.
// It tracks the minimum-duration entry so that rejection of cheaper entries is O(1).
type Cache[V any] struct {
	entries   sync.Map // map[uint64]*Entry[V]
	size      int64
	maxSize   int64
	threshold time.Duration
	minKey    uint64
	minDur    time.Duration

	writeCh   chan setRequest[V]
	stop      chan struct{}
	done      chan struct{}
	closeOnce sync.Once
	closed    atomic.Bool
}

// We use the same value as ristretto (this would be the buffer size if we used ristretto as the backing cache)
const defaultWriteBufferSize = 32 * 1024

func New[V any](maxSize int, threshold time.Duration) (*Cache[V], error) {
	if maxSize < 1 {
		return nil, fmt.Errorf("slow plan cache size must be at least 1, got %d", maxSize)
	}
	c := &Cache[V]{
		maxSize:   int64(maxSize),
		threshold: threshold,
		writeCh:   make(chan setRequest[V], defaultWriteBufferSize),
		stop:      make(chan struct{}),
		done:      make(chan struct{}),
	}
	go c.processWrites()
	return c, nil
}

// processWrites drains the write channel and applies sets.
// It exits when the stop channel is closed.
func (c *Cache[V]) processWrites() {
	defer close(c.done)

	for {
		select {
		case req := <-c.writeCh:
			if req.waitCh != nil {
				close(req.waitCh)
				continue
			}
			c.applySet(req.key, req.value, req.dur)
		case <-c.stop:
			return
		}
	}
}

func (c *Cache[V]) Get(key uint64) (V, bool) {
	if c == nil || c.closed.Load() {
		var zero V
		return zero, false
	}

	val, ok := c.entries.Load(key)
	if !ok {
		var zero V
		return zero, false
	}

	return val.(*Entry[V]).value, true
}

// Set enqueues a write to the cache. The write is applied asynchronously.
// If the write buffer is full or the cache is closed, the entry is silently dropped.
func (c *Cache[V]) Set(key uint64, value V, duration time.Duration) {
	if c == nil || c.closed.Load() {
		return
	}

	if duration < c.threshold {
		return
	}

	select {
	case c.writeCh <- setRequest[V]{key: key, value: value, dur: duration}:
	default:
	}
}

// Wait blocks until all pending writes in the buffer have been processed.
// Returns immediately if the cache is closed.
func (c *Cache[V]) Wait() {
	if c == nil || c.closed.Load() {
		return
	}

	ch := make(chan struct{})

	select {
	case c.writeCh <- setRequest[V]{waitCh: ch}:
		<-ch
	case <-c.done:
	}
}

// applySet performs the actual cache mutation. Must only be called from processWrites.
func (c *Cache[V]) applySet(key uint64, value V, duration time.Duration) {
	entry := &Entry[V]{value: value, duration: duration}

	// If key already exists, update it
	if existing, ok := c.entries.Load(key); ok {
		currEntry := existing.(*Entry[V])
		// Consider worst case, if the previous run was faster then increase
		if currEntry.duration < duration {
			c.entries.Store(key, entry)

			// If the minKey duration was increased, there can be a new minKey
			if c.minKey == key {
				c.refreshMin()
			}
		}
		return
	}

	// If not at capacity, just add and update min tracking
	if c.size < c.maxSize {
		c.entries.Store(key, entry)
		c.size++
		if c.size == 1 || duration < c.minDur {
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
	c.entries.Delete(c.minKey)
	c.entries.Store(key, entry)
	// size stays the same: deleted one, added one
	c.refreshMin()
}

// refreshMin rescans the entries to find the new minimum. Must only be called from processWrites.
func (c *Cache[V]) refreshMin() {
	var (
		minKey uint64
		minDur time.Duration
		first  = true
	)

	c.entries.Range(func(k, v any) bool {
		e := v.(*Entry[V])
		if first || e.duration < minDur {
			minKey = k.(uint64)
			minDur = e.duration
			first = false
		}
		return true
	})

	if !first {
		c.minKey = minKey
		c.minDur = minDur
	}
}

// Values returns an iterator over all cached values.
func (c *Cache[V]) Values() iter.Seq[V] {
	return func(yield func(V) bool) {
		if c == nil || c.closed.Load() {
			return
		}

		c.entries.Range(func(_, v any) bool {
			return yield(v.(*Entry[V]).value)
		})
	}
}

// Close stops the background goroutine and releases resources.
// Pending writes in the buffer may be dropped. Safe to call multiple times.
func (c *Cache[V]) Close() {
	if c == nil || c.closed.Load() {
		return
	}

	c.closeOnce.Do(func() {
		c.closed.Store(true)

		close(c.stop)
		<-c.done

		// This downside is also there in ristretto (if set is called concurrently)
		// it is even documented in the ristretto code as a comment
		close(c.writeCh)
	})
}
