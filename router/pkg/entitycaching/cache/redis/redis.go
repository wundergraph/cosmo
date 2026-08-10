package redis

import (
	"bytes"
	"context"
	"errors"
	"fmt"

	"github.com/redis/go-redis/v9"
	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/entitycaching"
)

// RedisCache stores entries in Redis.
type RedisCache struct {
	// client is owned by the caller, not this cache, so it is never closed
	// here. It is a UniversalClient so a single, cluster or sentinel client all
	// fit without this cache having to know which one it got.
	client redis.UniversalClient
	// prefix is prepended to every key before it reaches redis, so entity cache
	// entries stay in their own namespace and cannot collide with anything else
	// sharing the instance. It is applied on the way in and stripped back off on
	// the way out, so callers only ever see the keys they asked with. An empty
	// prefix is valid and means the keys are used as they are.
	prefix string
}

// NewRedisCache returns a cache backed by client, namespacing every key with
// prefix. The caller keeps ownership of client and is responsible for closing
// it. rediscloser.RDCloser satisfies redis.UniversalClient, so a client built
// by rediscloser.NewRedisCloser can be passed straight in.
func NewRedisCache(client redis.UniversalClient, prefix string) (*RedisCache, error) {
	if client == nil {
		return nil, errors.New("redis client is nil")
	}

	return &RedisCache{client: client, prefix: prefix}, nil
}

// GetMany returns one result per key, in the same order as keys.
func (c *RedisCache) GetMany(ctx context.Context, keys []string) (map[string]enginecache.Item, error) {
	if len(keys) == 0 {
		return nil, nil
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
		prefixed := c.prefix + key
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
	results := make(map[string]enginecache.Item, len(keys))
	for i, key := range keys {
		value, err := values[i].Bytes()
		if errors.Is(err, redis.Nil) {
			continue
		}
		if err != nil {
			// There is no partial read to salvage, the whole batch fails.
			return nil, fmt.Errorf("get %q: %w", key, err)
		}

		ttl, err := ttls[i].Result()
		if err != nil {
			return nil, fmt.Errorf("pttl %q: %w", key, err)
		}

		if ttl <= 0 {
			continue
		}

		// Keyed by what the caller asked with, not the prefixed key it was
		// stored under: the namespace is this cache's business, not theirs.
		results[key] = enginecache.Item{Key: key, Value: bytes.Clone(value), TTL: ttl}
	}

	return results, nil
}

// SetMany stores every item, all of which must carry a positive TTL. A single
// item without one fails the whole batch with an ErrMissingTTL and nothing is
// written.
//
// Any other failure can leave the batch applied in part, since redis runs each
// command in a pipeline as it arrives. When some of it was confirmed written
// the error is a *SetManyError naming those keys.
func (c *RedisCache) SetMany(ctx context.Context, items []enginecache.Item) error {
	if len(items) == 0 {
		return nil
	}

	// Queuing writes nothing to redis, only Exec below does, so validating as
	// we go is enough: returning early abandons the whole pipeline unsent, and
	// a batch rejected for a missing TTL is the one case where nothing at all
	// was written.
	//
	// Each command is kept alongside the item that queued it, rather than read
	// back off Exec, so which key a reply belongs to is not a question of the
	// two orders still agreeing.
	pipe := c.client.Pipeline()
	cmds := make([]*redis.StatusCmd, len(items))
	for i, item := range items {
		if item.TTL <= 0 {
			return fmt.Errorf("%w: key %q", enginecache.ErrMissingTTL, item.Key)
		}
		cmds[i] = pipe.Set(ctx, c.prefix+item.Key, item.Value, item.TTL)
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

	return &enginecache.SetManyError{KnownStoredKeys: stored, Err: err}
}
