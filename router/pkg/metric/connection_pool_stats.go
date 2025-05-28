package metric

import (
	"sync"
	"sync/atomic"
)

type ConnectionPoolStats struct {
	mu           sync.RWMutex
	connsPerHost map[SubgraphHostKey]*atomic.Int64

	MaxConnsPerSubgraph map[string]int64
}

type SubgraphHostKey struct {
	Subgraph string
	Host     string
}

func NewConnectionPoolStats() *ConnectionPoolStats {
	return &ConnectionPoolStats{
		connsPerHost:        make(map[SubgraphHostKey]*atomic.Int64),
		MaxConnsPerSubgraph: make(map[string]int64),
	}
}

func (t *ConnectionPoolStats) AddSubgraphHostCount(subgraph string, maxHostCount int64) {
	t.MaxConnsPerSubgraph[subgraph] = maxHostCount
}

func (t *ConnectionPoolStats) GetCounter(key SubgraphHostKey) *atomic.Int64 {
	// Try a read lock first
	t.mu.RLock()
	counter, ok := t.connsPerHost[key]
	t.mu.RUnlock()
	if ok {
		return counter
	}

	// Create new counter, if this is the first host call
	t.mu.Lock()
	defer t.mu.Unlock()
	// Double-check because another goroutine may have still created the key
	if counter, ok = t.connsPerHost[key]; ok {
		return counter
	}
	t.connsPerHost[key] = new(atomic.Int64)
	return t.connsPerHost[key]
}

// GetStats Return a snapshot of the map of connection counts
func (t *ConnectionPoolStats) GetStats() map[SubgraphHostKey]int64 {
	t.mu.RLock()
	defer t.mu.RUnlock()
	snapshot := make(map[SubgraphHostKey]int64, len(t.connsPerHost))
	for addr, counter := range t.connsPerHost {
		snapshot[addr] = counter.Load()
	}
	return snapshot
}
