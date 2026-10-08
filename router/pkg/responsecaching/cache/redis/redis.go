package redis

import (
	"bytes"
	"context"
	"errors"
	"fmt"
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
	// sweepDelay is how long after an invalidation its tags are swept in the
	// background. Only tests change it.
	sweepDelay time.Duration
	// closing is cancelled by Close, ending background sweeps.
	closing context.Context
	cancel  context.CancelFunc
}

var _ caching.Cache = (*RedisCache)(nil)

const (
	entryNamespace = "e:"
	tagNamespace   = "t:"
)

// tagIndexPruneGrace is how long past its score a member stays in a tag index.
const tagIndexPruneGrace = 5 * time.Minute

// defaultWriteGrace is writeGrace outside tests. Shorter than writeLease.
const defaultWriteGrace = 5 * time.Second

// sweepMargin is added to writeGrace before a mark is swept. Marks and their
// ages use the tag key's node clock, so it only absorbs clock rate and a
// failover's new clock.
const sweepMargin = time.Second

// backgroundSweepDelay is how long after an invalidation its tag is swept.
// Past writeGrace + sweepMargin, so that walk's marks are old enough.
const backgroundSweepDelay = defaultWriteGrace + sweepMargin + time.Second

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

	closing, cancel := context.WithCancel(context.Background())
	return &RedisCache{
		client:     client,
		prefix:     prefix,
		now:        time.Now,
		writeGrace: defaultWriteGrace,
		sweepDelay: backgroundSweepDelay,
		closing:    closing,
		cancel:     cancel,
	}, nil
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

		decoded, surrogateKeys, vary, err := caching.DecodeEntry(entryBody(value))
		if err != nil {
			return nil, fmt.Errorf("redis adapter decode %q: %w", key, err)
		}

		// Keyed by what the caller asked with, not the prefixed key it was
		// stored under: the namespace is this cache's business, not theirs.
		results[key] = caching.Item{Key: key, Value: bytes.Clone(decoded), TTL: ttl, SurrogateKeys: surrogateKeys, Vary: vary}
	}

	return results, nil
}

// Close releases the redis client the cache was built with. The Once is not for
// thread safety, which the client has of its own, but so that a second shutdown
// path reaching this is answered the same as the first rather than with
// go-redis' complaint that the client is already closed.
func (c *RedisCache) Close() error {
	c.closeOnce.Do(func() {
		// Pending sweeps give up; a running one fails fast.
		c.cancel()
		c.closeErr = c.client.Close()
	})
	return c.closeErr
}
