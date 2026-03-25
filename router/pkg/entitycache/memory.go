package entitycache

import (
	"context"
	"fmt"
	"sync/atomic"
	"time"

	ristretto "github.com/dgraph-io/ristretto/v2"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

var _ resolve.LoaderCache = (*MemoryEntityCache)(nil)

type MemoryEntityCache struct {
	cache *ristretto.Cache[string, []byte]
	len   atomic.Int64
}

func NewMemoryEntityCache(maxSizeBytes int64) (*MemoryEntityCache, error) {
	if maxSizeBytes <= 0 {
		return nil, fmt.Errorf("maxSizeBytes must be positive, got %d", maxSizeBytes)
	}
	// NumCounters should be ~10x the expected number of items.
	// Assuming an average entry size of ~1KB.
	numCounters := max((maxSizeBytes/1024)*10, 1000)
	m := &MemoryEntityCache{}
	cache, err := ristretto.NewCache(&ristretto.Config[string, []byte]{
		NumCounters:        numCounters,
		MaxCost:            maxSizeBytes,
		BufferItems:        64,
		IgnoreInternalCost: true,
		OnEvict: func(item *ristretto.Item[[]byte]) {
			m.len.Add(-1)
		},
	})
	if err != nil {
		return nil, fmt.Errorf("creating ristretto cache: %w", err)
	}
	m.cache = cache
	return m, nil
}

func (c *MemoryEntityCache) Get(_ context.Context, keys []string) ([]*resolve.CacheEntry, error) {
	if len(keys) == 0 {
		return nil, nil
	}
	entries := make([]*resolve.CacheEntry, len(keys))
	for i, k := range keys {
		val, ok := c.cache.Get(k)
		if !ok {
			continue
		}
		var remainingTTL time.Duration
		if ttl, found := c.cache.GetTTL(k); found && ttl > 0 {
			remainingTTL = ttl
		}
		entries[i] = &resolve.CacheEntry{
			Key:          k,
			Value:        val,
			RemainingTTL: remainingTTL,
		}
	}
	return entries, nil
}

func (c *MemoryEntityCache) Set(_ context.Context, entries []*resolve.CacheEntry, ttl time.Duration) error {
	if len(entries) == 0 {
		return nil
	}
	for _, entry := range entries {
		if entry == nil {
			continue
		}
		// Check if key already exists (update vs new entry)
		_, exists := c.cache.Get(entry.Key)
		if c.cache.SetWithTTL(entry.Key, entry.Value, int64(len(entry.Value)), ttl) && !exists {
			c.len.Add(1)
		}
	}
	c.cache.Wait()
	return nil
}

func (c *MemoryEntityCache) Delete(_ context.Context, keys []string) error {
	if len(keys) == 0 {
		return nil
	}
	for _, k := range keys {
		if _, ok := c.cache.Get(k); ok {
			c.cache.Del(k)
			c.len.Add(-1)
		}
	}
	return nil
}

// Len returns the approximate number of items in the cache.
// This is intended for use in tests only. The count may drift
// under heavy concurrent access due to races between Get/Set/Delete
// and the asynchronous eviction callback.
func (c *MemoryEntityCache) Len() int {
	return int(c.len.Load())
}

func (c *MemoryEntityCache) Close() error {
	c.cache.Close()
	return nil
}
