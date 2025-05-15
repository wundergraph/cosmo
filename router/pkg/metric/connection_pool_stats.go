package metric

import (
	"sync"
	"sync/atomic"
)

type ConnectionPoolStats struct {
	mu           sync.RWMutex
	connsPerHost map[string]*atomic.Int64
}

func NewConnectionPoolStats() *ConnectionPoolStats {
	return &ConnectionPoolStats{
		connsPerHost: make(map[string]*atomic.Int64),
	}
}

func (t *ConnectionPoolStats) GetCounter(addr string) *atomic.Int64 {
	// Try a read lock first
	t.mu.RLock()
	counter, ok := t.connsPerHost[addr]
	t.mu.RUnlock()
	if ok {
		return counter
	}

	// Create new counter
	t.mu.Lock()
	defer t.mu.Unlock()
	// Double-check because another goroutine may have created the key
	if counter, ok = t.connsPerHost[addr]; ok {
		return counter
	}
	t.connsPerHost[addr] = new(atomic.Int64)
	return t.connsPerHost[addr]
}

// GetStats Return a snapshot of the map of connection counts
func (t *ConnectionPoolStats) GetStats() map[string]int64 {
	t.mu.RLock()
	defer t.mu.RUnlock()
	snapshot := make(map[string]int64, len(t.connsPerHost))
	for addr, counter := range t.connsPerHost {
		snapshot[addr] = counter.Load()
	}
	return snapshot
}
