package redis

import (
	"context"
	"errors"
	"strconv"

	"github.com/redis/go-redis/v9"
	"github.com/wundergraph/cosmo/router/pkg/responsecaching"
)

var _ responsecaching.Invalidator = (*RedisCache)(nil)

// invalidationPageSize bounds how many members are read out of one tag index at
// a time.
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

// invalidateTag removes the entries one tag names and then the tag itself.
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

	cutoff := strconv.FormatFloat(topElement[0].Score, 'f', -1, 64)
	now := float64(c.now().UnixMilli())

	// Pages come back in score order, so what a page leaves in place sorts
	// ahead of everything unread. The next page starts past those.
	kept := make(map[string]struct{})
	var removed int
	for {
		page, err := c.client.ZRangeByScoreWithScores(ctx, tagKey, &redis.ZRangeBy{
			Min:    "-inf",
			Max:    cutoff,
			Offset: int64(len(kept)),
			Count:  invalidationPageSize,
		}).Result()
		if err != nil {
			return removed, err
		}

		members := make([]string, 0, len(page))
		scores := make([]float64, 0, len(page))
		for _, z := range page {
			member := z.Member.(string)
			if _, seen := kept[member]; seen {
				continue
			}
			members = append(members, member)
			scores = append(scores, z.Score)
		}

		gone, unlinkErr := c.unlinkEntries(ctx, members)

		drop := make([]string, 0, len(members))
		for i, member := range members {
			switch {
			case gone[i]:
				removed++
				drop = append(drop, member)
			case scores[i] > now:
				kept[member] = struct{}{}
			default:
				// Expired on its own; nothing is coming for it.
				drop = append(drop, member)
			}
		}

		// By member, not by score range: a range would also take members of
		// pages not read yet. Redis drops the set once its last member goes.
		if len(drop) > 0 {
			if err := c.client.ZRem(ctx, tagKey, drop).Err(); err != nil {
				return removed, errors.Join(unlinkErr, err)
			}
		}
		if unlinkErr != nil {
			return removed, unlinkErr
		}

		if len(page) < invalidationPageSize {
			return removed, nil
		}
	}
}

// unlinkEntries removes the entries named by members, which are keys as the
// caller of GetMany would spell them.
func (c *RedisCache) unlinkEntries(ctx context.Context, members []string) ([]bool, error) {
	pipe := c.client.Pipeline()
	cmds := make([]*redis.IntCmd, len(members))
	for i, member := range members {
		cmds[i] = pipe.Unlink(ctx, c.entryKey(member))
	}

	// exec's error is only the first command error it finds, or the transport error
	_, err := pipe.Exec(ctx)

	gone := make([]bool, len(members))
	for i, cmd := range cmds {
		// We want to keep members which don't exist (because they maybe in the process of it being written)
		// if they are expired they are cleaned up on SetTTL
		gone[i] = cmd.Err() == nil && cmd.Val() == 1
	}

	return gone, err
}
