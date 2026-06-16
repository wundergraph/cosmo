package core

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/redis/go-redis/v9"
	rd "github.com/wundergraph/cosmo/router/internal/rediscloser"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

var _ resolve.LoaderCache = (*redisEntityCache)(nil)
var _ io.Closer = (*redisEntityCache)(nil)

type redisEntityCache struct {
	client    rd.RDCloser
	keyPrefix string
}

func newRedisEntityCache(logger *zap.Logger, storageConfig config.RedisStorageProvider, keyPrefix string) (*redisEntityCache, error) {
	if logger == nil {
		logger = zap.NewNop()
	}

	client, err := rd.NewRedisCloser(&rd.RedisCloserOptions{
		Logger:         logger,
		URLs:           storageConfig.URLs,
		ClusterEnabled: storageConfig.ClusterEnabled,
	})
	if err != nil {
		return nil, err
	}

	return &redisEntityCache{
		client:    client,
		keyPrefix: normalizeEntityCacheKeyPrefix(keyPrefix),
	}, nil
}

func normalizeEntityCacheKeyPrefix(keyPrefix string) string {
	if keyPrefix == "" {
		return defaultEntityCacheKeyPrefix
	}
	return keyPrefix
}

func (c *redisEntityCache) Get(ctx context.Context, keys []string) ([]*resolve.CacheEntry, error) {
	entries := make([]*resolve.CacheEntry, len(keys))
	if len(keys) == 0 {
		return entries, nil
	}

	redisKeys := c.redisKeys(keys)
	values, err := c.client.MGet(ctx, redisKeys...).Result()
	if err != nil {
		return nil, err
	}
	if len(values) != len(keys) {
		return nil, fmt.Errorf("redis MGET returned %d values for %d keys", len(values), len(keys))
	}

	ttlCommands := make(map[int]*redis.DurationCmd, len(keys))
	_, err = c.client.Pipelined(ctx, func(pipe redis.Pipeliner) error {
		for i, value := range values {
			if value != nil {
				ttlCommands[i] = pipe.PTTL(ctx, redisKeys[i])
			}
		}
		return nil
	})
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, err
	}

	for i, value := range values {
		if value == nil {
			continue
		}
		bytesValue, err := redisCacheEntryValue(value)
		if err != nil {
			return nil, err
		}

		entry := &resolve.CacheEntry{
			Key:   keys[i],
			Value: bytesValue,
		}
		if ttlCommand := ttlCommands[i]; ttlCommand != nil {
			ttl, err := ttlCommand.Result()
			if err != nil && !errors.Is(err, redis.Nil) {
				return nil, err
			}
			if ttl > 0 {
				entry.RemainingTTL = ttl
			}
		}
		entries[i] = entry
	}

	return entries, nil
}

func redisCacheEntryValue(value interface{}) ([]byte, error) {
	switch typed := value.(type) {
	case string:
		return []byte(typed), nil
	case []byte:
		out := make([]byte, len(typed))
		copy(out, typed)
		return out, nil
	default:
		return nil, fmt.Errorf("unexpected Redis entity cache value type %T", value)
	}
}

func (c *redisEntityCache) Set(ctx context.Context, entries []*resolve.CacheEntry) error {
	if len(entries) == 0 {
		return nil
	}

	_, err := c.client.Pipelined(ctx, func(pipe redis.Pipeliner) error {
		for _, entry := range entries {
			if entry == nil {
				continue
			}
			pipe.Set(ctx, c.redisKey(entry.Key), entry.Value, redisEntityCacheExpiration(entry.TTL))
		}
		return nil
	})
	return err
}

func redisEntityCacheExpiration(ttl time.Duration) time.Duration {
	if ttl == 0 {
		return redis.KeepTTL
	}
	if ttl < 0 {
		return 0
	}
	return ttl
}

func (c *redisEntityCache) Delete(ctx context.Context, keys []string) error {
	if len(keys) == 0 {
		return nil
	}
	return c.client.Del(ctx, c.redisKeys(keys)...).Err()
}

func (c *redisEntityCache) Close() error {
	if c.client == nil {
		return nil
	}
	return c.client.Close()
}

func (c *redisEntityCache) redisKeys(keys []string) []string {
	out := make([]string, len(keys))
	for i, key := range keys {
		out[i] = c.redisKey(key)
	}
	return out
}

func (c *redisEntityCache) redisKey(key string) string {
	if c.keyPrefix == "" {
		return key
	}
	return c.keyPrefix + ":" + key
}
