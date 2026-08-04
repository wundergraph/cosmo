package cache

import (
	"bytes"
	"context"
	"sync"
	"time"

	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/entitycaching"
)

type inMemoryEntry struct {
	value     []byte
	expiresAt time.Time
}

type InMemoryCache struct {
	mu      sync.RWMutex
	entries map[string]inMemoryEntry
	now     func() time.Time
}

// NewInMemoryCache returns an empty InMemoryCache ready for use.
func NewInMemoryCache() *InMemoryCache {
	return &InMemoryCache{
		entries: make(map[string]inMemoryEntry),
		now:     time.Now,
	}
}

// GetMany returns one result per key, in the same order as keys.
func (c *InMemoryCache) GetMany(ctx context.Context, keys []string) ([]enginecache.Result, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(keys) == 0 {
		return nil, nil
	}

	results := make([]enginecache.Result, len(keys))
	var expired []string

	c.mu.RLock()
	now := c.now()
	for i, key := range keys {
		entry, ok := c.entries[key]
		if !ok {
			continue
		}
		if !entry.expiresAt.IsZero() && now.After(entry.expiresAt) {
			expired = append(expired, key)
			continue
		}
		results[i] = enginecache.Result{Value: bytes.Clone(entry.value)}
	}
	c.mu.RUnlock()

	if len(expired) > 0 {
		c.mu.Lock()
		defer c.mu.Unlock()
		for _, key := range expired {
			// Only drop the entry we observed as expired, it may have been
			// overwritten with a fresh one in the meantime.
			if entry, ok := c.entries[key]; ok && !entry.expiresAt.IsZero() && now.After(entry.expiresAt) {
				delete(c.entries, key)
			}
		}
	}

	return results, nil
}

// SetMany stores every item and never fails, other than on a cancelled context.
func (c *InMemoryCache) SetMany(ctx context.Context, items []enginecache.Item) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	if len(items) == 0 {
		return nil
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	now := c.now()
	for _, item := range items {
		value := bytes.Clone(item.Value)
		if value == nil {
			// A nil value reads back as a miss, so keep stored entries non-nil
			value = []byte{}
		}
		entry := inMemoryEntry{value: value}
		if item.TTL > 0 {
			entry.expiresAt = now.Add(item.TTL)
		}
		c.entries[item.Key] = entry
	}

	return nil
}
