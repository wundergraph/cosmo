package redis

import (
	"context"
	"errors"
	"fmt"
	"iter"
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

// invalidateTag deletes the entries one tag names, walking its set a page at a
// time. Every member is taken, whatever its score: a write landing mid-walk
// may be deleted too, which only costs a miss.
//
// A member's score is its state:
//
//	>= 0  live: the entry's expiry, ms
//	 < 0  marked: minus when a walk deleted its entry, redis clock, ms
//
// A live member is marked between two deletes of its entry, then removed.
// Marking also counts the walk in walksMember, so a write listed before it
// can't be confirmed by a later write's listing.
// Once marked, a page is finished even if ctx is cancelled: a mark left
// behind makes every write of its key delete itself until the next walk. A
// walk that fails or dies midway leaves its marks for the next one, which
// deletes their entries again before removing them.
func (c *RedisCache) invalidateTag(ctx context.Context, tag string) (int, error) {
	tagKey := c.tagKey(tag)

	var leftover []mark
	var removed int
	for pairs, err := range c.scanPages(ctx, tagKey) {
		if err != nil {
			return removed, err
		}
		p, err := classify(pairs)
		if err != nil {
			return removed, err
		}
		count, err := c.invalidatePage(ctx, tagKey, p)
		removed += count
		// Leftover marks stay: the next walk retries.
		if err != nil {
			return removed, err
		}
		leftover = append(leftover, p.marked...)
	}

	// Every page's deletes succeeded, so each leftover mark's entry was
	// deleted after it was placed.
	return removed, c.removeMarks(ctx, tagKey, leftover)
}

// scanPages yields the tag set's ZSCAN pages as member, score pairs, stopping
// after an error. A cursor, not a rank offset: concurrent writes can't shift
// it. Members present throughout come back at least once; repeats harmless.
func (c *RedisCache) scanPages(ctx context.Context, tagKey string) iter.Seq2[[]string, error] {
	return func(yield func([]string, error) bool) {
		var cursor uint64
		for {
			reply, err := c.client.Eval(ctx, scanTag, []string{tagKey}, cursor, invalidationPageSize).Slice()
			var pairs []string
			var next uint64
			if err == nil {
				pairs, next, err = scanReply(reply)
			}
			if !yield(pairs, err) || err != nil || next == 0 {
				return
			}
			cursor = next
		}
	}
}

// scanTag is one ZSCAN page of KEYS[1] from cursor ARGV[1], COUNT ARGV[2]. A
// script, as a cluster client reading from replicas still sends EVAL to the
// primary: a replica behind it can miss members just listed.
const scanTag = `return redis.call('ZSCAN', KEYS[1], ARGV[1], 'COUNT', ARGV[2])`

// scanReply is scanTag's reply as member, score pairs and the next cursor.
func scanReply(reply []any) ([]string, uint64, error) {
	if len(reply) != 2 {
		return nil, 0, fmt.Errorf("redis adapter: ZSCAN reply of %d parts", len(reply))
	}
	raw, ok := reply[0].(string)
	if !ok {
		return nil, 0, fmt.Errorf("redis adapter: ZSCAN cursor %T", reply[0])
	}
	next, err := strconv.ParseUint(raw, 10, 64)
	if err != nil {
		return nil, 0, err
	}
	items, ok := reply[1].([]any)
	if !ok {
		return nil, 0, fmt.Errorf("redis adapter: ZSCAN page %T", reply[1])
	}
	pairs := make([]string, len(items))
	for i, item := range items {
		if pairs[i], ok = item.(string); !ok {
			return nil, 0, fmt.Errorf("redis adapter: ZSCAN item %T", item)
		}
	}
	return pairs, next, nil
}

// invalidatePage invalidates one page in four steps. After a failed step it
// stops, leaving scores or marks for a retry.
func (c *RedisCache) invalidatePage(ctx context.Context, tagKey string, p page) (int, error) {
	if len(p.members) == 0 {
		return 0, nil
	}

	// 1. Delete the entries of every member on the page.
	removed, err := c.unlink(ctx, p.members)
	if err != nil || len(p.live) == 0 {
		return removed, err
	}
	// Nothing marked yet, so stopping here leaves nothing behind.
	if err := ctx.Err(); err != nil {
		return removed, err
	}
	ctx = context.WithoutCancel(ctx)

	// 2. Mark the live members. A write finding its member marked never
	// extends its entry.
	score, err := c.mark(ctx, tagKey, p.live)
	if err != nil {
		return removed, err
	}

	// 3. Delete their entries again: a write may have finished between 1 and 2.
	again, err := c.unlink(ctx, p.live)
	removed += again
	if err != nil {
		return removed, err
	}

	// 4. Remove the marks. A write still landing finds its member marked or
	// gone and deletes its entry.
	own := make([]mark, len(p.live))
	for i, member := range p.live {
		own[i] = mark{member: member, score: score}
	}
	return removed, c.removeMarks(ctx, tagKey, own)
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

// mark marks members still in the tag set and returns the mark's score.
func (c *RedisCache) mark(ctx context.Context, tagKey string, members []string) (string, error) {
	args := make([]any, len(members))
	for i, member := range members {
		args[i] = member
	}
	args = append([]any{walksMember}, args...)
	score, err := markMembers.Run(ctx, c.client, []string{tagKey}, args...).Int64()
	return strconv.FormatInt(score, 10), err
}

// markMembers sets each ARGV member after the first still in KEYS[1] to minus
// the node's time in ms, counts the walk in member ARGV[1], and returns the
// mark. XX: never re-adds a member removed meanwhile. Walks marking in the
// same millisecond share a score, so marks are removed by member, not score.
var markMembers = redis.NewScript(`
local t = redis.call('TIME')
local mark = -(t[1] * 1000 + math.floor(t[2] / 1000))
for i = 2, #ARGV do
  redis.call('ZADD', KEYS[1], 'XX', mark, ARGV[i])
end
if redis.call('EXISTS', KEYS[1]) == 1 then
  redis.call('ZINCRBY', KEYS[1], -1, ARGV[1])
end
return mark
`)

// mark is a marked member and its score as this walk knows it.
type mark struct {
	member string
	score  string
}

// removeMarks removes each member still carrying the score in its mark. A
// member marked again since, by another walk, stays.
func (c *RedisCache) removeMarks(ctx context.Context, tagKey string, marks []mark) error {
	if len(marks) == 0 {
		return nil
	}
	args := make([]any, 0, 2*len(marks))
	for _, m := range marks {
		args = append(args, m.member, m.score)
	}
	pipe := c.client.Pipeline()
	for chunk := range slices.Chunk(args, 2*invalidationPageSize) {
		pipe.Eval(ctx, removeMarked, []string{tagKey}, chunk...)
	}
	_, err := pipe.Exec(ctx)
	return err
}

// removeMarked removes each ARGV member, score pair from KEYS[1] if the member
// still has that score.
const removeMarked = `
for i = 1, #ARGV, 2 do
  local s = redis.call('ZSCORE', KEYS[1], ARGV[i])
  if s and tonumber(s) == tonumber(ARGV[i + 1]) then
    redis.call('ZREM', KEYS[1], ARGV[i])
  end
end
return 0
`

// page is what a walk does with one ZSCAN page.
type page struct {
	// members is every member on the page; all their entries are deleted.
	members []string
	// live is the live members, marked between two deletes.
	live []string
	// marked is the marks left by walks that stopped midway, removed once the
	// walk ends.
	marked []mark
}

// classify sorts a ZSCAN page's member, score pairs into live and marked.
func classify(pairs []string) (page, error) {
	var p page
	for i := 0; i+1 < len(pairs); i += 2 {
		member, raw := pairs[i], pairs[i+1]
		if member == walksMember {
			continue
		}
		score, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			return p, err
		}

		p.members = append(p.members, member)
		if score < 0 {
			p.marked = append(p.marked, mark{member: member, score: raw})
		} else {
			p.live = append(p.live, member)
		}
	}
	return p, nil
}
