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

	t.Run("an entry is indexed under every tag it names", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:a", Value: []byte(`{"id":42}`), TTL: time.Minute, Tags: []string{"declared:users", "declared:user-42"}},
		}))

		for _, tag := range []string{"declared:users", "declared:user-42"} {
			members, err := mr.ZMembers(tagIndexKey(tag))
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

		members, err := mr.ZMembers(tagIndexKey("declared:users"))
		require.NoError(t, err)
		require.ElementsMatch(t, []string{"v1:a", "v1:b", "v1:c"}, members)

		members, err = mr.ZMembers(tagIndexKey("declared:user-42"))
		require.NoError(t, err)
		require.Equal(t, []string{"v1:a"}, members)
	})

	t.Run("an item with no tags writes no index", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:a", Value: []byte(`{}`), TTL: time.Minute},
		}))

		require.Equal(t, []string{entryKey("v1:a")}, mr.Keys())
	})

	t.Run("a tag cannot be spelled to collide with an entry", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		// A tag spelled exactly like an entry key still lands in the tag
		// namespace, so the SET cannot overwrite the index and the ZADD cannot
		// fail WRONGTYPE against the value.
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:a", Value: []byte(`{"real":true}`), TTL: time.Minute, Tags: []string{"v1:a", "declared:v1:a"}},
		}))

		value, err := mr.Get(entryKey("v1:a"))
		require.NoError(t, err)
		require.JSONEq(t, `{"real":true}`, value)

		for _, tag := range []string{"v1:a", "declared:v1:a"} {
			members, err := mr.ZMembers(tagIndexKey(tag))
			require.NoError(t, err)
			require.Equal(t, []string{"v1:a"}, members)
		}
	})

	t.Run("a member is scored with when its entry expires", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		before := time.Now()
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:a", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users"}},
		}))
		after := time.Now()

		score, err := mr.ZScore(tagIndexKey("declared:users"), "v1:a")
		require.NoError(t, err)

		require.GreaterOrEqual(t, int64(score), before.Add(time.Minute).UnixMilli())
		require.LessOrEqual(t, int64(score), after.Add(time.Minute).UnixMilli())
	})

	t.Run("re-caching an entry moves its member rather than adding one", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		item := enginecache.Item{Key: "v1:a", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users"}}
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item}))
		first, err := mr.ZScore(tagIndexKey("declared:users"), "v1:a")
		require.NoError(t, err)

		mr.FastForward(time.Second)
		item.TTL = 2 * time.Minute
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item}))

		members, err := mr.ZMembers(tagIndexKey("declared:users"))
		require.NoError(t, err)
		require.Equal(t, []string{"v1:a"}, members, "a zset holds a member once")

		second, err := mr.ZScore(tagIndexKey("declared:users"), "v1:a")
		require.NoError(t, err)
		require.Greater(t, second, first, "the longer life must be the one that counts")
	})

	t.Run("the tag key lives as long as the entries in it", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:a", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users"}},
		}))

		require.Equal(t, mr.TTL(entryKey("v1:a")), mr.TTL(tagIndexKey("declared:users")))
	})

	t.Run("a short lived entry does not shorten a tag holding longer lived ones", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:long", Value: []byte(`{}`), TTL: time.Hour, Tags: []string{"declared:users"}},
		}))
		longTTL := mr.TTL(tagIndexKey("declared:users"))

		// Without GT this second write would expire the whole tag in a second,
		// taking the hour long entry's membership with it and stranding it.
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:short", Value: []byte(`{}`), TTL: time.Second, Tags: []string{"declared:users"}},
		}))

		require.Equal(t, longTTL, mr.TTL(tagIndexKey("declared:users")))

		members, err := mr.ZMembers(tagIndexKey("declared:users"))
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

		require.Equal(t, time.Hour, mr.TTL(tagIndexKey("declared:users")))
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

	// A tag key lives as long as its longest lived member, so these hold one that
	// outlives the fast forwards. Without it the key would expire and take the
	// members with it, and what the prune does would never be visible.
	keeper := func(tags ...string) enginecache.Item {
		return enginecache.Item{Key: "v1:keeper:" + tags[0], Value: []byte(`{}`), TTL: 24 * time.Hour, Tags: tags}
	}

	t.Run("a member whose entry expired past the grace is dropped by the next write", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			keeper("declared:users"),
			{Key: "v1:gone", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users"}},
		}))

		// Both clocks, because a member is only dead once redis has dropped the
		// entry and this router agrees enough time has passed.
		elapsed := time.Minute + tagIndexPruneGrace + time.Second
		mr.FastForward(elapsed)
		advance(c, elapsed)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:live", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users"}},
		}))

		members, err := mr.ZMembers(tagIndexKey("declared:users"))
		require.NoError(t, err)
		require.ElementsMatch(t, []string{"v1:keeper:declared:users", "v1:live"}, members)
	})

	t.Run("a member inside the grace is kept, its entry could still be there", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			keeper("declared:users"),
			{Key: "v1:recent", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users"}},
		}))

		// Expired by this router's clock but only just: a redis running a minute
		// behind would still be serving it.
		elapsed := time.Minute + time.Second
		mr.FastForward(elapsed)
		advance(c, elapsed)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:live", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users"}},
		}))

		members, err := mr.ZMembers(tagIndexKey("declared:users"))
		require.NoError(t, err)
		require.ElementsMatch(t, []string{"v1:keeper:declared:users", "v1:recent", "v1:live"}, members)
	})

	t.Run("a member is dead by its latest score, not its first", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		item := enginecache.Item{Key: "v1:a", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users"}}
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{keeper("declared:users"), item}))

		// Re-cached a second in, which scores the member a second further out.
		mr.FastForward(time.Second)
		advance(c, time.Second)
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item}))

		// Far enough that the first score is past the cutoff and the second is
		// not, so only the re-scoring keeps the member.
		gap := time.Minute + tagIndexPruneGrace + 500*time.Millisecond - time.Second
		mr.FastForward(gap)
		advance(c, gap)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:b", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users"}},
		}))

		members, err := mr.ZMembers(tagIndexKey("declared:users"))
		require.NoError(t, err)
		require.Contains(t, members, "v1:a")

		// Past the second score too, and it goes.
		advance(c, time.Second)
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:c", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users"}},
		}))

		members, err = mr.ZMembers(tagIndexKey("declared:users"))
		require.NoError(t, err)
		require.NotContains(t, members, "v1:a")
	})

	t.Run("the prune leaves the tags a write does not name alone", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			keeper("declared:users"),
			keeper("declared:untouched"),
			{Key: "v1:gone", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users", "declared:untouched"}},
		}))

		elapsed := time.Minute + tagIndexPruneGrace + time.Second
		mr.FastForward(elapsed)
		advance(c, elapsed)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:live", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users"}},
		}))

		members, err := mr.ZMembers(tagIndexKey("declared:users"))
		require.NoError(t, err)
		require.ElementsMatch(t, []string{"v1:keeper:declared:users", "v1:live"}, members)

		// Nothing was written to it, so its dead member is still there and its
		// own key TTL is what will clear it.
		members, err = mr.ZMembers(tagIndexKey("declared:untouched"))
		require.NoError(t, err)
		require.ElementsMatch(t, []string{"v1:keeper:declared:untouched", "v1:gone"}, members)
	})
}

// advance moves the clock the cache scores index members from forward by d,
// leaving redis' own clock to the test.
func advance(c *RedisCache, d time.Duration) {
	previous := c.now
	c.now = func() time.Time { return previous().Add(d) }
}
