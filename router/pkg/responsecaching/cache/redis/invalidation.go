package redis

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"time"

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
		scores := make([]float64, 0, len(pairs)/2)
		for i := 0; i+1 < len(pairs); i += 2 {
			score, err := strconv.ParseFloat(pairs[i+1], 64)
			if err != nil {
				return removed, err
			}
			if score > cutoff {
				continue
			}
			members = append(members, pairs[i])
			scores = append(scores, score)
		}

		if len(members) > 0 {
			count, err := c.removeEntries(ctx, tagKey, members, scores)
			removed += count
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

// removeEntries drops members from the index, then their entries. Member
// first: a write SET after the UNLINK re-indexes after its SET (see SetMany),
// so it lands after this ZREM. Redis drops the set once its last member goes.
func (c *RedisCache) removeEntries(ctx context.Context, tagKey string, members []string, scores []float64) (int, error) {
	if err := c.client.ZRem(ctx, tagKey, members).Err(); err != nil {
		return 0, err
	}

	// Members are gone now, so finish even if the caller gives up.
	ctx = context.WithoutCancel(ctx)

	// Single key UNLINKs: a multi key one fails CROSSSLOT in a cluster.
	pipe := c.client.Pipeline()
	cmds := make([]*redis.IntCmd, len(members))
	for i, member := range members {
		cmds[i] = pipe.Unlink(ctx, c.entryKey(member))
	}
	_, unlinkErr := pipe.Exec(ctx)

	// An error no command carries means nothing was sent.
	sentNothing := unlinkErr != nil && !slices.ContainsFunc(cmds, func(cmd *redis.IntCmd) bool { return cmd.Err() != nil })

	var removed int
	var restore []redis.Z
	var latest float64
	for i, cmd := range cmds {
		switch {
		case cmd.Err() != nil || sentNothing:
			// Entry may still be there; keep it reachable.
			restore = append(restore, redis.Z{Score: scores[i], Member: members[i]})
			latest = max(latest, scores[i])
		case cmd.Val() == 1:
			removed++
		}
	}
	if len(restore) == 0 {
		return removed, unlinkErr
	}

	// GT: never lower a score a concurrent write just raised.
	pipe = c.client.Pipeline()
	pipe.ZAddArgs(ctx, tagKey, redis.ZAddArgs{GT: true, Members: restore})
	if ttl := time.UnixMilli(int64(latest)).Sub(c.now()) + tagIndexPruneGrace; ttl > 0 {
		pipe.ExpireNX(ctx, tagKey, ttl)
		pipe.ExpireGT(ctx, tagKey, ttl)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return removed, errors.Join(unlinkErr, fmt.Errorf("redis adapter: entries left unindexed: %w", err))
	}
	return removed, unlinkErr
}
