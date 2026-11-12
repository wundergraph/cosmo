package redis

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

// A cluster client reading from replicas must still walk the primary's tag
// set: a replica behind it misses a key just listed, and the walk would leave
// its entry for its full TTL. Opt in with RESPONSE_CACHE_REDIS_CLUSTER_ADDRS,
// comma separated, and RESPONSE_CACHE_REDIS_REPLICA_ADDR, a replica of the
// node holding the test's keys.
func TestRedisCacheWalkReadsThePrimary(t *testing.T) {
	addrs := os.Getenv("RESPONSE_CACHE_REDIS_CLUSTER_ADDRS")
	replicaAddr := os.Getenv("RESPONSE_CACHE_REDIS_REPLICA_ADDR")
	if addrs == "" || replicaAddr == "" {
		t.Skip("RESPONSE_CACHE_REDIS_CLUSTER_ADDRS or RESPONSE_CACHE_REDIS_REPLICA_ADDR not set")
	}

	prefix := fmt.Sprintf("replica:%d:", time.Now().UnixNano())
	newCache := func(readOnly bool) *RedisCache {
		c, err := NewRedisCache(t.Context(), redis.NewClusterClient(&redis.ClusterOptions{
			Addrs:    strings.Split(addrs, ","),
			ReadOnly: readOnly,
		}), prefix)
		require.NoError(t, err)
		t.Cleanup(func() { _ = c.Close() })
		return c
	}
	writer, walker := newCache(false), newCache(true)
	replica := redis.NewClient(&redis.Options{Addr: replicaAddr})
	t.Cleanup(func() { _ = replica.Close() })

	const tag = "subgraph:accounts"
	item := enginecache.Item{Key: "v1:a", Value: []byte(`{}`), TTL: time.Hour, Tags: []string{tag}}

	// Hold the replica behind its primary.
	require.NoError(t, replica.Do(t.Context(), "CLIENT", "PAUSE", 2000, "WRITE").Err())
	t.Cleanup(func() { _ = replica.Do(t.Context(), "CLIENT", "UNPAUSE").Err() })

	require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{item}))
	seen, _, err := walker.client.ZScan(t.Context(), walker.tagKey(tag), 0, "", 10).Result()
	require.NoError(t, err)
	require.NotContains(t, seen, item.Key, "the replica caught up, so it can't show the walk reads the primary")

	removed, err := walker.InvalidateByTags(t.Context(), []string{tag})
	require.NoError(t, err)
	assert.Equal(t, 1, removed)
	got, err := writer.GetMany(t.Context(), []string{item.Key})
	require.NoError(t, err)
	assert.NotContains(t, got, item.Key, "survived its invalidation")
}
