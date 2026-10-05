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

// invalidateTag removes the entries one tag names and then the tag itself.
func (c *RedisCache) invalidateTag(ctx context.Context, tag string) (int, error) {
	tagKey, pendingKey := c.tagKey(tag), c.pendingKey(tag)

	// Deletes owed by earlier walks that didn't finish.
	removed, err := c.drainPending(ctx, pendingKey)
	if err != nil {
		return removed, err
	}

	// Get only the top element
	topElement, err := c.client.ZRevRangeWithScores(ctx, tagKey, 0, 0).Result()
	if err != nil {
		return removed, err
	}
	if len(topElement) == 0 {
		return removed, nil
	}

	// Members scored past this were written after the call started.
	cutoff := topElement[0].Score

	// ZSCAN cursor, not rank offset: concurrent writes can't shift it.
	// Members present throughout are returned at least once; repeats harmless.
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
			count, err := c.removeViaPending(ctx, tagKey, pendingKey, members)
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

// moveToPending atomically moves members still in the index to the pending
// set, scored with when they moved by this node's clock. The pending set lives
// until its last member's entry would have expired, plus the prune grace.
// KEYS: index, pending. ARGV: prune grace ms, members.
var moveToPending = redis.NewScript(`
local t = redis.call('TIME')
local moved = t[1] * 1000 + math.floor(t[2] / 1000)
local latest
for i = 2, #ARGV do
  local score = redis.call('ZSCORE', KEYS[1], ARGV[i])
  if score then
    redis.call('ZREM', KEYS[1], ARGV[i])
    redis.call('ZADD', KEYS[2], moved, ARGV[i])
    score = tonumber(score)
    if not latest or score > latest then latest = score end
  end
end
if latest then
  local at = latest + tonumber(ARGV[1])
  redis.call('PEXPIREAT', KEYS[2], at, 'NX')
  redis.call('PEXPIREAT', KEYS[2], at, 'GT')
end
return 0
`)

// agedPending returns the members moved to the pending set more than the
// write grace ago, by this node's clock.
// KEYS: pending. ARGV: write grace ms, members.
var agedPending = redis.NewScript(`
local t = redis.call('TIME')
local before = t[1] * 1000 + math.floor(t[2] / 1000) - tonumber(ARGV[1])
local aged = {}
for i = 2, #ARGV do
  local moved = redis.call('ZSCORE', KEYS[1], ARGV[i])
  if moved and tonumber(moved) < before then
    aged[#aged + 1] = ARGV[i]
  end
end
return aged
`)

// removeViaPending moves members out of the index into the pending set, then
// deletes their entries. Members stay pending: a write that indexed before the
// move may still SET after this UNLINK, and only a drain past writeGrace,
// which UNLINKs again first, may clear them (see SetMany).
func (c *RedisCache) removeViaPending(ctx context.Context, tagKey, pendingKey string, members []string) (int, error) {
	args := make([]any, 0, len(members)+1)
	args = append(args, tagIndexPruneGrace.Milliseconds())
	for _, member := range members {
		args = append(args, member)
	}
	if err := moveToPending.Run(ctx, c.client, []string{tagKey, pendingKey}, args...).Err(); err != nil {
		return 0, err
	}

	cmds, err := c.unlink(ctx, members)
	var removed int
	for _, cmd := range cmds {
		if cmd.Err() == nil && cmd.Val() == 1 {
			removed++
		}
	}
	return removed, err
}

// drainPending deletes the entries of every pending member, then clears the
// members that had been pending longer than writeGrace before that UNLINK.
func (c *RedisCache) drainPending(ctx context.Context, pendingKey string) (int, error) {
	var removed int
	var cursor uint64
	for {
		pairs, next, err := c.client.ZScan(ctx, pendingKey, cursor, "", invalidationPageSize).Result()
		if err != nil {
			return removed, err
		}
		members := make([]string, 0, len(pairs)/2)
		for i := 0; i+1 < len(pairs); i += 2 {
			members = append(members, pairs[i])
		}
		if len(members) > 0 {
			count, err := c.drainPage(ctx, pendingKey, members)
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

func (c *RedisCache) drainPage(ctx context.Context, pendingKey string, members []string) (int, error) {
	// Aged before the UNLINK, so a late SET can't slip in after it.
	args := make([]any, 0, len(members)+1)
	args = append(args, c.writeGrace.Milliseconds())
	for _, member := range members {
		args = append(args, member)
	}
	aged, err := agedPending.Run(ctx, c.client, []string{pendingKey}, args...).StringSlice()
	if err != nil {
		return 0, err
	}

	cmds, unlinkErr := c.unlink(ctx, members)
	answered := make(map[string]bool, len(members))
	var removed int
	for i, cmd := range cmds {
		if cmd.Err() != nil {
			continue
		}
		answered[members[i]] = true
		if cmd.Val() == 1 {
			removed++
		}
	}
	// An error no command carries means nothing was sent.
	if unlinkErr != nil && len(answered) == len(members) {
		return removed, unlinkErr
	}

	clear := make([]string, 0, len(aged))
	for _, member := range aged {
		if answered[member] {
			clear = append(clear, member)
		}
	}
	if len(clear) > 0 {
		if err := c.client.ZRem(ctx, pendingKey, clear).Err(); err != nil {
			return removed, errors.Join(unlinkErr, err)
		}
	}
	return removed, unlinkErr
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
