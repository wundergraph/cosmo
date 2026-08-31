package redis

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

// The tag index is what makes an entry findable by what it is about rather than
// by the key it happens to be under, so what these pin is that it names every
// live entry, is namespaced away from them, and outlives what it points at.
func TestRedisCacheTagIndex(t *testing.T) {
	t.Parallel()

	tagKey := func(tag string) string { return testPrefix + tag }

	t.Run("an entry is indexed under every tag it names", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:a", Value: []byte(`{"id":42}`), TTL: time.Minute, Tags: []string{"declared:users", "declared:user-42"}},
		}))

		for _, tag := range []string{"declared:users", "declared:user-42"} {
			members, err := mr.ZMembers(tagKey(tag))
			require.NoError(t, err)
			// The member is the key the caller asked with, not the prefixed key
			// it was stored under, matching what GetMany hands back.
			require.Equal(t, []string{"v1:a"}, members)
		}
	})

	t.Run("a tag gathers every entry that names it", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:a", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users", "declared:user-42"}},
			{Key: "v1:b", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users", "declared:user-1023"}},
			{Key: "v1:c", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users", "declared:user-7"}},
		}))

		members, err := mr.ZMembers(tagKey("declared:users"))
		require.NoError(t, err)
		require.ElementsMatch(t, []string{"v1:a", "v1:b", "v1:c"}, members)

		members, err = mr.ZMembers(tagKey("declared:user-42"))
		require.NoError(t, err)
		require.Equal(t, []string{"v1:a"}, members)
	})

	t.Run("an item with no tags writes no index", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:a", Value: []byte(`{}`), TTL: time.Minute},
		}))

		require.Equal(t, []string{testPrefix + "v1:a"}, mr.Keys())
	})

	t.Run("a tag cannot be spelled to collide with an entry", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		// A tag naming an entry key verbatim still lands in the tag namespace,
		// so it cannot overwrite the entry it names.
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:a", Value: []byte(`{"real":true}`), TTL: time.Minute, Tags: []string{"declared:v1:a"}},
		}))

		value, err := mr.Get(testPrefix + "v1:a")
		require.NoError(t, err)
		require.JSONEq(t, `{"real":true}`, value)

		members, err := mr.ZMembers(tagKey("declared:v1:a"))
		require.NoError(t, err)
		require.Equal(t, []string{"v1:a"}, members)
	})

	t.Run("a member is scored with when its entry expires", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		before := time.Now()
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:a", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users"}},
		}))
		after := time.Now()

		score, err := mr.ZScore(tagKey("declared:users"), "v1:a")
		require.NoError(t, err)

		require.GreaterOrEqual(t, int64(score), before.Add(time.Minute).UnixMilli())
		require.LessOrEqual(t, int64(score), after.Add(time.Minute).UnixMilli())
	})

	t.Run("re-caching an entry moves its member rather than adding one", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		item := enginecache.Item{Key: "v1:a", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users"}}
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item}))
		first, err := mr.ZScore(tagKey("declared:users"), "v1:a")
		require.NoError(t, err)

		mr.FastForward(time.Second)
		item.TTL = 2 * time.Minute
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item}))

		members, err := mr.ZMembers(tagKey("declared:users"))
		require.NoError(t, err)
		require.Equal(t, []string{"v1:a"}, members, "a zset holds a member once")

		second, err := mr.ZScore(tagKey("declared:users"), "v1:a")
		require.NoError(t, err)
		require.Greater(t, second, first, "the longer life must be the one that counts")
	})

	t.Run("the tag key lives as long as the entries in it", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:a", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users"}},
		}))

		require.Equal(t, mr.TTL(testPrefix+"v1:a"), mr.TTL(tagKey("declared:users")))
	})

	t.Run("a short lived entry does not shorten a tag holding longer lived ones", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:long", Value: []byte(`{}`), TTL: time.Hour, Tags: []string{"declared:users"}},
		}))
		longTTL := mr.TTL(tagKey("declared:users"))

		// Without GT this second write would expire the whole tag in a second,
		// taking the hour long entry's membership with it and stranding it.
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:short", Value: []byte(`{}`), TTL: time.Second, Tags: []string{"declared:users"}},
		}))

		require.Equal(t, longTTL, mr.TTL(tagKey("declared:users")))

		members, err := mr.ZMembers(tagKey("declared:users"))
		require.NoError(t, err)
		require.ElementsMatch(t, []string{"v1:long", "v1:short"}, members)
	})

	t.Run("a longer lived entry extends the tag holding shorter lived ones", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:short", Value: []byte(`{}`), TTL: time.Second, Tags: []string{"declared:users"}},
		}))
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:long", Value: []byte(`{}`), TTL: time.Hour, Tags: []string{"declared:users"}},
		}))

		require.Equal(t, time.Hour, mr.TTL(tagKey("declared:users")))
	})

	t.Run("an item without a TTL is refused before anything is indexed", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		err := c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:a", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users"}},
			{Key: "v1:b", Value: []byte(`{}`), TTL: 0, Tags: []string{"declared:users"}},
		})
		require.ErrorIs(t, err, enginecache.ErrMissingTTL)

		// Still the one case where nothing at all was written, now that a valid
		// item queues commands against keys other than its own.
		require.Empty(t, mr.Keys())
	})
}
