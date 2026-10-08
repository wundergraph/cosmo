package redis

import (
	"testing"
	"time"

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
		require.False(t, mr.Exists(tagIndexKey(tag)), "emptied")
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
		require.False(t, mr.Exists(tagIndexKey(tag)))
	})
}
