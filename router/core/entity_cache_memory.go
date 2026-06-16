package core

import (
	"container/list"
	"context"
	"io"
	"sync"
	"time"

	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

const (
	// Zero-TTL writes use this bounded default because the memory backend has no
	// external cache TTL to preserve.
	defaultMemoryEntityCacheTTL     = 5 * time.Minute
	defaultMemoryEntityCacheMaxSize = uint64(100_000_000)
)

var _ resolve.LoaderCache = (*memoryEntityCache)(nil)
var _ io.Closer = (*memoryEntityCache)(nil)

type memoryEntityCache struct {
	mu          sync.Mutex
	entries     map[string]memoryEntityCacheEntry
	order       *list.List
	orderIndex  map[string]*list.Element
	currentSize uint64
	maxSize     uint64
	keyPrefix   string
	now         func() time.Time
}

type memoryEntityCacheEntry struct {
	value     []byte
	expiresAt time.Time
	size      uint64
}

func newMemoryEntityCache(storageConfig config.MemoryStorageProvider, keyPrefix string) *memoryEntityCache {
	maxSize := storageConfig.MaxSize.Uint64()
	if maxSize == 0 {
		maxSize = defaultMemoryEntityCacheMaxSize
	}

	return &memoryEntityCache{
		entries:    make(map[string]memoryEntityCacheEntry),
		order:      list.New(),
		orderIndex: make(map[string]*list.Element),
		maxSize:    maxSize,
		keyPrefix:  normalizeEntityCacheKeyPrefix(keyPrefix),
		now:        time.Now,
	}
}

func (c *memoryEntityCache) Get(ctx context.Context, keys []string) ([]*resolve.CacheEntry, error) {
	_ = ctx

	out := make([]*resolve.CacheEntry, len(keys))
	if len(keys) == 0 {
		return out, nil
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	now := c.now()
	for i, key := range keys {
		memoryKey := c.memoryKey(key)
		entry, ok := c.entries[memoryKey]
		if !ok {
			continue
		}
		if entry.expired(now) {
			c.remove(memoryKey)
			continue
		}

		out[i] = &resolve.CacheEntry{
			Key:          key,
			Value:        copyBytes(entry.value),
			RemainingTTL: entry.remainingTTL(now),
		}
	}

	return out, nil
}

func (c *memoryEntityCache) Set(ctx context.Context, entries []*resolve.CacheEntry) error {
	_ = ctx

	if len(entries) == 0 {
		return nil
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	now := c.now()
	for _, entry := range entries {
		if entry == nil {
			continue
		}

		memoryKey := c.memoryKey(entry.Key)
		value := copyBytes(entry.Value)
		size := uint64(len(value))
		c.remove(memoryKey)
		if size > c.maxSize {
			continue
		}

		for c.currentSize+size > c.maxSize {
			if !c.evictOldest() {
				break
			}
		}
		if c.currentSize+size > c.maxSize {
			continue
		}

		c.entries[memoryKey] = memoryEntityCacheEntry{
			value:     value,
			expiresAt: memoryEntityCacheExpiresAt(entry.TTL, now),
			size:      size,
		}
		c.orderIndex[memoryKey] = c.order.PushBack(memoryKey)
		c.currentSize += size
	}

	return nil
}

func memoryEntityCacheExpiresAt(ttl time.Duration, now time.Time) time.Time {
	if ttl < 0 {
		return time.Time{}
	}
	if ttl == 0 {
		ttl = defaultMemoryEntityCacheTTL
	}
	return now.Add(ttl)
}

func (c *memoryEntityCache) Delete(ctx context.Context, keys []string) error {
	_ = ctx

	if len(keys) == 0 {
		return nil
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	for _, key := range keys {
		c.remove(c.memoryKey(key))
	}

	return nil
}

func (c *memoryEntityCache) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.entries = make(map[string]memoryEntityCacheEntry)
	c.order = list.New()
	c.orderIndex = make(map[string]*list.Element)
	c.currentSize = 0

	return nil
}

func (c *memoryEntityCache) evictOldest() bool {
	oldest := c.order.Front()
	if oldest == nil {
		return false
	}

	key, ok := oldest.Value.(string)
	if !ok {
		c.order.Remove(oldest)
		return true
	}
	c.remove(key)
	return true
}

func (c *memoryEntityCache) remove(key string) {
	entry, ok := c.entries[key]
	if !ok {
		return
	}

	delete(c.entries, key)
	if element := c.orderIndex[key]; element != nil {
		c.order.Remove(element)
	}
	delete(c.orderIndex, key)
	if entry.size <= c.currentSize {
		c.currentSize -= entry.size
		return
	}
	c.currentSize = 0
}

func (c *memoryEntityCache) memoryKey(key string) string {
	if c.keyPrefix == "" {
		return key
	}
	return c.keyPrefix + ":" + key
}

func (e memoryEntityCacheEntry) expired(now time.Time) bool {
	return !e.expiresAt.IsZero() && !e.expiresAt.After(now)
}

func (e memoryEntityCacheEntry) remainingTTL(now time.Time) time.Duration {
	if e.expiresAt.IsZero() {
		return 0
	}
	remaining := e.expiresAt.Sub(now)
	if remaining <= 0 {
		return 0
	}
	return remaining
}

func copyBytes(in []byte) []byte {
	if in == nil {
		return nil
	}
	out := make([]byte, len(in))
	copy(out, in)
	return out
}
