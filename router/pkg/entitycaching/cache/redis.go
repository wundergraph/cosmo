package cache

import (
	"context"
	"errors"
	"fmt"

	"github.com/redis/go-redis/v9"
	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/entitycaching"
)

// RedisCache stores entries in Redis. Redis owns expiry, so unlike
// InMemoryCache there is nothing to sweep here.
type RedisCache struct {
	client redis.UniversalClient
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
func (c *RedisCache) GetMany(ctx context.Context, keys []string) ([]enginecache.Result, error) {
	if len(keys) == 0 {
		return nil, nil
	}

	// A pipeline of GETs rather than a single MGET: go-redis splits a pipeline
	// across cluster nodes, while MGET fails with CROSSSLOT as soon as the keys
	// span slots. It also gives each duplicate key its own command, so they are
	// looked up independently.
	pipe := c.client.Pipeline()
	cmds := make([]*redis.StringCmd, len(keys))
	for i, key := range keys {
		cmds[i] = pipe.Get(ctx, c.prefix+key)
	}

	// A miss surfaces as redis.Nil, which is not a failure of the batch.
	if _, err := pipe.Exec(ctx); err != nil && !errors.Is(err, redis.Nil) {
		return nil, err
	}

	results := make([]enginecache.Result, len(keys))
	for i, cmd := range cmds {
		value, err := cmd.Bytes()
		if errors.Is(err, redis.Nil) {
			continue
		}
		if err != nil {
			// There is no partial read to salvage, the whole batch fails.
			return nil, fmt.Errorf("get %q: %w", keys[i], err)
		}
		results[i] = enginecache.Result{Value: value, Found: true}
	}

	return results, nil
}

// SetMany stores every item, all of which must carry a positive TTL. A single
// item without one fails the whole batch with an ErrMissingTTL and nothing is
// written.
func (c *RedisCache) SetMany(ctx context.Context, items []enginecache.Item) error {
	if len(items) == 0 {
		return nil
	}

	// Queuing writes nothing to redis, only Exec below does, so validating as
	// we go is enough: returning early abandons the whole pipeline unsent and
	// the batch is never applied in part.
	pipe := c.client.Pipeline()
	for _, item := range items {
		if item.TTL <= 0 {
			return fmt.Errorf("%w: key %q", ErrMissingTTL, item.Key)
		}
		pipe.Set(ctx, c.prefix+item.Key, item.Value, item.TTL)
	}

	_, err := pipe.Exec(ctx)
	return err
}
