package redis

import (
	"context"
	"errors"

	"github.com/redis/go-redis/v9"
	"github.com/wundergraph/cosmo/router/pkg/responsecaching"
)

var _ responsecaching.Invalidator = (*RedisCache)(nil)

// invalidationPageSize bounds how many members are read out of one tag index at
// a time.
const invalidationPageSize = 512

// InvalidateByTags implements responsecaching.Invalidator.
func (c *RedisCache) InvalidateByTags(ctx context.Context, tags []string) (int, error) {
	var removed int64
	var err error
	for _, tag := range tags {
		count, tagErr := c.invalidateTag(ctx, tag)
		removed += count
		err = errors.Join(err, tagErr)
	}

	return int(removed), err
}

// invalidateTag removes the entries one tag names and then the tag itself.
func (c *RedisCache) invalidateTag(ctx context.Context, tag string) (int64, error) {
	tagKey := c.tagKey(tag)

	var removed int64
	for start := int64(0); ; start += invalidationPageSize {
		members, err := c.client.ZRange(ctx, tagKey, start, start+invalidationPageSize-1).Result()
		if err != nil {
			return removed, err
		}
		count, err := c.unlinkEntries(ctx, members)
		removed += count
		if err != nil {
			return removed, err
		}

		// A short page is the last one, and an empty tag gives a short first
		// page, so this ends both.
		if len(members) < invalidationPageSize {
			break
		}
	}

	// Lastly remove the tag set
	if err := c.client.Unlink(ctx, tagKey).Err(); err != nil {
		return removed, err
	}

	return removed, nil
}

// unlinkEntries removes the entries named by members, which are keys as the
// caller of GetMany would spell them.
func (c *RedisCache) unlinkEntries(ctx context.Context, members []string) (int64, error) {
	pipe := c.client.Pipeline()
	cmds := make([]*redis.IntCmd, len(members))
	for i, member := range members {
		cmds[i] = pipe.Unlink(ctx, c.entryKey(member))
	}

	_, err := pipe.Exec(ctx)

	// Counted from the replies rather than from len(members), so an entry that
	// had already expired is not reported as one this call removed.
	var removed int64
	for _, cmd := range cmds {
		if cmd.Err() == nil {
			removed += cmd.Val()
		}
	}

	return removed, err
}
