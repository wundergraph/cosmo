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
}

var _ caching.Cache = (*RedisCache)(nil)

// Entries and the tag index share one redis instance, so each gets its own
// segment under the prefix. Without that a tag equal to an entry key names the
// same redis key twice: the SET overwrites the index ZSET, and the next ZADD
// against it fails with WRONGTYPE.
const (
	entryNamespace = "e:"
	tagNamespace   = "t:"
)

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

	return &RedisCache{client: client, prefix: prefix}, nil
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

		// Keyed by what the caller asked with, not the prefixed key it was
		// stored under: the namespace is this cache's business, not theirs.
		results[key] = caching.Item{Key: key, Value: bytes.Clone(value), TTL: ttl}
	}

	return results, nil
}

// SetMany implements caching.SetMany.
func (c *RedisCache) SetMany(ctx context.Context, items []caching.Item) error {
	if len(items) == 0 {
		return caching.ErrNoItems
	}

	// Validated up front, so a batch rejected for a missing TTL is still the one
	// case where nothing at all was written, now that a single item queues
	// commands against keys other than its own.
	for _, item := range items {
		if item.TTL <= 0 {
			return fmt.Errorf("%w: key %q", caching.ErrMissingTTL, item.Key)
		}
	}

	// One clock reading for the batch. Scoring two items written together as if
	// they were written at different moments would be a distinction without a
	// source.
	now := time.Now()

	pipe := c.client.Pipeline()

	for _, item := range items {
		if len(item.Tags) == 0 {
			continue
		}

		expireAt := now.Add(item.TTL)
		member := redis.Z{Score: float64(expireAt.UnixMilli()), Member: item.Key}
		for _, tag := range item.Tags {
			tagKey := c.tagKey(tag)
			pipe.ZAdd(ctx, tagKey, member)
			pipe.ExpireNX(ctx, tagKey, item.TTL)
			pipe.ExpireGT(ctx, tagKey, item.TTL)
		}
	}

	// Each command is kept alongside the item that queued it, rather than read
	// back off Exec, so which key a reply belongs to is not a question of the
	// two orders still agreeing.
	cmds := make([]*redis.StatusCmd, len(items))
	for i, item := range items {
		cmds[i] = pipe.Set(ctx, c.entryKey(item.Key), item.Value, item.TTL)
	}

	_, err := pipe.Exec(ctx)
	if err == nil {
		return nil
	}

	// A command is only counted once redis has answered it. Anything still
	// carrying the failure is left out, whether it never arrived or was applied
	// and lost its reply on the way back, so this understates what was written
	// rather than claiming a key that might not be there.
	var stored []string
	for i, cmd := range cmds {
		if cmd.Err() == nil {
			stored = append(stored, items[i].Key)
		}
	}

	if len(stored) == 0 {
		return err
	}

	return &caching.SetManyError{KnownStoredKeys: stored, Err: err}
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
