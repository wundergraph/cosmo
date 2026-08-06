package in_memory

import (
	"bytes"
	"context"
	"fmt"
	"math"
	"sync"

	"github.com/dgraph-io/ristretto/v2"
	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/entitycaching"
)

const entryCost = 1
const maxSize = math.MaxInt32

type InMemoryCache struct {
	cache *ristretto.Cache[string, []byte]
	// closeOnce keeps Close idempotent, so two shutdown paths reaching it is
	// not a panic on a channel ristretto has already closed.
	closeOnce sync.Once
}

// NewInMemoryCache returns a cache holding at most maxEntries entries. The
// caller owns it and must Close it.
func NewInMemoryCache(maxEntries int64) (*InMemoryCache, error) {
	if maxEntries <= 0 {
		return nil, fmt.Errorf("in memory entity cache needs a positive size, got %d", maxEntries)
	}
	if maxEntries > maxSize {
		return nil, fmt.Errorf("in memory entity cache size is too large: %d", maxEntries)
	}

	cache, err := ristretto.NewCache(&ristretto.Config[string, []byte]{
		MaxCost:            maxEntries,
		NumCounters:        maxEntries * 10,
		IgnoreInternalCost: true,
		BufferItems:        64,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create in memory entity cache: %w", err)
	}

	return &InMemoryCache{cache: cache}, nil
}

// GetMany returns the entries it found, keyed by the key they were asked for.
func (c *InMemoryCache) GetMany(ctx context.Context, keys []string) (map[string]enginecache.Item, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	if len(keys) == 0 {
		return nil, nil
	}

	results := make(map[string]enginecache.Item, len(keys))
	for _, key := range keys {
		// In case there are duplicate keys, ignore duplicate fetches
		if _, found := results[key]; found {
			continue
		}

		// We need to do getTTL OR store the expiration date on the entry
		// however doing the latter still means that its a different value
		// from the expiration date the ristretto uses internally
		value, getOk := c.cache.Get(key)
		ttl, ttlOk := c.cache.GetTTL(key)

		// Either the key does not exist, or it just expired now
		if !getOk || !ttlOk || ttl <= 0 {
			continue
		}

		results[key] = enginecache.Item{Key: key, Value: bytes.Clone(value), TTL: ttl}
	}

	return results, nil
}

// SetMany stores every item, all of which must carry a positive TTL. A single
// item without one fails the whole batch with an ErrMissingTTL and nothing is
// stored. It otherwise only fails on a cancelled context.
func (c *InMemoryCache) SetMany(ctx context.Context, items []enginecache.Item) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	if len(items) == 0 {
		return nil
	}

	// Map used for deduplications
	last := make(map[string]enginecache.Item, len(items))

	for _, item := range items {
		if item.TTL <= 0 {
			return fmt.Errorf("%w: key %q", enginecache.ErrMissingTTL, item.Key)
		}
		// In case  user sends same key, use the last entry to save
		last[item.Key] = item
	}

	for _, item := range last {
		c.cache.SetWithTTL(item.Key, bytes.Clone(item.Value), entryCost, item.TTL)
	}

	c.cache.Wait()
	return nil
}

// Close stops the goroutines ristretto runs behind the cache. It is safe to
// call more than once, but not while a GetMany or a SetMany is in flight.
func (c *InMemoryCache) Close() {
	c.closeOnce.Do(c.cache.Close)
}
