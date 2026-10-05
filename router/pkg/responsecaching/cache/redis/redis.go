package redis

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

// RedisCache stores entries in Redis.
type RedisCache struct {
	// client is owned by this cache once construction succeeds, and Close
	// closes it. It is a UniversalClient so a single, cluster or sentinel
	// client all fit without this cache having to know which one it got.
	client redis.UniversalClient
	// closeOnce keeps Close idempotent, and closeErr keeps every caller after
	// the first answering the same thing the first one was told.
	closeOnce sync.Once
	closeErr  error
	// prefix is prepended to every key before it reaches redis, so response cache
	// entries stay in their own namespace and cannot collide with anything else
	// sharing the instance. It is applied on the way in and stripped back off on
	// the way out, so callers only ever see the keys they asked with. An empty
	// prefix is valid and means the keys are used as they are.
	prefix string
	now    func() time.Time
	// writeGrace bounds a write's first round trip for its entry to be
	// extended; a walk's sweep relies on it. Only tests change it.
	writeGrace time.Duration
}

var _ caching.Cache = (*RedisCache)(nil)

const (
	entryNamespace = "e:"
	tagNamespace   = "t:"
)

// tagIndexPruneGrace is how long past its score a member stays in a tag index.
const tagIndexPruneGrace = 5 * time.Minute

// writeLease is how long a tagged entry lives until its index is confirmed.
// It bounds how long a writer dying mid-write can leave an entry unreachable.
const writeLease = 10 * time.Second

// defaultWriteGrace is writeGrace outside tests. Shorter than writeLease.
const defaultWriteGrace = 5 * time.Second

// markSkewMargin is how far apart router clocks may be: a mark is swept once
// older than writeGrace plus this, by the sweeping router's clock.
const markSkewMargin = time.Minute

// entryKey is where an entry's value lives.
func (c *RedisCache) entryKey(key string) string { return c.prefix + entryNamespace + key }

// tagKey is where the set of entries carrying tag lives.
func (c *RedisCache) tagKey(tag string) string { return c.prefix + tagNamespace + tag }

// NewRedisCache returns a cache backed by client, namespacing every key with
// prefix. On success the cache takes ownership of client and closes it in
// Close, so the caller must not close it independently; if construction fails
// the client is untouched and closing it stays with the caller.
// rediscloser.RDCloser satisfies redis.UniversalClient, so a client built by
// rediscloser.NewRedisCloser can be passed straight in.
func NewRedisCache(ctx context.Context, client redis.UniversalClient, prefix string) (*RedisCache, error) {
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("unable to connect to redis: %w", err)
	}

	return &RedisCache{client: client, prefix: prefix, now: time.Now, writeGrace: defaultWriteGrace}, nil
}

// GetMany implements caching.GetMany.
func (c *RedisCache) GetMany(ctx context.Context, keys []string) (map[string]caching.Item, error) {
	if len(keys) == 0 {
		return nil, caching.ErrNoKeys
	}

	// A pipeline of GETs rather than a single MGET: go-redis splits a pipeline
	// across cluster nodes, while MGET fails with CROSSSLOT as soon as the keys
	// span slots.
	//
	// Each key costs a second command, a PTTL, because a GET only hands back
	// the value and the lifetime it has left has to be asked for separately.
	// That doubles the commands but not the round trips, the pipeline is still
	// one write and one read, and a PTTL is O(1) server side. The pair is
	// queued together so the window in which the key can expire between the two
	// stays one command wide, but they are still not atomic and the loop below
	// is written to survive that.
	pipe := c.client.Pipeline()
	values := make([]*redis.StringCmd, len(keys))
	ttls := make([]*redis.DurationCmd, len(keys))
	for i, key := range keys {
		prefixed := c.entryKey(key)
		values[i] = pipe.Get(ctx, prefixed)
		ttls[i] = pipe.PTTL(ctx, prefixed)
	}

	// A miss surfaces as redis.Nil, which is not a failure of the batch. A PTTL
	// never reports a missing key that way, it answers with a negative
	// duration, so every redis.Nil in here came from a GET.
	_, err := pipe.Exec(ctx)
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, err
	}

	// Sized for every key finding something, which is the case worth being
	// ready for. A miss adds nothing, so the map is only as big as the hits.
	results := make(map[string]caching.Item, len(keys))
	for i, key := range keys {
		value, err := values[i].Bytes()
		if err != nil {
			if errors.Is(err, redis.Nil) {
				continue
			}
			// There is no partial read to salvage, the whole batch fails.
			return nil, fmt.Errorf("redis adapter get %q: %w", key, err)
		}

		ttl, err := ttls[i].Result()
		if err != nil {
			return nil, fmt.Errorf("redis adapter pttl %q: %w", key, err)
		}

		if ttl <= 0 {
			continue
		}

		decoded, surrogateKeys, vary, err := caching.DecodeEntry(value)
		if err != nil {
			return nil, fmt.Errorf("redis adapter decode %q: %w", key, err)
		}

		// Keyed by what the caller asked with, not the prefixed key it was
		// stored under: the namespace is this cache's business, not theirs.
		results[key] = caching.Item{Key: key, Value: bytes.Clone(decoded), TTL: ttl, SurrogateKeys: surrogateKeys, Vary: vary}
	}

	return results, nil
}

// SetMany implements caching.SetMany.
//
// One round trip indexes and SETs tagged entries with a short lease; a second
// extends them to expire at their member's score, only if indexed and the
// first was answered within writeGrace. A walk marks members rather than
// removing them, and sweeps a mark only once older than writeGrace plus the
// clock margin, deleting its entry first: any extended entry it raced has
// landed by then. A writer dying in between leaves at most a lease-long entry.
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
	pruneBefore := strconv.FormatInt(now.Add(-tagIndexPruneGrace).UnixMilli(), 10)

	// One prune per tag rather than per member of it: ten entities answered
	// under one subgraph tag would otherwise queue the same removal ten times.
	pruned := make(map[string]struct{})

	pipe := c.client.Pipeline()

	index := make(map[int][]redis.Cmder)
	for i, item := range items {
		index[i] = c.queueIndex(ctx, pipe, item.Key, item.Tags, item.TTL, now)
		for _, tag := range item.Tags {
			tagKey := c.tagKey(tag)
			if _, done := pruned[tagKey]; !done {
				pruned[tagKey] = struct{}{}
				// From 0: marks are negative, the sweep's to remove.
				pipe.ZRemRangeByScore(ctx, tagKey, "0", pruneBefore)
			}
		}
	}

	// Each command is kept alongside the item that queued it, rather than read
	// back off Exec, so which key a reply belongs to is not a question of the
	// two orders still agreeing.
	sets := make([]*redis.StatusCmd, len(items))
	for i, item := range items {
		sets[i] = pipe.Set(ctx, c.entryKey(item.Key), caching.EncodeItem(item), leased(item))
	}

	// Monotonic: only the duration matters.
	sent := time.Now()
	_, err := pipe.Exec(ctx)
	inGrace := time.Since(sent) < c.writeGrace

	// An error no command carries means nothing was sent.
	if err != nil && !anyErr(index) && !slices.ContainsFunc(sets, func(cmd *redis.StatusCmd) bool { return cmd.Err() != nil }) {
		return err
	}

	// Entries may be written now, so finish even if the caller gives up.
	finishCtx := context.WithoutCancel(ctx)

	// An entry whose index isn't confirmed is removed, not left unreachable.
	// A confirmed one expires at its member's score, so it never outlives the
	// member; PEXPIREAT is a no-op on one a walk has deleted since. Past the
	// grace it keeps its lease.
	unindexed := make(map[int]struct{})
	var queued bool
	pipe = c.client.Pipeline()
	for i, item := range items {
		if len(item.Tags) == 0 {
			continue
		}
		switch {
		case anyCmdErr(index[i]):
			unindexed[i] = struct{}{}
			pipe.Unlink(finishCtx, c.entryKey(item.Key))
			queued = true
		case leased(item) < item.TTL && sets[i].Err() == nil && inGrace:
			pipe.PExpireAt(finishCtx, c.entryKey(item.Key), expiresAt(now, item.TTL))
			queued = true
		}
	}
	if queued {
		if _, finishErr := pipe.Exec(finishCtx); finishErr != nil {
			err = errors.Join(err, fmt.Errorf("redis adapter: finishing write: %w", finishErr))
		}
	}

	// A command is only counted once redis has answered it. Anything still
	// carrying the failure is left out, whether it never arrived or was applied
	// and lost its reply on the way back, so this understates what was written
	// rather than claiming a key that might not be there.
	var stored []string
	for i, cmd := range sets {
		if _, bad := unindexed[i]; cmd.Err() == nil && !bad {
			stored = append(stored, items[i].Key)
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

func anyCmdErr(cmds []redis.Cmder) bool {
	return slices.ContainsFunc(cmds, func(cmd redis.Cmder) bool { return cmd.Err() != nil })
}

// leased is the TTL item is first SET with: the write lease for tagged items
// that outlive it, else its own.
func leased(item caching.Item) time.Duration {
	if len(item.Tags) == 0 {
		return item.TTL
	}
	return min(item.TTL, writeLease)
}

// anyErr reports whether any queued command carries an error.
func anyErr(cmds map[int][]redis.Cmder) bool {
	for _, list := range cmds {
		for _, cmd := range list {
			if cmd.Err() != nil {
				return true
			}
		}
	}
	return false
}

// expiresAt is when an entry written at now with ttl expires, and its
// member's score, to the millisecond.
func expiresAt(now time.Time, ttl time.Duration) time.Time {
	return time.UnixMilli(now.Add(ttl).UnixMilli())
}

// queueIndex queues key's member and tag TTL updates for each of tags. GT:
// a write landing out of order never lowers a member's score, which would let
// the prune drop it while a newer entry is alive.
func (c *RedisCache) queueIndex(ctx context.Context, pipe redis.Pipeliner, key string, tags []string, ttl time.Duration, now time.Time) []redis.Cmder {
	member := redis.Z{Score: float64(expiresAt(now, ttl).UnixMilli()), Member: key}
	cmds := make([]redis.Cmder, 0, len(tags)*3)
	for _, tag := range tags {
		tagKey := c.tagKey(tag)
		// Outlives its entries by the prune grace: entries expire at their
		// score by this router's clock, the key by redis's.
		cmds = append(cmds,
			pipe.ZAddArgs(ctx, tagKey, redis.ZAddArgs{GT: true, Members: []redis.Z{member}}),
			pipe.ExpireNX(ctx, tagKey, ttl+tagIndexPruneGrace),
			pipe.ExpireGT(ctx, tagKey, ttl+tagIndexPruneGrace),
		)
	}
	return cmds
}

// Close releases the redis client the cache was built with. The Once is not for
// thread safety, which the client has of its own, but so that a second shutdown
// path reaching this is answered the same as the first rather than with
// go-redis' complaint that the client is already closed.
func (c *RedisCache) Close() error {
	c.closeOnce.Do(func() {
		c.closeErr = c.client.Close()
	})
	return c.closeErr
}
