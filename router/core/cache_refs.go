package core

import "sync/atomic"

// cacheRefs closes a graph mux's caches once nothing uses them. The mux holds
// one reference until it shuts down, and every operation holds one while it is
// prepared. Whoever releases the last reference closes the caches.
type cacheRefs struct {
	refs    atomic.Int64
	closed  chan struct{}
	release func()
}

func newCacheRefs(closeCaches func()) *cacheRefs {
	c := &cacheRefs{closed: make(chan struct{})}
	c.refs.Store(1)
	c.release = func() {
		if c.refs.Add(-1) == 0 {
			closeCaches()
			close(c.closed)
		}
	}
	return c
}

// acquire takes a reference and returns the function that releases it. If the
// caches are already closing, it waits for that to finish and takes none: a
// closed cache is safe to use, it misses every read and drops every write.
func (c *cacheRefs) acquire() (release func()) {
	for {
		n := c.refs.Load()
		if n == 0 {
			<-c.closed
			return func() {}
		}
		if c.refs.CompareAndSwap(n, n+1) {
			return c.release
		}
	}
}
