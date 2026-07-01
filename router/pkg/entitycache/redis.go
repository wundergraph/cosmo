package entitycache

import (
	"context"
	"io"

	"github.com/redis/go-redis/v9"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

var _ resolve.LoaderCache = (*RedisEntityCache)(nil)
var _ io.Closer = (*RedisEntityCache)(nil)

type RedisEntityCache struct {
	client    redis.UniversalClient
	keyPrefix string
}

func NewRedisEntityCache(client redis.UniversalClient, keyPrefix string) *RedisEntityCache {
	return &RedisEntityCache{client: client, keyPrefix: keyPrefix}
}

func (c *RedisEntityCache) Get(ctx context.Context, keys []string) ([]*resolve.CacheEntry, error) {
	if len(keys) == 0 {
		return nil, nil
	}
	prefixedKeys := make([]string, len(keys))
	for i, k := range keys {
		prefixedKeys[i] = c.keyPrefix + ":" + k
	}
	vals, err := c.client.MGet(ctx, prefixedKeys...).Result()
	if err != nil {
		return nil, err
	}
	entries := make([]*resolve.CacheEntry, len(keys))
	for i, val := range vals {
		if val == nil {
			continue
		}
		str, ok := val.(string)
		if !ok {
			continue
		}
		entries[i] = &resolve.CacheEntry{
			Key:   keys[i],
			Value: []byte(str),
		}
	}
	return entries, nil
}

func (c *RedisEntityCache) Set(ctx context.Context, entries []*resolve.CacheEntry) error {
	if len(entries) == 0 {
		return nil
	}
	pipe := c.client.Pipeline()
	for _, entry := range entries {
		if entry == nil {
			continue
		}
		// Per LoaderCache contract: TTL<=0 means no expiration; for go-redis
		// passing 0 (redis.KeepTTL is -1) tells the server to omit EX/PX.
		ttl := entry.TTL
		if ttl < 0 {
			ttl = 0
		}
		pipe.Set(ctx, c.keyPrefix+":"+entry.Key, entry.Value, ttl)
	}
	_, err := pipe.Exec(ctx)
	return err
}

func (c *RedisEntityCache) Delete(ctx context.Context, keys []string) error {
	if len(keys) == 0 {
		return nil
	}
	prefixedKeys := make([]string, len(keys))
	for i, k := range keys {
		prefixedKeys[i] = c.keyPrefix + ":" + k
	}
	return c.client.Del(ctx, prefixedKeys...).Err()
}

func (c *RedisEntityCache) Close() error {
	return c.client.Close()
}
