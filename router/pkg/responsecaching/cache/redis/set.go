package redis

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

// writeLease is how long a tagged entry lives until its index is confirmed.
// It bounds how long a writer dying mid-write can leave an entry unreachable.
const writeLease = 10 * time.Second

// SetMany implements caching.SetMany.
//
// One round trip indexes and SETs tagged entries with a short lease; a second
// extends them to expire at their member's score, only if indexed and the
// first was answered within writeGrace. A walk marks members rather than
// removing them, and sweeps a mark only once older than writeGrace plus a
// margin by redis's clock, deleting its entry first: any extended entry it
// raced has landed by then. A writer dying in between leaves at most a lease-long entry.
//
// Each entry carries its write's token; the second round trip only touches an
// entry still holding it, so never a later write's.
func (c *RedisCache) SetMany(ctx context.Context, items []caching.Item) error {
	if len(items) == 0 {
		return caching.ErrNoItems
	}

	for _, item := range items {
		if item.TTL <= 0 {
			return fmt.Errorf("%w: key %q", caching.ErrMissingTTL, item.Key)
		}
	}

	// Nothing sent yet, so nothing to finish.
	if err := ctx.Err(); err != nil {
		return err
	}

	// One clock reading for the batch. Scoring two items written together as if
	// they were written at different moments would be a distinction without a
	// source.
	now := c.now()

	pipe := c.client.Pipeline()
	c.queuePrunes(ctx, pipe, items, now)

	// A key's last occurrence is the one whose SET won: only it decides.
	last := make(map[string]int, len(items))
	for i, item := range items {
		last[item.Key] = i
	}

	// Index before entry: an entry never exists unindexed. Each command is
	// kept with its item, not read back off Exec by position.
	writes := make([]write, len(items))
	for i, item := range items {
		writes[i] = write{item: item, index: c.queueIndex(ctx, pipe, item, now), last: last[item.Key] == i, header: newHeader()}
	}
	for i := range writes {
		writes[i].set = pipe.Set(ctx, c.entryKey(items[i].Key), encode(writes[i].header, items[i]), leased(items[i]))
	}

	// Monotonic: only the duration matters.
	sent := time.Now()
	cmds, err := pipe.Exec(ctx)
	inGrace := time.Since(sent) < c.writeGrace

	// An error no command carries means nothing was sent.
	if err != nil && !anyCmdErr(cmds) {
		return err
	}

	err = errors.Join(err, c.finishWrites(ctx, writes, now, inGrace))

	// A command is only counted once redis has answered it. Anything still
	// carrying the failure is left out, whether it never arrived or was applied
	// and lost its reply on the way back, so this understates what was written
	// rather than claiming a key that might not be there.
	var stored []string
	for _, w := range writes {
		if w.stored() {
			stored = append(stored, w.item.Key)
		}
	}

	if err == nil {
		return nil
	}
	if len(stored) == 0 {
		return err
	}

	return &caching.SetManyError{KnownStoredKeys: stored, Err: err}
}

// finishWrites is SetMany's second round trip, touching only entries still
// holding their write's header. An entry whose index isn't confirmed is
// removed, not left unreachable. A confirmed one answered within writeGrace
// expires at its member's score, so it never outlives the member; its members
// are lifted to that score too, in case a walk's mark was replaced by a
// shorter write's. Others keep their lease.
func (c *RedisCache) finishWrites(ctx context.Context, writes []write, now time.Time, inGrace bool) error {
	// Entries may be written now, so finish even if the caller gives up.
	ctx = context.WithoutCancel(ctx)

	pipe := c.client.Pipeline()
	lifts := make(map[int][]redis.Cmder)
	for i, w := range writes {
		if len(w.item.Tags) == 0 || !w.last {
			continue
		}
		entryKey := c.entryKey(w.item.Key)
		switch {
		case !w.indexed():
			unlinkOwn.Eval(ctx, pipe, []string{entryKey}, w.header)
		case leased(w.item) < w.item.TTL && w.set.Err() == nil && inGrace:
			score := expiresAt(now, w.item.TTL).UnixMilli()
			for _, tag := range w.item.Tags {
				lifts[i] = append(lifts[i], liftMember.Eval(ctx, pipe, []string{c.tagKey(tag)}, w.item.Key, score))
			}
			extendOwn.Eval(ctx, pipe, []string{entryKey}, w.header, score)
		}
	}
	if pipe.Len() == 0 {
		return nil
	}
	_, err := pipe.Exec(ctx)

	// A member not known lifted may sit below the extension: drop the entry.
	// In a cluster the lift and extension land on different nodes, unordered.
	drop := c.client.Pipeline()
	for i, cmds := range lifts {
		if anyCmdErr(cmds) {
			writes[i].dropped = true
			unlinkOwn.Eval(ctx, drop, []string{c.entryKey(writes[i].item.Key)}, writes[i].header)
		}
	}
	if drop.Len() > 0 {
		_, dropErr := drop.Exec(ctx)
		err = errors.Join(err, dropErr)
	}
	if err != nil {
		return fmt.Errorf("redis adapter: finishing write: %w", err)
	}
	return nil
}

// extendOwn sets KEYS[1] to expire at ARGV[2], in ms, if it still holds the
// write headed ARGV[1]. 16 is headerLen - 1.
var extendOwn = redis.NewScript(`
if redis.call('GETRANGE', KEYS[1], 0, 16) ~= ARGV[1] then return 0 end
return redis.call('PEXPIREAT', KEYS[1], ARGV[2])
`)

// unlinkOwn deletes KEYS[1] if it still holds the write headed ARGV[1].
var unlinkOwn = redis.NewScript(`
if redis.call('GETRANGE', KEYS[1], 0, 16) ~= ARGV[1] then return 0 end
return redis.call('UNLINK', KEYS[1])
`)

// liftMember raises live member ARGV[1] of KEYS[1] to at least ARGV[2]. A mark
// stays: its walk deletes the entry again.
var liftMember = redis.NewScript(`
local s = redis.call('ZSCORE', KEYS[1], ARGV[1])
if s and tonumber(s) >= 0 then
  return redis.call('ZADD', KEYS[1], 'XX', 'GT', ARGV[2], ARGV[1])
end
return 0
`)

// queuePrunes queues one prune per tag the batch names, dropping members more
// than tagIndexPruneGrace past their expiry. From 0: marks are negative, the
// sweep's to remove.
func (c *RedisCache) queuePrunes(ctx context.Context, pipe redis.Pipeliner, items []caching.Item, now time.Time) {
	pruneBefore := strconv.FormatInt(now.Add(-tagIndexPruneGrace).UnixMilli(), 10)
	pruned := make(map[string]struct{})
	for _, item := range items {
		for _, tag := range item.Tags {
			if _, done := pruned[tag]; done {
				continue
			}
			pruned[tag] = struct{}{}
			pipe.ZRemRangeByScore(ctx, c.tagKey(tag), "0", pruneBefore)
		}
	}
}

// expiresAt is when an entry written at now with ttl expires, and its
// member's score, to the millisecond.
func expiresAt(now time.Time, ttl time.Duration) time.Time {
	return time.UnixMilli(now.Add(ttl).UnixMilli())
}

// queueIndex queues item's member and tag TTL updates for each of its tags.
// GT: a write landing out of order never lowers a member's score, which would
// let the prune drop it while a newer entry is alive.
func (c *RedisCache) queueIndex(ctx context.Context, pipe redis.Pipeliner, item caching.Item, now time.Time) []redis.Cmder {
	member := redis.Z{Score: float64(expiresAt(now, item.TTL).UnixMilli()), Member: item.Key}
	// Outlives its entries by the prune grace: entries expire at their
	// score by this router's clock, the key by redis's.
	tagTTL := item.TTL + tagIndexPruneGrace
	cmds := make([]redis.Cmder, 0, len(item.Tags)*3)
	for _, tag := range item.Tags {
		tagKey := c.tagKey(tag)
		cmds = append(cmds,
			pipe.ZAddArgs(ctx, tagKey, redis.ZAddArgs{GT: true, Members: []redis.Z{member}}),
			pipe.ExpireNX(ctx, tagKey, tagTTL),
			pipe.ExpireGT(ctx, tagKey, tagTTL),
		)
	}
	return cmds
}

// write is one item of a SetMany batch and the commands it queued.
type write struct {
	item  caching.Item
	index []redis.Cmder
	set   *redis.StatusCmd
	// last is whether this is the batch's final write of its key.
	last bool
	// header starts the stored entry and identifies this write.
	header []byte
	// dropped is whether finishing deleted the entry.
	dropped bool
}

// indexed reports whether every index command for the write was answered.
func (w write) indexed() bool { return !anyCmdErr(w.index) }

// stored reports whether the write's entry is known stored and reachable.
func (w write) stored() bool { return w.last && w.set.Err() == nil && w.indexed() && !w.dropped }

func anyCmdErr[C redis.Cmder](cmds []C) bool {
	return slices.ContainsFunc(cmds, func(cmd C) bool { return cmd.Err() != nil })
}

// leased is the TTL item is first SET with: the write lease for tagged items
// that outlive it, else its own.
func leased(item caching.Item) time.Duration {
	if len(item.Tags) == 0 {
		return item.TTL
	}
	return min(item.TTL, writeLease)
}

// An entry is headerLen bytes of header, then caching.EncodeItem's encoding.
// The header is headerMarker, never a first byte of that encoding, then a
// random token, so separate writes of identical items differ.
const (
	headerMarker byte = 0
	headerLen         = 17
)

func newHeader() []byte {
	h := make([]byte, headerLen)
	h[0] = headerMarker
	_, _ = rand.Read(h[1:])
	return h
}

func encode(header []byte, item caching.Item) []byte {
	return append(slices.Clip(header), caching.EncodeItem(item)...)
}

// entryBody is a stored entry without its header. One written before headers
// has none.
func entryBody(stored []byte) []byte {
	if len(stored) >= headerLen && stored[0] == headerMarker {
		return stored[headerLen:]
	}
	return stored
}
