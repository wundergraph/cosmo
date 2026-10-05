package redis

import (
	"context"
	"errors"
	"slices"
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

// invalidateTag deletes the entries one tag names. Members aren't removed
// outright: one whose entry might still be SET, by a write landing late or a
// walk failing midway, would be left unreachable. Each is marked instead, its
// score set to minus the mark time in ms, and swept by a later walk.
//
// Scores: >= 0 an expiry, < 0 a mark. A write's ZADD GT beats any mark, so a
// rewrite unmarks its member.
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

	// Members scored past this were written after the call started. Negative:
	// only marks are left.
	cutoff := topElement[0].Score

	now := c.now()
	mark := -float64(now.UnixMilli())
	// Marks above this are older than writeGrace + the clock margin: any write
	// extended past its lease has landed, so a delete then a sweep is safe.
	sweepAbove := -float64(now.Add(-(c.writeGrace + markSkewMargin)).UnixMilli())

	// Marks whose every entry was deleted this walk; only those are swept.
	sweepable := make(map[float64]bool)

	// ZSCAN cursor, not rank offset: concurrent writes can't shift it.
	// Members present throughout are returned at least once; repeats harmless.
	var removed int
	var cursor uint64
	for {
		pairs, next, err := c.client.ZScan(ctx, tagKey, cursor, "", invalidationPageSize).Result()
		if err != nil {
			return removed, err
		}

		var live, marked []string
		var marks []float64
		for i := 0; i+1 < len(pairs); i += 2 {
			score, err := strconv.ParseFloat(pairs[i+1], 64)
			if err != nil {
				return removed, err
			}
			switch {
			case score >= 0 && score <= cutoff:
				live = append(live, pairs[i])
			case score < 0:
				// Deleted again: a late save may have landed since.
				marked = append(marked, pairs[i])
				marks = append(marks, score)
			}
		}

		if len(live) > 0 {
			count, err := c.unlinkAndMark(ctx, tagKey, live, mark)
			removed += count
			if err != nil {
				return removed, err
			}
		}

		if len(marked) > 0 {
			cmds, err := c.unlink(ctx, marked)
			ok := answered(cmds, err)
			for i, cmd := range cmds {
				if ok[i] && cmd.Val() == 1 {
					removed++
				}
				if marks[i] > sweepAbove {
					prev, seen := sweepable[marks[i]]
					sweepable[marks[i]] = ok[i] && (prev || !seen)
				}
			}
			if err != nil {
				return removed, err
			}
		}

		if next == 0 {
			break
		}
		cursor = next
	}

	// By exact score: only members still carrying that mark go, so one a
	// write unmarked meanwhile stays. Every member with an old mark was there
	// for the whole scan, so all of them were deleted above.
	pipe := c.client.Pipeline()
	var queued bool
	for m, ok := range sweepable {
		if ok {
			score := strconv.FormatFloat(m, 'f', -1, 64)
			pipe.ZRemRangeByScore(ctx, tagKey, score, score)
			queued = true
		}
	}
	if queued {
		if _, err := pipe.Exec(ctx); err != nil {
			return removed, err
		}
	}
	return removed, nil
}

// unlinkAndMark deletes members' entries, then marks those whose delete was
// answered. XX: never re-adds a member swept meanwhile. A failed delete stays
// unmarked, for a retry.
func (c *RedisCache) unlinkAndMark(ctx context.Context, tagKey string, members []string, mark float64) (int, error) {
	cmds, unlinkErr := c.unlink(ctx, members)
	ok := answered(cmds, unlinkErr)

	var removed int
	toMark := make([]redis.Z, 0, len(members))
	for i, cmd := range cmds {
		if !ok[i] {
			continue
		}
		toMark = append(toMark, redis.Z{Score: mark, Member: members[i]})
		if cmd.Val() == 1 {
			removed++
		}
	}
	if len(toMark) > 0 {
		if err := c.client.ZAddArgs(ctx, tagKey, redis.ZAddArgs{XX: true, Members: toMark}).Err(); err != nil {
			return removed, errors.Join(unlinkErr, err)
		}
	}
	return removed, unlinkErr
}

// answered reports which commands Redis answered. An error no command
// carries means nothing was sent.
func answered(cmds []*redis.IntCmd, err error) []bool {
	sent := err == nil || slices.ContainsFunc(cmds, func(cmd *redis.IntCmd) bool { return cmd.Err() != nil })
	ok := make([]bool, len(cmds))
	for i, cmd := range cmds {
		ok[i] = sent && cmd.Err() == nil
	}
	return ok
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
