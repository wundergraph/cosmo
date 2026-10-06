package redis

import (
	"context"
	"errors"
	"iter"
	"slices"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/wundergraph/cosmo/router/pkg/responsecaching"
)

var _ responsecaching.Invalidator = (*RedisCache)(nil)

// nodeTime returns the clock of the node holding KEYS[1], in ms.
var nodeTime = redis.NewScript(`
local t = redis.call('TIME')
return t[1] * 1000 + math.floor(t[2] / 1000)
`)

// markMembers sets each ARGV member still in KEYS[1] to minus the node's
// time in ms. Stamped at marking, not passed in, so a mark is never older
// than it looks.
var markMembers = redis.NewScript(`
local t = redis.call('TIME')
local mark = -(t[1] * 1000 + math.floor(t[2] / 1000))
for i = 1, #ARGV do
  redis.call('ZADD', KEYS[1], 'XX', mark, ARGV[i])
end
return 0
`)

// invalidationPageSize is the ZSCAN COUNT hint per page.
const invalidationPageSize = 512
const sweepTimeout = 30 * time.Second

// InvalidateByTags implements responsecaching.Invalidator.
func (c *RedisCache) InvalidateByTags(ctx context.Context, tags []string) (int, error) {
	var removed int
	var err error
	for _, tag := range tags {
		count, tagErr := c.invalidateTag(ctx, tag)
		removed += count
		err = errors.Join(err, tagErr)
	}

	go c.sweepLater(slices.Clone(tags))
	return removed, err
}

// sweepTimeout bounds one background sweep.

// sweepLater sweeps tags once this call's marks are old enough, so its marked
// members leave the index without waiting for the next invalidation. Best
// effort: a sweep that fails or never runs leaves its marks to the next walk.
func (c *RedisCache) sweepLater(tags []string) {
	select {
	case <-time.After(c.sweepDelay):
	case <-c.closing.Done():
		return
	}

	ctx, cancel := context.WithTimeout(c.closing, sweepTimeout)
	defer cancel()
	for _, tag := range tags {
		// A cutoff below every live score leaves live members alone.
		_, _ = c.walk(ctx, c.tagKey(tag), -1)
	}
}

// invalidateTag deletes the entries one tag names.
//
// A member's score is its state:
//
//	>= 0  live: the entry's expiry, ms
//	 < 0  marked: minus when its entry was deleted, redis clock, ms
//
// Members aren't removed on delete: a late write may still SET the entry.
// They're marked, and a later walk deletes their entries again and sweeps the
func (c *RedisCache) invalidateTag(ctx context.Context, tag string) (int, error) {
	tagKey := c.tagKey(tag)

	top, err := c.client.ZRevRangeWithScores(ctx, tagKey, 0, 0).Result()
	if err != nil || len(top) == 0 {
		return 0, err
	}
	// Live members above this were written after the walk started.
	cutoff := top[0].Score

	return c.walk(ctx, tagKey, cutoff)
}

// walk deletes the entries of the tag's marked members and of its live members
// scored up to cutoff, marks those live members, and sweeps marks old enough.
func (c *RedisCache) walk(ctx context.Context, tagKey string, cutoff float64) (int, error) {
	// Read before the walk, so marks only ever look younger than they are.
	nowMs, err := nodeTime.Run(ctx, c.client, []string{tagKey}).Int64()
	if err != nil {
		return 0, err
	}
	// Marks before this are old enough that any write they raced has landed.
	sweepBefore := nowMs - (c.writeGrace + sweepMargin).Milliseconds()

	oldMarks := make(map[float64]struct{})
	var removed int
	for pairs, err := range c.scanPages(ctx, tagKey) {
		if err != nil {
			return removed, err
		}

		p, err := classify(pairs, cutoff, sweepBefore)
		if err != nil {
			return removed, err
		}

		count, err := c.invalidatePage(ctx, tagKey, p)
		removed += count
		// Nothing swept: the next walk retries.
		if err != nil {
			return removed, err
		}
		for _, mark := range p.oldMarks {
			oldMarks[mark] = struct{}{}
		}
	}

	return removed, c.sweep(ctx, tagKey, oldMarks)
}

// scanPages yields the tag set's ZSCAN pages as member, score pairs, stopping
// after an error. A cursor, not a rank offset: concurrent writes can't shift
// it. Members present throughout come back at least once; repeats harmless.
func (c *RedisCache) scanPages(ctx context.Context, tagKey string) iter.Seq2[[]string, error] {
	return func(yield func([]string, error) bool) {
		var cursor uint64
		for {
			pairs, next, err := c.client.ZScan(ctx, tagKey, cursor, "", invalidationPageSize).Result()
			if !yield(pairs, err) || err != nil || next == 0 {
				return
			}
			cursor = next
		}
	}
}

// invalidatePage deletes the page's entries, then marks its live members. On a
// failed delete nothing is marked; members keep their scores for a retry.
func (c *RedisCache) invalidatePage(ctx context.Context, tagKey string, p page) (int, error) {
	if len(p.unlink) == 0 {
		return 0, nil
	}
	removed, err := c.unlink(ctx, p.unlink)
	if err != nil || len(p.mark) == 0 {
		return removed, err
	}
	// XX: never re-adds a member swept meanwhile.
	return removed, markMembers.Run(ctx, c.client, []string{tagKey}, p.mark...).Err()
}

// sweep removes members still carrying one of marks. Only reached once every
// page's deletes succeeded. An old mark predates the walk, so each member still
// carrying it was there throughout and its entry was deleted. By exact score:
// a member a write unmarked meanwhile stays.
func (c *RedisCache) sweep(ctx context.Context, tagKey string, marks map[float64]struct{}) error {
	if len(marks) == 0 {
		return nil
	}
	pipe := c.client.Pipeline()
	for mark := range marks {
		score := strconv.FormatFloat(mark, 'f', -1, 64)
		pipe.ZRemRangeByScore(ctx, tagKey, score, score)
	}
	_, err := pipe.Exec(ctx)
	return err
}

// unlink sends one UNLINK per member's entry, as a multi key one fails
// CROSSSLOT in a cluster, and counts the entries deleted. A failed command
// reads as 0.
func (c *RedisCache) unlink(ctx context.Context, members []string) (int, error) {
	pipe := c.client.Pipeline()
	cmds := make([]*redis.IntCmd, len(members))
	for i, member := range members {
		cmds[i] = pipe.Unlink(ctx, c.entryKey(member))
	}
	_, err := pipe.Exec(ctx)

	var removed int
	for _, cmd := range cmds {
		if cmd.Val() == 1 {
			removed++
		}
	}
	return removed, err
}

// classify sorts a ZSCAN page's member, score pairs.
func classify(pairs []string, cutoff float64, sweepBefore int64) (page, error) {
	var p page
	for i := 0; i+1 < len(pairs); i += 2 {
		member := pairs[i]
		score, err := strconv.ParseFloat(pairs[i+1], 64)
		if err != nil {
			return p, err
		}

		switch {
		case score < 0:
			// Deleted again: a late write may have landed since.
			p.unlink = append(p.unlink, member)
			if markedAt := int64(-score); markedAt < sweepBefore {
				p.oldMarks = append(p.oldMarks, score)
			}
		case score <= cutoff:
			p.unlink = append(p.unlink, member)
			p.mark = append(p.mark, member)
		}
		// Otherwise written after the walk started: left for the next one.
	}
	return p, nil
}

// page is what the walk does with one ZSCAN page.
type page struct {
	// unlink is every member whose entry is deleted: live and marked.
	unlink []string
	// mark is the live members, marked once their entries are deleted.
	mark []any
	// oldMarks are marks swept once the walk ends.
	oldMarks []float64
}
