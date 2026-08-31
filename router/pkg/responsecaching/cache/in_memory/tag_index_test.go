package in_memory

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

// indexLen and indexKeys read the index the way an invalidation would. They
// live here because nothing in the adapter reads it yet.
func indexLen(idx *tagIndex) int {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	n := 0
	for _, keys := range idx.tags {
		n += len(keys)
	}
	return n
}

func indexKeys(idx *tagIndex, tag string) []string {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	out := make([]string, 0, len(idx.tags[tag]))
	for key := range idx.tags[tag] {
		out = append(out, key)
	}
	return out
}

func newTaggedCache(t *testing.T) *InMemoryCache {
	t.Helper()
	c, err := NewInMemoryCache(1000)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, c.Close()) })
	return c
}

// The in memory index has to answer the same questions as the redis one from a
// store that cannot be iterated and never says when an entry leaves.
func TestInMemoryCacheTagIndex(t *testing.T) {
	t.Run("an entry is indexed under every tag it names", func(t *testing.T) {
		c := newTaggedCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:a", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users", "declared:user-42"}},
		}))

		require.Equal(t, []string{"v1:a"}, indexKeys(c.tags, "declared:users"))
		require.Equal(t, []string{"v1:a"}, indexKeys(c.tags, "declared:user-42"))
	})

	t.Run("a tag gathers every entry that names it", func(t *testing.T) {
		c := newTaggedCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:a", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users", "declared:user-42"}},
			{Key: "v1:b", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users"}},
			{Key: "v1:c", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:posts"}},
		}))

		require.ElementsMatch(t, []string{"v1:a", "v1:b"}, indexKeys(c.tags, "declared:users"))
		require.Equal(t, []string{"v1:c"}, indexKeys(c.tags, "declared:posts"))
	})

	t.Run("an item with no tags leaves the index empty", func(t *testing.T) {
		c := newTaggedCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:a", Value: []byte(`{}`), TTL: time.Minute},
		}))
		require.Zero(t, indexLen(c.tags))
	})

	t.Run("a tag nobody wrote names nothing", func(t *testing.T) {
		c := newTaggedCache(t)
		require.Empty(t, indexKeys(c.tags, "declared:nothing-here"))
	})

	t.Run("the index does not stop the entry being readable", func(t *testing.T) {
		c := newTaggedCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:a", Value: []byte(`{"id":42}`), TTL: time.Minute, Tags: []string{"declared:users"}},
		}))

		found, err := c.GetMany(t.Context(), []string{"v1:a"})
		require.NoError(t, err)
		require.Len(t, found, 1)
		require.JSONEq(t, `{"id":42}`, string(found["v1:a"].Value))
	})
}

// Nothing announces that an entry expired, so the index has to reclaim that
// space itself or it outgrows the cache it describes.
func TestInMemoryTagIndexHousekeeping(t *testing.T) {
	t.Run("re-caching an entry does not grow the index", func(t *testing.T) {
		c := newTaggedCache(t)

		for range 5 {
			require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
				{Key: "v1:a", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"declared:users", "declared:user-42"}},
			}))
		}
		require.Equal(t, 2, indexLen(c.tags))
	})

	t.Run("a due sweep reclaims what an expired entry's tags held", func(t *testing.T) {
		c := newTaggedCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:gone", Value: []byte(`{}`), TTL: time.Millisecond, Tags: []string{"declared:users", "declared:user-42"}},
			{Key: "v1:live", Value: []byte(`{}`), TTL: time.Hour, Tags: []string{"declared:posts"}},
		}))
		require.Equal(t, 3, indexLen(c.tags))

		// A write triggers a sweep, but only once the interval has passed, so
		// the test moves the clock rather than waiting for it.
		c.tags.prune(time.Now().Add(tagIndexPruneInterval))

		require.Equal(t, 1, indexLen(c.tags), "only the entry that had not expired is still indexed")
		require.Equal(t, []string{"v1:live"}, indexKeys(c.tags, "declared:posts"))
	})

	t.Run("a sweep is not run for every write", func(t *testing.T) {
		// Walking the whole index on each write would charge every cacheable
		// fetch for the size of the index.
		c := newTaggedCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			{Key: "v1:gone", Value: []byte(`{}`), TTL: time.Millisecond, Tags: []string{"declared:users"}},
		}))
		time.Sleep(5 * time.Millisecond)

		for i := range 5 {
			require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
				{Key: fmt.Sprintf("v1:%d", i), Value: []byte(`{}`), TTL: time.Hour, Tags: []string{"declared:posts"}},
			}))
		}

		require.Equal(t, 6, indexLen(c.tags),
			"the expired member is still held: no write swept it")
	})

	t.Run("a tag left with no entries is dropped", func(t *testing.T) {
		index := newTagIndex()
		past := time.Now().Add(-time.Hour)

		index.add("v1:a", []string{"declared:users"}, past)
		require.Equal(t, 1, indexLen(index))

		index.prune(time.Now().Add(tagIndexPruneInterval))
		require.Zero(t, indexLen(index))
		require.Empty(t, index.tags)
	})
}
