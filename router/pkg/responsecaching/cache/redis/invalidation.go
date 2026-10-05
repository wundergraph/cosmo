package redis

import (
	"context"
	"errors"
	"strconv"

	"github.com/redis/go-redis/v9"
	"github.com/wundergraph/cosmo/router/pkg/responsecaching"
)

var _ responsecaching.Invalidator = (*RedisCache)(nil)

// invalidationPageSize is the ZSCAN COUNT hint per page.
const invalidationPageSize = 512

// InvalidateByTags implements responsecaching.Invalidator.
func (c *RedisCache) InvalidateByTags(ctx context.Context, tags []string) (int, error) {
	var removed int
	var err error
	for _, tag := range tags {
		count, tagErr := c.invalidateTag(ctx, tag)
		removed += count
		err = errors.Join(err, tagErr)
	}

	return removed, err
}

// invalidateTag deletes the entries one tag names. Members stay in the index:
// removing one while its entry might still be SET, by a write landing late or
// a walk failing midway, would leave that entry unreachable. The prune drops
// members once past their score.
func (c *RedisCache) invalidateTag(ctx context.Context, tag string) (int, error) {
	tagKey := c.tagKey(tag)

	// Get only the top element
	topElement, err := c.client.ZRevRangeWithScores(ctx, tagKey, 0, 0).Result()
	if err != nil {
		return 0, err
	}
	if len(topElement) == 0 {
		return 0, nil
	}

	// Members scored past this were written after the call started.
	cutoff := topElement[0].Score

	// ZSCAN cursor, not rank offset: concurrent writes can't shift it.
	// Members present throughout are returned at least once; repeats harmless.
	var removed int
	var cursor uint64
	for {
		pairs, next, err := c.client.ZScan(ctx, tagKey, cursor, "", invalidationPageSize).Result()
		if err != nil {
			return removed, err
		}

		members := make([]string, 0, len(pairs)/2)
		for i := 0; i+1 < len(pairs); i += 2 {
			score, err := strconv.ParseFloat(pairs[i+1], 64)
			if err != nil {
				return removed, err
			}
			if score > cutoff {
				continue
			}
			members = append(members, pairs[i])
		}

		if len(members) > 0 {
			cmds, err := c.unlink(ctx, members)
			for _, cmd := range cmds {
				if cmd.Err() == nil && cmd.Val() == 1 {
					removed++
				}
			}
			if err != nil {
				return removed, err
			}
		}

		if next == 0 {
			return removed, nil
		}
		cursor = next
	}
}

// unlink sends one UNLINK per member's entry: a multi key one fails CROSSSLOT
// in a cluster.
func (c *RedisCache) unlink(ctx context.Context, members []string) ([]*redis.IntCmd, error) {
	pipe := c.client.Pipeline()
	cmds := make([]*redis.IntCmd, len(members))
	for i, member := range members {
		cmds[i] = pipe.Unlink(ctx, c.entryKey(member))
	}
	_, err := pipe.Exec(ctx)
	return cmds, err
}
