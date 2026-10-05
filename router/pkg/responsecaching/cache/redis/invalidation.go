package redis

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
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
	pendingKey, hasPending := c.pendingKey(tag)

	// Deletes owed by earlier walks that didn't finish.
	var removed int
	if hasPending {
		count, err := c.drainPending(ctx, pendingKey)
		removed += count
		if err != nil {
			return removed, err
		}
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
			var count int
			if hasPending {
				count, err = c.removeViaPending(ctx, tagKey, pendingKey, members)
			} else {
				count, err = c.removeEntries(ctx, tagKey, members, scores)
			}
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

// pendingKey is where a tag's owed deletes wait. It must hash to the tag key's
// slot so one script can move members between them; false if no candidate does.
func (c *RedisCache) pendingKey(tag string) (string, bool) {
	tagKey := c.tagKey(tag)
	want := hashTag(tagKey)
	for _, candidate := range []string{
		c.prefix + pendingNamespace + tag,                // reuses a hash tag in tagKey
		c.prefix + pendingNamespace + "{" + tagKey + "}", // tagKey as the hash tag
	} {
		if hashTag(candidate) == want {
			return candidate, true
		}
	}
	return "", false
}

// hashTag is the part of key Redis Cluster hashes: the first non-empty {…},
// else the whole key.
func hashTag(key string) string {
	if s := strings.IndexByte(key, '{'); s >= 0 {
		if e := strings.IndexByte(key[s+1:], '}'); e > 0 {
			return key[s+1 : s+1+e]
		}
	}
	return key
}

// moveToPending atomically moves members still in the index to the pending
// set, keeping their scores. The pending set lives until its last member's
// entry would have expired, plus the prune grace.
// KEYS: index, pending. ARGV: grace ms, members.
var moveToPending = redis.NewScript(`
local latest
for i = 2, #ARGV do
  local score = redis.call('ZSCORE', KEYS[1], ARGV[i])
  if score then
    redis.call('ZREM', KEYS[1], ARGV[i])
    redis.call('ZADD', KEYS[2], score, ARGV[i])
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

// removeViaPending moves members out of the index into the pending set, then
// deletes their entries. Out of the index first: a write SET after the UNLINK
// re-indexes after its SET (see SetMany), so it lands after the move. Until
// its UNLINK is answered a member stays pending, so a walk that fails or dies
// here is finished by the next one.
func (c *RedisCache) removeViaPending(ctx context.Context, tagKey, pendingKey string, members []string) (int, error) {
	args := make([]any, 0, len(members)+1)
	args = append(args, tagIndexPruneGrace.Milliseconds())
	for _, member := range members {
		args = append(args, member)
	}
	if err := moveToPending.Run(ctx, c.client, []string{tagKey, pendingKey}, args...).Err(); err != nil {
		return 0, err
	}
	return c.unlinkPending(ctx, pendingKey, members)
}

// drainPending finishes deletes left in the pending set.
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
			count, err := c.unlinkPending(ctx, pendingKey, members)
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

// unlinkPending deletes members' entries, then clears from the pending set
// only those whose UNLINK was answered.
func (c *RedisCache) unlinkPending(ctx context.Context, pendingKey string, members []string) (int, error) {
	cmds, unlinkErr := c.unlink(ctx, members)

	var removed int
	done := make([]string, 0, len(members))
	for i, cmd := range cmds {
		if cmd.Err() != nil {
			continue
		}
		done = append(done, members[i])
		if cmd.Val() == 1 {
			removed++
		}
	}
	// An error no command carries means nothing was sent.
	if unlinkErr != nil && len(done) == len(members) {
		return removed, unlinkErr
	}
	if len(done) > 0 {
		if err := c.client.ZRem(ctx, pendingKey, done).Err(); err != nil {
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

// removeEntries is the fallback for tags whose pending key can't share the
// tag key's slot: drop members from the index, then their entries, restoring
// members whose UNLINK failed. A walk that dies between the two leaves those
// entries unreachable.
func (c *RedisCache) removeEntries(ctx context.Context, tagKey string, members []string, scores []float64) (int, error) {
	if err := c.client.ZRem(ctx, tagKey, members).Err(); err != nil {
		return 0, err
	}

	// Members are gone now, so finish even if the caller gives up.
	ctx = context.WithoutCancel(ctx)
	cmds, unlinkErr := c.unlink(ctx, members)

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
	pipe := c.client.Pipeline()
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
