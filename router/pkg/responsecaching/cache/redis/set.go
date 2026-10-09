package redis

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math"
	"slices"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

// writeLease is how long a tagged entry lives until its index is confirmed.
// It bounds how long a writer dying mid-write can leave an entry unreachable.
const writeLease = 10 * time.Second

// Scores and the prune bound are taken from the tag's node clock, never the
// router's: a router's skew can't drop a live member or outlive a tag set.

// pruneTag drops members of KEYS[1] more than ARGV[1] ms past their expiry.
// From 0: marks are negative, the walk's to remove.
const pruneTag = `
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
return redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - ARGV[1])
`

// addMember adds ARGV[1] to KEYS[1] expiring ARGV[2] ms from now, or raises it
// there. GT: a write landing out of order never lowers a member's score, which
// would let the prune drop it while a newer entry is alive. A mark stays: only
// a walk removes it, after deleting its entry, so a write that never lands
// can't take with it the walk's duty to delete what came before.
const addMember = `
local s = redis.call('ZSCORE', KEYS[1], ARGV[1])
if s and tonumber(s) < 0 then return 0 end
local t = redis.call('TIME')
local at = t[1] * 1000 + math.floor(t[2] / 1000) + ARGV[2]
return redis.call('ZADD', KEYS[1], 'GT', at, ARGV[1])
`

// liftMember raises live member ARGV[1] of KEYS[1] to expire at least ARGV[2]
// ms from now, extends KEYS[1] to live at least ARGV[3] ms, and returns that
// expiry. The set may have been emptied and recreated by a shorter write since
// this one's tag add. A marked or missing member is left alone: 0.
const liftMember = `
local s = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not s or tonumber(s) < 0 then return 0 end
local t = redis.call('TIME')
local at = t[1] * 1000 + math.floor(t[2] / 1000) + ARGV[2]
redis.call('ZADD', KEYS[1], 'XX', 'GT', at, ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[3], 'GT')
return at
`

// unlinkOwn deletes KEYS[1] if it still holds the write headed ARGV[1].
const unlinkOwn = `
if redis.call('GETRANGE', KEYS[1], 0, 16) ~= ARGV[1] then return 0 end
return redis.call('UNLINK', KEYS[1])
`

// extendOwn sets KEYS[1] to expire at ARGV[2], in ms, if it still holds the
// write headed ARGV[1]. 16 is headerLen - 1.
const extendOwn = `
if redis.call('GETRANGE', KEYS[1], 0, 16) ~= ARGV[1] then return 0 end
return redis.call('PEXPIREAT', KEYS[1], ARGV[2])
`

// SetMany implements caching.SetMany.
//
// A tagged entry takes up to three round trips:
//
//  1. indexAndStore: add it to its tags, then SET it with its token and a
//     short lease.
//  2. checkListings: confirm each tag still lists it live, raising the member in the tag set
//     to the entry's expiry. An entry whose index failed is removed instead.
//  3. extendConfirmed: extend it only if every tag confirmed it, to the
//     earliest expiry its lifts set.
//
// So an extended entry is always listed. Anything unconfirmed, or a writer
// dying in between, leaves only a lease-long entry (10s). The token keeps each step
// to this write's own entry, never a later one's.
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

	writes, err := c.indexAndStore(ctx, items)
	if writes == nil {
		return err
	}

	finErr := c.finishWrites(ctx, writes)
	return result(writes, errors.Join(err, finErr))
}

// indexAndStore is round trip 1: prune each tag, add every item to its tags,
// then SET each. Index before entry: an entry never exists unindexed. It
// returns no writes if nothing was sent.
func (c *RedisCache) indexAndStore(ctx context.Context, items []caching.Item) ([]write, error) {
	pipe := c.client.Pipeline()
	c.queuePrunes(ctx, pipe, items)

	writes := newWrites(items)
	for i := range writes {
		writes[i].index = c.queueIndex(ctx, pipe, writes[i].item)
	}
	for i := range writes {
		w := &writes[i]
		w.set = pipe.Set(ctx, c.entryKey(w.item.Key), encode(w.header, w.item), leased(w.item))
	}

	cmds, err := pipe.Exec(ctx)
	// An error no command carries means nothing was sent.
	if err != nil && !anyCmdErr(cmds) {
		return nil, err
	}
	return writes, err
}

// queuePrunes queues one prune per tag the batch names, dropping members more
// than tagIndexPruneGrace past their expiry.
func (c *RedisCache) queuePrunes(ctx context.Context, pipe redis.Pipeliner, items []caching.Item) {
	grace := tagIndexPruneGrace.Milliseconds()
	pruned := make(map[string]struct{})
	for _, item := range items {
		for _, tag := range item.Tags {
			if _, done := pruned[tag]; done {
				continue
			}
			pruned[tag] = struct{}{}
			pipe.Eval(ctx, pruneTag, []string{c.tagKey(tag)}, grace)
		}
	}
}

// queueIndex queues item's member and tag TTL updates for each of its tags.
func (c *RedisCache) queueIndex(ctx context.Context, pipe redis.Pipeliner, item caching.Item) []redis.Cmder {
	ttl := item.TTL.Milliseconds()
	tagTTL := tagLifetime(item)
	cmds := make([]redis.Cmder, 0, len(item.Tags)*3)
	for _, tag := range item.Tags {
		tagKey := c.tagKey(tag)
		cmds = append(cmds,
			pipe.Eval(ctx, addMember, []string{tagKey}, item.Key, ttl),
			pipe.ExpireNX(ctx, tagKey, tagTTL),
			pipe.ExpireGT(ctx, tagKey, tagTTL),
		)
	}
	return cmds
}

// finishWrites is round trips 2 and 3.
func (c *RedisCache) finishWrites(ctx context.Context, writes []write) error {
	// Entries may be written now, so finish even if the caller gives up.
	ctx = context.WithoutCancel(ctx)

	lifts, err := c.checkListings(ctx, writes)
	extErr := c.extendConfirmed(ctx, writes, lifts)

	err = errors.Join(err, extErr)
	if err != nil {
		return fmt.Errorf("redis adapter: finishing write: %w", err)
	}
	return nil
}

// checkListings is round trip 2. An entry whose index failed is removed, not
// left unreachable. One to extend has each tag's member lifted to its expiry;
// the lifts are returned by write.
func (c *RedisCache) checkListings(ctx context.Context, writes []write) (map[int][]*redis.Cmd, error) {
	pipe := c.client.Pipeline()
	lifts := make(map[int][]*redis.Cmd)
	for i, w := range writes {
		if !w.finishes() {
			continue
		}
		switch {
		case !w.indexed():
			pipe.Eval(ctx, unlinkOwn, []string{c.entryKey(w.item.Key)}, w.header)
		case w.extends():
			ttl := w.item.TTL.Milliseconds()
			tagTTL := tagLifetime(w.item).Milliseconds()
			for _, tag := range w.item.Tags {
				lifts[i] = append(lifts[i], pipe.Eval(ctx, liftMember, []string{c.tagKey(tag)}, w.item.Key, ttl, tagTTL))
			}
		}
	}
	if pipe.Len() == 0 {
		return nil, nil
	}
	_, err := pipe.Exec(ctx)
	return lifts, err
}

// extendConfirmed is round trip 3: it extends each entry whose every lift
// found its member live, to the earliest expiry they set, so it dies before
// any of its members. Others keep their lease. It waits on the lifts as they
// and the entry may sit on different nodes.
func (c *RedisCache) extendConfirmed(ctx context.Context, writes []write, lifts map[int][]*redis.Cmd) error {
	pipe := c.client.Pipeline()
	for i, cmds := range lifts {
		w := &writes[i]
		at, ok := earliestLift(cmds)
		if !ok {
			w.unconfirmed = true
			continue
		}
		pipe.Eval(ctx, extendOwn, []string{c.entryKey(w.item.Key)}, w.header, at)
	}
	if pipe.Len() == 0 {
		return nil
	}
	_, err := pipe.Exec(ctx)
	return err
}

// earliestLift is the earliest expiry the lifts set, in ms, and whether every
// lift found its member live.
func earliestLift(lifts []*redis.Cmd) (int64, bool) {
	earliest := int64(math.MaxInt64)
	for _, lift := range lifts {
		at, err := lift.Int64()
		if err != nil || at <= 0 {
			return 0, false
		}
		earliest = min(earliest, at)
	}
	return earliest, len(lifts) > 0
}

// result is SetMany's answer: err, naming the keys known stored if any.
//
// A command is only counted once redis has answered it. Anything still
// carrying the failure is left out, whether it never arrived or was applied
// and lost its reply on the way back, so this understates what was written
// rather than claiming a key that might not be there.
func result(writes []write, err error) error {
	if err == nil {
		return nil
	}
	var stored []string
	for _, w := range writes {
		if w.stored() {
			stored = append(stored, w.item.Key)
		}
	}
	if len(stored) == 0 {
		return err
	}
	return &caching.SetManyError{KnownStoredKeys: stored, Err: err}
}

// write is one item of a SetMany batch and the commands it queued.
type write struct {
	item  caching.Item
	index []redis.Cmder
	set   *redis.StatusCmd
	// last is whether this is the batch's final write of its key, the one
	// whose SET won.
	last bool
	// header starts the stored entry and identifies this write.
	header []byte
	// unconfirmed is whether a lift didn't find its member live, so the entry
	// keeps its lease and may be unlisted.
	unconfirmed bool
}

// newWrites returns a write per item, each with its own header.
func newWrites(items []caching.Item) []write {
	last := make(map[string]int, len(items))
	for i, item := range items {
		last[item.Key] = i
	}
	writes := make([]write, len(items))
	for i, item := range items {
		writes[i] = write{item: item, last: last[item.Key] == i, header: newHeader()}
	}
	return writes
}

// finishes reports whether the write has rounds 2 and 3: tagged, and the
// batch's last write of its key.
func (w write) finishes() bool { return len(w.item.Tags) > 0 && w.last }

// extends reports whether the write's entry is to be extended past its lease.
func (w write) extends() bool {
	return leased(w.item) < w.item.TTL && w.indexed() && w.set.Err() == nil
}

// indexed reports whether every index command for the write was answered.
func (w write) indexed() bool { return !anyCmdErr(w.index) }

// stored reports whether the write's entry is known stored and reachable.
func (w write) stored() bool { return w.last && w.set.Err() == nil && w.indexed() && !w.unconfirmed }

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

// tagLifetime is how long item's tag sets live at least: past its entry by the
// prune grace, as the entry and its sets may sit on nodes with different
// clocks.
func tagLifetime(item caching.Item) time.Duration {
	return item.TTL + tagIndexPruneGrace
}

// An entry is headerLen bytes of header, then caching.EncodeItem's encoding.
// The header is headerMarker, never a first byte of that encoding, then a
// random token, so separate writes of identical items differ.
const (
	headerMarker byte = 0
	headerLen    int  = 17
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
