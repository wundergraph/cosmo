package entitycache

import (
	"context"
	"sync"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

var _ resolve.LoaderCache = (*MemoryEntityCache)(nil)

type cacheEntry struct {
	value     []byte
	expiresAt time.Time
}

type MemoryEntityCache struct {
	mu      sync.RWMutex
	entries map[string]*cacheEntry
}

func NewMemoryEntityCache() *MemoryEntityCache {
	return &MemoryEntityCache{entries: make(map[string]*cacheEntry)}
}

func (c *MemoryEntityCache) Get(_ context.Context, keys []string) ([]*resolve.CacheEntry, error) {
	if len(keys) == 0 {
		return nil, nil
	}
	now := time.Now()
	entries := make([]*resolve.CacheEntry, len(keys))
	c.mu.RLock()
	defer c.mu.RUnlock()
	for i, k := range keys {
		e, ok := c.entries[k]
		if !ok || (!e.expiresAt.IsZero() && now.After(e.expiresAt)) {
			continue
		}
		var remainingTTL time.Duration
		if !e.expiresAt.IsZero() {
			remainingTTL = time.Until(e.expiresAt)
		}
		entries[i] = &resolve.CacheEntry{
			Key:          k,
			Value:        e.value,
			RemainingTTL: remainingTTL,
		}
	}
	return entries, nil
}

func (c *MemoryEntityCache) Set(_ context.Context, entries []*resolve.CacheEntry, ttl time.Duration) error {
	if len(entries) == 0 {
		return nil
	}
	var expiresAt time.Time
	if ttl > 0 {
		expiresAt = time.Now().Add(ttl)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, entry := range entries {
		if entry == nil {
			continue
		}
		c.entries[entry.Key] = &cacheEntry{value: entry.Value, expiresAt: expiresAt}
	}
	return nil
}

func (c *MemoryEntityCache) Delete(_ context.Context, keys []string) error {
	if len(keys) == 0 {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, k := range keys {
		delete(c.entries, k)
	}
	return nil
}

func (c *MemoryEntityCache) Len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.entries)
}
