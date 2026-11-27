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
	// now is the clock entry expiries are written and read by, time.Now
	// outside of tests.
	now func() time.Time
}

var _ caching.Cache = (*RedisCache)(nil)

const (
	entryNamespace = "e:"
	tagNamespace   = "t:"
)

// tagIndexPruneGrace is how long past its score a member stays in a tag index.
const tagIndexPruneGrace = 5 * time.Minute

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

	return &RedisCache{
		client: client,
		prefix: prefix,
		now:    time.Now,
	}, nil
}

// GetMany implements caching.GetMany.
//
// An entry carries its expiry in its header, so a lookup is a GET per key, or
// a single MGET on one node, and no PTTL. What is left of it is taken against
// this router's clock, while the expiry was set by the clock of the router that
// wrote it or, once extended, of its tag set's node: skew between them shows up
// as that much more or less lifetime reported, never as an entry outliving
// redis, which drops it on its own clock. Entries written before headers
// carried an expiry are asked their lifetime with a PTTL, in a second round
// trip only they pay.
func (c *RedisCache) GetMany(ctx context.Context, keys []string) (map[string]caching.Item, error) {
	if len(keys) == 0 {
		return nil, caching.ErrNoKeys
	}

	values, err := c.read(ctx, keys)
	if err != nil {
		return nil, err
	}

	// Sized for every key finding something, which is the case worth being
	// ready for. A miss adds nothing, so the map is only as big as the hits.
	results := make(map[string]caching.Item, len(keys))
	now := c.now()
	var legacy []int
	for i, key := range keys {
		if values[i] == nil {
			continue
		}
		body, expiresAt, hasExpiry := readEntry(values[i])
		if !hasExpiry {
			legacy = append(legacy, i)
			continue
		}
		// In whole milliseconds, the expiry's grain and PTTL's. Still held by
		// redis but past the expiry it was written with is a miss: the
		// router's clock runs ahead of the node's, or the key is about to go.
		ttl := expiresAt.Sub(now).Truncate(time.Millisecond)
		if ttl <= 0 {
			continue
		}
		if err := c.addResult(results, key, body, ttl); err != nil {
			return nil, err
		}
	}

	if len(legacy) > 0 {
		if err := c.readLegacy(ctx, keys, values, legacy, results); err != nil {
			return nil, err
		}
	}

	return results, nil
}

// read fetches the stored value of every key, nil for a miss. A single node
// gets them in one MGET. Anything else, a cluster above all, gets a pipeline
// of GETs: go-redis splits a pipeline across cluster nodes, while MGET fails
// with CROSSSLOT as soon as the keys span slots. Each value is the read's own
// copy, not a view of a reply buffer.
func (c *RedisCache) read(ctx context.Context, keys []string) ([][]byte, error) {
	values := make([][]byte, len(keys))

	if client, ok := c.client.(*redis.Client); ok {
		prefixed := make([]string, len(keys))
		for i, key := range keys {
			prefixed[i] = c.entryKey(key)
		}
		replies, err := client.MGet(ctx, prefixed...).Result()
		if err != nil {
			return nil, err
		}
		if len(replies) != len(keys) {
			return nil, fmt.Errorf("redis adapter: MGET of %d keys answered %d values", len(keys), len(replies))
		}
		for i, reply := range replies {
			switch reply := reply.(type) {
			case nil: // a miss
			case string:
				values[i] = []byte(reply)
			default:
				return nil, fmt.Errorf("redis adapter get %q: unexpected reply %T", keys[i], reply)
			}
		}
		return values, nil
	}

	pipe := c.client.Pipeline()
	cmds := make([]*redis.StringCmd, len(keys))
	for i, key := range keys {
		cmds[i] = pipe.Get(ctx, c.entryKey(key))
	}
	// A miss surfaces as redis.Nil, which is not a failure of the batch.
	_, err := pipe.Exec(ctx)
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, err
	}
	for i, cmd := range cmds {
		value, err := cmd.Result()
		if err != nil {
			if errors.Is(err, redis.Nil) {
				continue
			}
			// There is no partial read to salvage, the whole batch fails.
			return nil, fmt.Errorf("redis adapter get %q: %w", keys[i], err)
		}
		values[i] = []byte(value)
	}
	return values, nil
}

// readLegacy adds the hits among the keys at positions whose entries carry no
// expiry, asking redis for their lifetimes with a PTTL each. The value was read
// a round trip earlier, so the key may have expired, or been rewritten, since:
// an expired one is a miss, a rewritten one is served with its successor's
// lifetime, which is no older than the value's.
func (c *RedisCache) readLegacy(ctx context.Context, keys []string, values [][]byte, positions []int, results map[string]caching.Item) error {
	pipe := c.client.Pipeline()
	ttls := make([]*redis.DurationCmd, len(positions))
	for i, pos := range positions {
		ttls[i] = pipe.PTTL(ctx, c.entryKey(keys[pos]))
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("redis adapter pttl: %w", err)
	}

	for i, pos := range positions {
		// A PTTL never reports a missing key as an error, it answers with a
		// negative duration, as it does for a key without an expiry: neither
		// is this cache's to serve.
		ttl := ttls[i].Val()
		if ttl <= 0 {
			continue
		}
		body, _, _ := readEntry(values[pos])
		if err := c.addResult(results, keys[pos], body, ttl); err != nil {
			return err
		}
	}
	return nil
}

// addResult decodes body into a hit for key living ttl more.
func (c *RedisCache) addResult(results map[string]caching.Item, key string, body []byte, ttl time.Duration) error {
	item, err := caching.DecodeItem(body, ttl)
	if err != nil {
		return fmt.Errorf("redis adapter decode %q: %w", key, err)
	}

	// Keyed by what the caller asked with, not the prefixed key it was
	// stored under: the namespace is this cache's business, not theirs.
	// Cloned so the hit holds only its value, not the header and surrogate
	// keys around it.
	item.Key, item.Value = key, bytes.Clone(item.Value)
	results[key] = item
	return nil
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
