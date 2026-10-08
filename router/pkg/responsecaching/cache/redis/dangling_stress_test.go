package redis

import (
	"context"
	"fmt"
	"math/rand/v2"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

// Hammers a real server with writers and invalidators on a few hot keys. One
// tag per key, so only that tag can reach it: after writers stop and every tag
// is invalidated once more, any live entry is dangling. TTLs vary, and no
// entry may outlive the TTL its value was written with. Opt in with
// RESPONSE_CACHE_REDIS_ADDR.
func TestRedisCacheNoDanglingEntriesStress(t *testing.T) {
	addr := os.Getenv("RESPONSE_CACHE_REDIS_ADDR")
	if addr == "" {
		t.Skip("RESPONSE_CACHE_REDIS_ADDR not set")
	}

	const (
		keys        = 40
		writers     = 16
		walkers     = 8
		testRunTime = 5 * time.Second
	)
	ttls := []time.Duration{3 * time.Second, 30 * time.Second, time.Hour}
	tags := func(k int) []string { return []string{fmt.Sprintf("tag:%d", k%4)} }
	key := func(k int) string { return fmt.Sprintf("v1:%d", k) }

	prefix := fmt.Sprintf("stress:%d:", time.Now().UnixNano())
	newCache := func() *RedisCache {
		c, err := NewRedisCache(t.Context(), redis.NewClient(&redis.Options{Addr: addr, PoolSize: 4}), prefix)
		require.NoError(t, err)
		t.Cleanup(func() { _ = c.Close() })
		return c
	}

	ctx, cancel := context.WithTimeout(t.Context(), testRunTime)
	defer cancel()
	walkCtx, stopWalks := context.WithCancel(t.Context())
	defer stopWalks()

	var wg, walkWG sync.WaitGroup
	var writes, walks atomic.Int64
	for range writers {
		c := newCache()
		wg.Go(func() {
			for ctx.Err() == nil {
				batch := make([]enginecache.Item, 0, 3)
				for range 1 + rand.IntN(3) {
					k := rand.IntN(keys)
					ttl := ttls[rand.IntN(len(ttls))]
					batch = append(batch, enginecache.Item{Key: key(k), Value: []byte(strconv.FormatInt(ttl.Milliseconds(), 10)), TTL: ttl, Tags: tags(k)})
				}
				if c.SetMany(context.Background(), batch) == nil {
					writes.Add(1)
				}
			}
		})
	}
	for range walkers {
		c := newCache()
		walkWG.Go(func() {
			for walkCtx.Err() == nil {
				tag := tags(rand.IntN(keys))[0]
				if _, err := c.InvalidateByTags(context.Background(), []string{tag}); err == nil {
					walks.Add(1)
				}
			}
		})
	}
	wg.Wait()
	stopWalks()
	walkWG.Wait()

	check := redis.NewClient(&redis.Options{Addr: addr})
	defer func() { _ = check.Close() }()
	for k := range keys {
		stored, err := check.Get(t.Context(), prefix+entryNamespace+key(k)).Bytes()
		if err == redis.Nil {
			continue
		}
		require.NoError(t, err)
		pttl, err := check.PTTL(t.Context(), prefix+entryNamespace+key(k)).Result()
		require.NoError(t, err)
		value, _, _, err := enginecache.DecodeEntry(entryBody(stored))
		require.NoError(t, err)
		written, err := strconv.ParseInt(string(value), 10, 64)
		require.NoError(t, err)
		require.LessOrEqual(t, pttl.Milliseconds(), written, "%s outlives the TTL it was written with", key(k))
	}

	sweeper := newCache()
	for k := range 4 {
		_, err := sweeper.InvalidateByTags(t.Context(), tags(k))
		require.NoError(t, err)
	}

	var live, dangling int
	for k := range keys {
		n, err := check.Exists(t.Context(), prefix+entryNamespace+key(k)).Result()
		require.NoError(t, err)
		if n == 0 {
			continue
		}
		live++
		for _, tag := range tags(k) {
			if err := check.ZScore(t.Context(), prefix+tagNamespace+tag, key(k)).Err(); err == redis.Nil {
				dangling++
				t.Logf("dangling: %s not in %s", key(k), tag)
			} else {
				require.NoError(t, err)
			}
		}
	}
	t.Logf("writes=%d walks=%d live=%d dangling=%d", writes.Load(), walks.Load(), live, dangling)
	require.Zero(t, dangling)
	require.Zero(t, live, "survived a final invalidation of its only tag")
}
