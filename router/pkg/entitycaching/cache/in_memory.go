package cache

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/entitycaching"
)

// ErrMissingTTL reports items that were rejected because they carried no
// positive TTL. Every cached entry expires, so a TTL is mandatory.
var ErrMissingTTL = errors.New("cache item requires a positive TTL")

type inMemoryEntry struct {
	value []byte
	// expiresAt is always set, an entry without an expiry is never stored.
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
		if now.After(entry.expiresAt) {
			expired = append(expired, key)
			continue
		}
		results[i] = enginecache.Result{Value: bytes.Clone(entry.value), Found: true}
	}
	c.mu.RUnlock()

	if len(expired) > 0 {
		c.mu.Lock()
		defer c.mu.Unlock()
		for _, key := range expired {
			// Only drop the entry we observed as expired, it may have been
			// overwritten with a fresh one in the meantime.
			if entry, ok := c.entries[key]; ok && now.After(entry.expiresAt) {
				delete(c.entries, key)
			}
		}
	}

	return results, nil
}

// SetMany stores every item carrying a positive TTL. Items without one are
// skipped and reported as an ErrMissingTTL, the rest of the batch is still
// stored. It otherwise only fails on a cancelled context.
func (c *InMemoryCache) SetMany(ctx context.Context, items []enginecache.Item) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	if len(items) == 0 {
		return nil
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	var skipped []string

	now := c.now()
	for _, item := range items {
		if item.TTL <= 0 {
			skipped = append(skipped, item.Key)
			continue
		}
		c.entries[item.Key] = inMemoryEntry{
			value:     bytes.Clone(item.Value),
			expiresAt: now.Add(item.TTL),
		}
	}

	if len(skipped) > 0 {
		return fmt.Errorf("%w: %v", ErrMissingTTL, skipped)
	}

	return nil
}
