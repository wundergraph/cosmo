package redis

import (
	"context"
	"errors"
	"iter"
	"slices"
	"strconv"

	"github.com/redis/go-redis/v9"
	"github.com/wundergraph/cosmo/router/pkg/responsecaching"
)

var _ responsecaching.Invalidator = (*RedisCache)(nil)

// markMembers sets each ARGV member still in KEYS[1] to minus the node's
// time in ms, and returns that mark. Walks marking in the same millisecond
// share a score; marks are removed by member, not score.
var markMembers = redis.NewScript(`
local t = redis.call('TIME')
local mark = -(t[1] * 1000 + math.floor(t[2] / 1000))
for i = 1, #ARGV do
  redis.call('ZADD', KEYS[1], 'XX', mark, ARGV[i])
end
return mark
`)

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

// invalidateTag deletes the entries one tag names.
//
// A member's score is its state:
//
//	>= 0  live: the entry's expiry, ms
//	 < 0  marked: minus when its entry was deleted, redis clock, ms
//
// Members aren't removed on delete: a late write may still SET the entry.
// They're marked, their entries deleted again, then the marks removed. A walk
// that stops midway leaves its marks for the next one.
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
// scored up to cutoff, and sweeps the marks it read, left by walks that
// stopped midway.
// A write never extends an entry whose member is marked or gone, so a mark can
// go as soon as its entry is deleted again.
func (c *RedisCache) walk(ctx context.Context, tagKey string, cutoff float64) (int, error) {
	var marks []any
	var removed int
	for pairs, err := range c.scanPages(ctx, tagKey) {
		if err != nil {
			return removed, err
		}

		p, err := classify(pairs, cutoff)
		if err != nil {
			return removed, err
		}

		count, err := c.invalidatePage(ctx, tagKey, p)
		removed += count
		// Nothing swept: the next walk retries.
		if err != nil {
			return removed, err
		}
		marks = append(marks, p.marks...)
	}

	return removed, c.sweep(ctx, tagKey, marks)
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

// invalidatePage deletes the page's entries, marks its live members, then
// deletes their entries again, so a write landing between the first delete
// and the mark is deleted too, then removes its marks. A write after the mark
// finds its member marked or gone and never extends, so it keeps its lease.
// On a failed delete nothing more happens; members keep their scores or marks
// for a retry.
func (c *RedisCache) invalidatePage(ctx context.Context, tagKey string, p page) (int, error) {
	if len(p.unlink) == 0 {
		return 0, nil
	}
	removed, err := c.unlink(ctx, p.unlink)
	if err != nil || len(p.mark) == 0 {
		return removed, err
	}
	// XX: never re-adds a member removed meanwhile.
	mark, err := markMembers.Run(ctx, c.client, []string{tagKey}, p.mark...).Int64()
	if err != nil {
		return removed, err
	}
	marked := make([]string, len(p.mark))
	own := make([]any, 0, 2*len(p.mark))
	score := strconv.FormatInt(mark, 10)
	for i, member := range p.mark {
		marked[i] = member.(string)
		own = append(own, member, score)
	}
	again, err := c.unlink(ctx, marked)
	removed += again
	if err != nil {
		return removed, err
	}
	return removed, removeMarks.Run(ctx, c.client, []string{tagKey}, own...).Err()
}

// sweep removes the marked members the walk read, as member, score pairs, each
// only if still carrying the mark it read. Only reached once every page's
// deletes succeeded, so each had its entry deleted after its mark. By member,
// not score: another walk marking in the same millisecond shares the score,
// and its members weren't deleted by this walk.
func (c *RedisCache) sweep(ctx context.Context, tagKey string, marks []any) error {
	if len(marks) == 0 {
		return nil
	}
	pipe := c.client.Pipeline()
	for chunk := range slices.Chunk(marks, 2*invalidationPageSize) {
		removeMarks.Eval(ctx, pipe, []string{tagKey}, chunk...)
	}
	_, err := pipe.Exec(ctx)
	return err
}

// removeMarks removes each ARGV member, score pair from KEYS[1] if the member
// still has that score.
var removeMarks = redis.NewScript(`
for i = 1, #ARGV, 2 do
  local s = redis.call('ZSCORE', KEYS[1], ARGV[i])
  if s and tonumber(s) == tonumber(ARGV[i + 1]) then
    redis.call('ZREM', KEYS[1], ARGV[i])
  end
end
return 0
`)

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
func classify(pairs []string, cutoff float64) (page, error) {
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
			p.marks = append(p.marks, member, pairs[i+1])
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
	// marks are the page's marked members and their scores as read, swept
	// once the walk ends.
	marks []any
}
