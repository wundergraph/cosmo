package in_memory

import (
	"context"
	"time"

	"github.com/wundergraph/cosmo/router/pkg/responsecaching"
)

var _ responsecaching.Invalidator = (*InMemoryCache)(nil)

// InvalidateByTags implements responsecaching.Invalidator.
func (c *InMemoryCache) InvalidateByTags(_ context.Context, tags []string) (int, error) {
	now := time.Now()

	var removed int
	for _, tag := range tags {
		// take removes the tag as it reads it, which is the whole of what
		// deleting the index entry means for this store.
		for _, key := range c.tags.take(tag, now) {
			// Deleted whether or not it is visible yet: a write may still be in
			// ristretto's buffers.
			if _, ok := c.cache.Get(key); ok {
				removed++
			}
			c.cache.Del(key)
		}
	}

	return removed, nil
}
