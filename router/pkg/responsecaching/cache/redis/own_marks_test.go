package redis

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

// A walk removes the marks it placed once their entries are deleted again, so
// nothing waits on a later sweep.
func TestRedisCacheWalkRemovesOwnMarks(t *testing.T) {
	t.Parallel()

	const tag = "subgraph:accounts"
	item := func(key string) enginecache.Item {
		return enginecache.Item{Key: key, Value: []byte(`{}`), TTL: time.Hour, Tags: []string{tag}}
	}

	t.Run("an invalidation leaves no marks behind", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item("v1:a"), item("v1:b")}))

		removed, err := c.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)
		require.Equal(t, 2, removed)
		require.Empty(t, zmembers(t, mr, tagIndexKey(tag)), "emptied")
	})

	t.Run("a key cached right after an invalidation gets its full TTL", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item("v1:a")}))
		_, err := c.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item("v1:a")}))
		require.InDelta(t, time.Hour, mr.TTL(entryKey("v1:a")), float64(time.Second))
		requireNoDangling(t, mr, item("v1:a"))
	})

	t.Run("a walk whose second delete fails keeps its marks for the next", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item("v1:a")}))
		broken := newTestRedisCacheOn(t, mr, &failCommands{name: "unlink", pipelines: []int{1}})

		_, err := broken.InvalidateByTags(t.Context(), []string{tag})
		require.ErrorIs(t, err, errInjected)
		score, err := mr.ZScore(tagIndexKey(tag), "v1:a")
		require.NoError(t, err)
		require.Negative(t, score)

		_, err = c.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)
		require.Empty(t, zmembers(t, mr, tagIndexKey(tag)))
	})

	// Cancelled at a step of the walk, e.g. by an invalidation request timing
	// out. Walk pipelines: delete, delete again, unmark.
	cancelled := func(t *testing.T, pipeline int) (*RedisCache, *miniredis.Miniredis) {
		t.Helper()
		c, mr := newTestRedisCache(t)
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item("v1:a")}))

		ctx, cancel := context.WithCancel(t.Context())
		split := &splitPipeline{at: splitAt{pipeline: pipeline}, fn: cancel}
		walker := newTestRedisCacheOn(t, mr, split)
		_, _ = walker.InvalidateByTags(ctx, []string{tag})
		require.True(t, split.fired, "walk never reached pipeline %d", pipeline)
		return c, mr
	}

	for name, pipeline := range map[string]int{"second delete": 1, "unmark": 2} {
		t.Run("a walk cancelled before its "+name+" still removes its marks", func(t *testing.T) {
			t.Parallel()
			c, mr := cancelled(t, pipeline)
			assert.False(t, mr.Exists(entryKey("v1:a")))
			assert.Empty(t, zmembers(t, mr, tagIndexKey(tag)), "marks left")

			require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item("v1:a")}))
			assert.InDelta(t, time.Hour, mr.TTL(entryKey("v1:a")), float64(time.Second), "capped by a leftover mark")
		})
	}

	t.Run("a walk cancelled before its mark places none", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item("v1:a")}))

		ctx, cancel := context.WithCancel(t.Context())
		first := &afterStep{names: []string{"unlink"}, fn: cancel}
		walker := newTestRedisCacheOn(t, mr, first)
		_, err := walker.InvalidateByTags(ctx, []string{tag})
		require.True(t, first.fired, "walk never deleted")

		assert.ErrorIs(t, err, context.Canceled)
		assert.False(t, mr.Exists(entryKey("v1:a")))
		score, err := mr.ZScore(tagIndexKey(tag), "v1:a")
		require.NoError(t, err)
		assert.GreaterOrEqual(t, score, 0.0, "marked")
	})
}
