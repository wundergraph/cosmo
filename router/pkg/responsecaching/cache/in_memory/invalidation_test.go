package in_memory

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

// stored reports whether a key is still readable, which is what invalidation is
// ultimately judged on rather than the state of the index behind it.
func stored(t *testing.T, c *InMemoryCache, keys ...string) map[string]enginecache.Item {
	t.Helper()
	found, err := c.GetMany(t.Context(), keys)
	require.NoError(t, err)
	return found
}

func TestInMemoryCacheInvalidateByTags(t *testing.T) {
	item := func(key string, tags ...string) enginecache.Item {
		return enginecache.Item{Key: key, Value: []byte(`{}`), TTL: time.Minute, Tags: tags}
	}

	t.Run("a tag takes the entries it names and nothing else", func(t *testing.T) {
		c := newTaggedCache(t)
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			item("v1:a", "declared:accounts:users"),
			item("v1:b", "declared:accounts:users"),
			item("v1:c", "declared:accounts:posts"),
		}))
		c.cache.Wait()

		removed, err := c.InvalidateByTags(t.Context(), []string{"declared:accounts:users"})
		require.NoError(t, err)
		require.Equal(t, 2, removed)

		found := stored(t, c, "v1:a", "v1:b", "v1:c")
		require.NotContains(t, found, "v1:a")
		require.NotContains(t, found, "v1:b")
		require.Contains(t, found, "v1:c")
	})

	t.Run("the tag itself goes with the entries it named", func(t *testing.T) {
		c := newTaggedCache(t)
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			item("v1:a", "declared:accounts:users"),
		}))
		c.cache.Wait()

		_, err := c.InvalidateByTags(t.Context(), []string{"declared:accounts:users"})
		require.NoError(t, err)

		require.Empty(t, indexKeys(c.tags, "declared:accounts:users"))
		require.Zero(t, indexLen(c.tags))
	})

	t.Run("a tag naming nothing is not an error", func(t *testing.T) {
		c := newTaggedCache(t)

		removed, err := c.InvalidateByTags(t.Context(), []string{"declared:accounts:never-written"})
		require.NoError(t, err)
		require.Zero(t, removed)
	})

	t.Run("several tags are one call", func(t *testing.T) {
		c := newTaggedCache(t)
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			item("v1:a", "type:accounts:User"),
			item("v1:b", "type:accounts:Post"),
		}))
		c.cache.Wait()

		removed, err := c.InvalidateByTags(t.Context(), []string{"type:accounts:User", "type:accounts:Post"})
		require.NoError(t, err)
		require.Equal(t, 2, removed)
		require.Empty(t, stored(t, c, "v1:a", "v1:b"))
	})

	t.Run("an entry is gone once, whichever of its tags took it", func(t *testing.T) {
		// The entry stays a member of its other tags after the first takes it.
		// Nothing reads back through those to correct them, so what has to hold
		// is that the leftover member costs a later call nothing but a miss.
		c := newTaggedCache(t)
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			item("v1:a", "declared:accounts:users", "subgraph:accounts", "type:accounts:User"),
		}))
		c.cache.Wait()

		removed, err := c.InvalidateByTags(t.Context(), []string{"declared:accounts:users"})
		require.NoError(t, err)
		require.Equal(t, 1, removed)
		require.Empty(t, stored(t, c, "v1:a"))

		// The stale members are still named, and taking them removes nothing.
		require.Equal(t, []string{"v1:a"}, indexKeys(c.tags, "subgraph:accounts"))
		removed, err = c.InvalidateByTags(t.Context(), []string{"subgraph:accounts"})
		require.NoError(t, err)
		require.Equal(t, 1, removed, "counted from the index, which still named it")
		require.Empty(t, stored(t, c, "v1:a"))
	})

	t.Run("an expired member is not counted as removed", func(t *testing.T) {
		c := newTaggedCache(t)
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:a", Value: []byte(`{}`), TTL: time.Millisecond, Tags: []string{"declared:accounts:users"}},
		}))
		c.cache.Wait()
		time.Sleep(10 * time.Millisecond)

		removed, err := c.InvalidateByTags(t.Context(), []string{"declared:accounts:users"})
		require.NoError(t, err)
		require.Zero(t, removed, "the entry had already gone on its own TTL")
	})

	t.Run("no tags removes nothing", func(t *testing.T) {
		c := newTaggedCache(t)
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item("v1:a", "declared:accounts:users")}))
		c.cache.Wait()

		removed, err := c.InvalidateByTags(t.Context(), nil)
		require.NoError(t, err)
		require.Zero(t, removed)
		require.Contains(t, stored(t, c, "v1:a"), "v1:a")
	})
}
