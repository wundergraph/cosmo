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

// InMemoryCache sweeps every expired entry on each call, so both methods take
// the mutex exclusively, hence a plain Mutex rather than an RWMutex.
// This cache should only be used for tests OR development and never production
type InMemoryCache struct {
	mu      sync.Mutex
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

// GetMany returns one result per key, in the same order as keys. It also drops
// every expired entry, including those no key in this batch asked about.
func (c *InMemoryCache) GetMany(ctx context.Context, keys []string) ([]enginecache.Result, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(keys) == 0 {
		return nil, nil
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	// Sweeping first means anything still present is live, so the lookup below
	// needs no expiry check of its own.
	c.sweepExpired(c.now())

	results := make([]enginecache.Result, len(keys))
	for i, key := range keys {
		entry, ok := c.entries[key]
		if !ok {
			continue
		}
		results[i] = enginecache.Result{Value: bytes.Clone(entry.value), Found: true}
	}

	return results, nil
}

// SetMany stores every item carrying a positive TTL. Items without one are
// skipped and reported as an ErrMissingTTL, the rest of the batch is still
// stored. It otherwise only fails on a cancelled context. It also drops every
// expired entry, including those no lookup has claimed.
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

	// Everything just stored has a deadline in the future, so a batch never
	// sweeps away its own entries.
	c.sweepExpired(now)

	if len(skipped) > 0 {
		return fmt.Errorf("%w: %v", ErrMissingTTL, skipped)
	}

	return nil
}

// sweepExpired drops every entry that has expired by now. The caller must hold
// the mutex. A TTL of d covers [set, set+d), so an entry reaching its deadline
// exactly is already expired.
func (c *InMemoryCache) sweepExpired(now time.Time) {
	for key, entry := range c.entries {
		if !now.Before(entry.expiresAt) {
			delete(c.entries, key)
		}
	}
}
