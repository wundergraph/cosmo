package redis

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

func TestRedisCacheBackgroundSweep(t *testing.T) {
	t.Parallel()

	const tag = "subgraph:accounts"
	item := func(key string) enginecache.Item {
		return enginecache.Item{Key: key, Value: []byte(`{}`), TTL: time.Minute, Tags: []string{tag}}
	}

	t.Run("a marked member leaves the index without another invalidation", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)
		c.sweepDelay = 300 * time.Millisecond
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item("v1:a")}))

		_, err := c.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)
		require.Contains(t, zmembers(t, mr, tagIndexKey(tag)), "v1:a", "marked, not removed, by the call itself")

		// Removed by the background walk.
		require.Eventually(t, func() bool {
			return !mr.Exists(tagIndexKey(tag))
		}, 5*time.Second, 10*time.Millisecond)
	})

	t.Run("a sweep leaves live members alone", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)
		c.sweepDelay = 300 * time.Millisecond
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item("v1:a")}))
		_, err := c.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)

		// Written after the invalidation: live, and not the sweep's to touch.
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item("v1:b")}))

		require.Eventually(t, func() bool {
			members := zmembers(t, mr, tagIndexKey(tag))
			return len(members) == 1 && members[0] == "v1:b"
		}, 5*time.Second, 10*time.Millisecond)
		require.True(t, mr.Exists(entryKey("v1:b")))
	})

	t.Run("close stops a pending sweep", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)
		c.sweepDelay = 100 * time.Millisecond
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item("v1:a")}))
		_, err := c.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)

		require.NoError(t, c.Close())

		// Past the delay: a sweep that hadn't given up would have run.
		time.Sleep(300 * time.Millisecond)
		require.Contains(t, zmembers(t, mr, tagIndexKey(tag)), "v1:a")
	})
}
