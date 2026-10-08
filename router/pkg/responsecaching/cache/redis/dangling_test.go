package redis

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

// A dangling entry is live but missing from one of its tag indexes, so
// invalidating that tag can never reach it. Each case runs a writer and an
// invalidating router against one server, interleaves them at one step, and
// checks no entry is left dangling.
func TestRedisCacheNoDanglingEntries(t *testing.T) {
	t.Parallel()

	const tag = "subgraph:accounts"
	item := enginecache.Item{Key: "v1:a", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{tag, "type:accounts:User"}}

	// Index state before the walk.
	setups := map[string]func(t *testing.T, mr *miniredis.Miniredis, writer, walker *RedisCache){
		"live entry": func(t *testing.T, mr *miniredis.Miniredis, writer, walker *RedisCache) {
			require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{item}))
		},
		"expired entry": func(t *testing.T, mr *miniredis.Miniredis, writer, walker *RedisCache) {
			require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{item}))
			mr.Del(entryKey(item.Key))
			advance(writer, 2*time.Minute)
			advance(walker, 2*time.Minute)
		},
		"entry still landing": func(t *testing.T, mr *miniredis.Miniredis, writer, walker *RedisCache) {
			expireAt := float64(writer.now().Add(time.Minute).UnixMilli())
			for _, tag := range item.Tags {
				_, err := mr.ZAdd(tagIndexKey(tag), expireAt, item.Key)
				require.NoError(t, err)
			}
		},
		"nothing": func(t *testing.T, mr *miniredis.Miniredis, writer, walker *RedisCache) {},
	}

	// A and B: the same key is written again between two steps of the walk.
	// Rank paging UNLINKed then ZREMed, dropping the member of an entry just
	// written. A step the code lacks is skipped.
	for _, step := range []string{"zrevrange", "zscan", "unlink"} {
		for name, setup := range setups {
			t.Run(fmt.Sprintf("write after walk's %s, %s", step, name), func(t *testing.T) {
				t.Parallel()
				mr := miniredis.RunT(t)
				writer := newTestRedisCacheOn(t, mr)
				interposer := &afterStep{names: []string{step}}
				walker := newTestRedisCacheOn(t, mr, interposer)
				setup(t, mr, writer, walker)

				interposer.fn = func() {
					require.NoError(t, writer.SetMany(context.Background(), []enginecache.Item{item}))
				}
				_, err := walker.InvalidateByTags(t.Context(), []string{tag})
				require.NoError(t, err)
				interposer.requireFired(t)

				requireNoDangling(t, mr, item)
			})
		}
	}

	// C: a walk lands between the writer's steps, from a router whose clock
	// runs ahead of the writer's by more than the TTL.
	for _, skew := range []time.Duration{0, 2 * time.Minute} {
		for _, at := range []splitAt{{pipeline: 0, before: "set"}, {pipeline: 1}} {
			t.Run(fmt.Sprintf("walk inside write at pipeline %d before %q, skew %s", at.pipeline, at.before, skew), func(t *testing.T) {
				t.Parallel()
				mr := miniredis.RunT(t)
				split := &splitPipeline{at: at}
				writer := newTestRedisCacheOn(t, mr, split)
				walker := newTestRedisCacheOn(t, mr)
				advance(walker, skew)

				split.fn = func() {
					_, err := walker.InvalidateByTags(context.Background(), []string{tag})
					require.NoError(t, err)
				}
				require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{item}))
				split.requireFired(t)

				requireNoDangling(t, mr, item)
			})
		}
	}

	// Rank paging (LIMIT offset = members left behind) skips one unread member
	// per member ahead of the offset that is removed or moved mid-walk.
	midWalk := map[string]func(t *testing.T, mr *miniredis.Miniredis, key string, read []string){
		"pruned": func(t *testing.T, mr *miniredis.Miniredis, key string, read []string) {
			for _, member := range read {
				_, err := mr.ZRem(key, member)
				require.NoError(t, err)
			}
		},
		"re-written with a later expiry": func(t *testing.T, mr *miniredis.Miniredis, key string, read []string) {
			for _, member := range read {
				score, err := mr.ZScore(key, member)
				require.NoError(t, err)
				_, err = mr.ZAdd(key, score+float64(time.Hour.Milliseconds()), member)
				require.NoError(t, err)
			}
		},
		// Rank paging re-read pages here; a full page of them ended it early.
		"overtaken by a page of shorter TTL writes": func(t *testing.T, mr *miniredis.Miniredis, key string, read []string) {
			score, err := mr.ZScore(key, read[0])
			require.NoError(t, err)
			for i := range invalidationPageSize {
				_, err := mr.ZAdd(key, score-1, fmt.Sprintf("v0:new:%d", i))
				require.NoError(t, err)
			}
		},
	}
	for name, change := range midWalk {
		t.Run("no unread entry is missed when members already read are "+name, func(t *testing.T) {
			t.Parallel()
			mr := miniredis.RunT(t)
			interposer := &afterStep{names: []string{"zrangebyscore", "zscan"}}
			c := newTestRedisCacheOn(t, mr, interposer)
			key := tagIndexKey(tag)

			// Entry-less members, sooner expiry and first by name: page one reads
			// them and, having nothing to unlink, rank paging leaves them in place.
			soon := float64(c.now().Add(30 * time.Second).UnixMilli())
			read := make([]string, 0, 16)
			for i := range 16 {
				member := fmt.Sprintf("v0:read:%02d", i)
				_, err := mr.ZAdd(key, soon, member)
				require.NoError(t, err)
				read = append(read, member)
			}

			const count = invalidationPageSize * 2
			items := make([]enginecache.Item, 0, count)
			for i := range count {
				items = append(items, enginecache.Item{Key: fmt.Sprintf("v1:%04d", i), Value: []byte(`{}`), TTL: time.Minute, Tags: []string{tag}})
			}
			require.NoError(t, c.SetMany(t.Context(), items))

			interposer.fn = func() { change(t, mr, key, read) }

			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			defer cancel()
			removed, err := c.InvalidateByTags(ctx, []string{tag})
			require.NoError(t, err)
			interposer.requireFired(t)
			require.Equal(t, count, removed)
			for i := range count {
				require.False(t, mr.Exists(entryKey(fmt.Sprintf("v1:%04d", i))))
			}
		})
	}

	t.Run("an UNLINK that fails leaves the entry reachable", func(t *testing.T) {
		// D: the writer's clock runs behind, so its live entry looks expired to
		// the walker.
		t.Parallel()
		mr := miniredis.RunT(t)
		writer := newTestRedisCacheOn(t, mr)
		walker := newTestRedisCacheOn(t, mr, &failCommands{name: "unlink"})
		advance(walker, 2*time.Minute)

		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{item}))

		_, err := walker.InvalidateByTags(t.Context(), []string{tag})
		require.ErrorIs(t, err, errInjected)
		require.True(t, mr.Exists(entryKey(item.Key)))

		requireNoDangling(t, mr, item)
	})

	t.Run("a walk cancelled midway leaves its entries reachable", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		writer := newTestRedisCacheOn(t, mr)
		interposer := &afterStep{names: []string{"zscan"}}
		walker := newTestRedisCacheOn(t, mr, interposer)
		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{item}))

		ctx, cancel := context.WithCancel(t.Context())
		interposer.fn = cancel
		_, _ = walker.InvalidateByTags(ctx, []string{tag})
		interposer.requireFired(t)

		requireNoDangling(t, mr, item)
	})

	t.Run("a walk that fails is finished by a retry", func(t *testing.T) {
		// Stands in for a router dying, or losing redis, mid-walk.
		t.Parallel()
		mr := miniredis.RunT(t)
		writer := newTestRedisCacheOn(t, mr)
		broken := newTestRedisCacheOn(t, mr, &failCommands{name: "unlink"})
		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{item}))

		_, err := broken.InvalidateByTags(t.Context(), []string{tag})
		require.ErrorIs(t, err, errInjected)
		require.True(t, mr.Exists(entryKey(item.Key)))
		require.Contains(t, zmembers(t, mr, tagIndexKey(tag)), item.Key, "still named")

		removed, err := writer.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)
		require.Equal(t, 1, removed)
		require.False(t, mr.Exists(entryKey(item.Key)))
	})

	t.Run("a SET landing after the walk's UNLINK is still named for the next walk", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		split := &splitPipeline{at: splitAt{pipeline: 0, before: "set"}}
		writer := newTestRedisCacheOn(t, mr, split)
		walker := newTestRedisCacheOn(t, mr)

		split.fn = func() {
			_, err := walker.InvalidateByTags(context.Background(), []string{tag})
			require.NoError(t, err)
		}
		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{item}))
		split.requireFired(t)

		require.True(t, mr.Exists(entryKey(item.Key)))
		require.Contains(t, zmembers(t, mr, tagIndexKey(tag)), item.Key)

		removed, err := walker.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)
		require.Equal(t, 1, removed)
		require.False(t, mr.Exists(entryKey(item.Key)))
	})

	t.Run("a walk marks members rather than removing them", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		c := newTestRedisCacheOn(t, mr)
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item}))

		removed, err := c.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)
		require.Equal(t, 1, removed)
		require.False(t, mr.Exists(entryKey(item.Key)))
		score, err := mr.ZScore(tagIndexKey(tag), item.Key)
		require.NoError(t, err)
		require.Negative(t, score)
		require.InDelta(t, -float64(c.now().UnixMilli()), score, float64(time.Second.Milliseconds()), "marked with the walk's time")
	})

	t.Run("a mark is swept after its entry is deleted again", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		c := newTestRedisCacheOn(t, mr)
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item}))
		_, err := c.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)

		require.NoError(t, mr.Set(entryKey(item.Key), "late"))
		removed, err := c.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)
		require.Equal(t, 1, removed)
		require.False(t, mr.Exists(entryKey(item.Key)))
		require.NotContains(t, zmembers(t, mr, tagIndexKey(tag)), item.Key)
	})

	t.Run("a sweep keeps a mark whose entry it failed to delete", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		writer := newTestRedisCacheOn(t, mr)
		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{item}))
		_, err := writer.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)

		broken := newTestRedisCacheOn(t, mr, &failCommands{name: "unlink"})
		_, err = broken.InvalidateByTags(t.Context(), []string{tag})
		require.ErrorIs(t, err, errInjected)
		require.Contains(t, zmembers(t, mr, tagIndexKey(tag)), item.Key)
	})

	t.Run("a write leaves a mark in place", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		writer := newTestRedisCacheOn(t, mr)
		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{item}))
		_, err := writer.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)

		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{item}))
		score, err := mr.ZScore(tagIndexKey(tag), item.Key)
		require.NoError(t, err)
		require.Negative(t, score, "only a walk removes a mark")
		require.LessOrEqual(t, mr.TTL(entryKey(item.Key)), writeLease, "so the write keeps its lease")

		_, err = writer.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)
		require.False(t, mr.Exists(entryKey(item.Key)))
		require.NotContains(t, zmembers(t, mr, tagIndexKey(tag)), item.Key)
	})

	t.Run("a write during a sweep keeps only its lease", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		writer := newTestRedisCacheOn(t, mr)
		interposer := &afterStep{names: []string{"unlink"}}
		walker := newTestRedisCacheOn(t, mr, interposer)
		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{item}))
		_, err := walker.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)

		// Between the sweep's delete and its removal, the key is cached again.
		interposer.fn = func() {
			require.NoError(t, writer.SetMany(context.Background(), []enginecache.Item{item}))
		}
		_, err = walker.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)
		interposer.requireFired(t)

		require.LessOrEqual(t, mr.TTL(entryKey(item.Key)), writeLease)
		mr.FastForward(writeLease)
		require.False(t, mr.Exists(entryKey(item.Key)))
	})

	t.Run("a write between the walk's delete and its mark is deleted too", func(t *testing.T) {
		// Left alone, a later write unmarking the member and losing its SET
		// would leave the extended entry behind a short score.
		t.Parallel()
		long := enginecache.Item{Key: "v1:a", Value: []byte(`{}`), TTL: time.Hour, Tags: []string{tag}}
		mr := miniredis.RunT(t)
		writer := newTestRedisCacheOn(t, mr)
		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{long}))
		interposer := &afterStep{names: []string{"unlink"}}
		walker := newTestRedisCacheOn(t, mr, interposer)
		interposer.fn = func() {
			require.NoError(t, writer.SetMany(context.Background(), []enginecache.Item{long}))
		}
		_, err := walker.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)
		interposer.requireFired(t)

		lost := newTestRedisCacheOn(t, mr, &failCommands{name: "set"})
		short := long
		short.TTL = 5 * time.Second
		_ = lost.SetMany(t.Context(), []enginecache.Item{short})

		later := short.TTL + tagIndexPruneGrace + time.Second
		mr.FastForward(later)
		advance(writer, later)
		other := enginecache.Item{Key: "v1:other", Value: []byte(`{}`), TTL: time.Hour, Tags: []string{tag}}
		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{other}))
		_, err = writer.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)
		require.False(t, mr.Exists(entryKey(long.Key)), "readable but unreachable")
	})

	t.Run("a walk dying after its mark leaves the member for a retry", func(t *testing.T) {
		// Its second delete never runs. A later write losing its SET mustn't
		// take the mark with it, or the entry written in the gap is orphaned.
		t.Parallel()
		long := enginecache.Item{Key: "v1:a", Value: []byte(`{}`), TTL: time.Hour, Tags: []string{tag}}
		mr := miniredis.RunT(t)
		writer := newTestRedisCacheOn(t, mr)
		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{long}))
		interposer := &afterStep{names: []string{"unlink"}}
		dying := newTestRedisCacheOn(t, mr, interposer, &failCommands{name: "unlink", pipelines: []int{1}})
		interposer.fn = func() {
			require.NoError(t, writer.SetMany(context.Background(), []enginecache.Item{long}))
		}
		_, err := dying.InvalidateByTags(t.Context(), []string{tag})
		require.ErrorIs(t, err, errInjected)
		interposer.requireFired(t)

		lost := newTestRedisCacheOn(t, mr, &failCommands{name: "set"})
		short := long
		short.TTL = 5 * time.Second
		_ = lost.SetMany(t.Context(), []enginecache.Item{short})

		later := short.TTL + tagIndexPruneGrace + time.Second
		mr.FastForward(later)
		advance(writer, later)
		other := enginecache.Item{Key: "v1:other", Value: []byte(`{}`), TTL: time.Hour, Tags: []string{tag}}
		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{other}))
		_, err = writer.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)
		require.False(t, mr.Exists(entryKey(long.Key)), "readable but unreachable")
	})

	t.Run("a late save after the mark is deleted before its mark is swept", func(t *testing.T) {
		// The walk lands between the writer's index write and its SET; the SET
		// finds its member marked, so keeps its lease. The next walk deletes it
		// before removing the name.
		t.Parallel()
		mr := miniredis.RunT(t)
		split := &splitPipeline{at: splitAt{pipeline: 0, before: "set"}}
		writer := newTestRedisCacheOn(t, mr, split)
		walker := newTestRedisCacheOn(t, mr)
		split.fn = func() {
			_, err := walker.InvalidateByTags(context.Background(), []string{tag})
			require.NoError(t, err)
		}
		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{item}))
		split.requireFired(t)
		require.True(t, mr.Exists(entryKey(item.Key)), "the late save")
		requireNoDangling(t, mr, item)

		_, err := walker.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)
		require.False(t, mr.Exists(entryKey(item.Key)))
		require.NotContains(t, zmembers(t, mr, tagIndexKey(tag)), item.Key)
	})

	t.Run("a key written twice in one batch takes the last write's lifetime", func(t *testing.T) {
		// The second SET wins; extending to the first item's expiry would keep
		// its value an hour past its own TTL.
		t.Parallel()
		long := enginecache.Item{Key: "v1:dup", Value: []byte(`{}`), TTL: time.Hour, Tags: []string{tag}}
		for name, second := range map[string]enginecache.Item{
			"short lived": {Key: "v1:dup", Value: []byte(`{"v":2}`), TTL: 5 * time.Second, Tags: []string{tag}},
			"untagged":    {Key: "v1:dup", Value: []byte(`{"v":2}`), TTL: time.Minute},
		} {
			t.Run(name, func(t *testing.T) {
				t.Parallel()
				mr := miniredis.RunT(t)
				c := newTestRedisCacheOn(t, mr)

				require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{long, second}))
				require.LessOrEqual(t, mr.TTL(entryKey("v1:dup")), second.TTL)
			})
		}
	})

	t.Run("the prune leaves marks alone", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		c := newTestRedisCacheOn(t, mr)
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item}))
		_, err := c.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)

		other := enginecache.Item{Key: "v1:other", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{tag}}
		advance(c, time.Hour)
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{other}))
		require.Contains(t, zmembers(t, mr, tagIndexKey(tag)), item.Key, "marks are the sweep's to remove")
	})

	t.Run("a list of only marks is still swept", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		c := newTestRedisCacheOn(t, mr)
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item}))
		_, err := c.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)

		_, err = c.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)
		require.False(t, mr.Exists(tagIndexKey(tag)))
	})

	t.Run("an extended entry expires at its member's score", func(t *testing.T) {
		// Not TTL from the extension: then a write slow enough could outlive
		// its member, which the prune drops once past its score.
		t.Parallel()
		mr := miniredis.RunT(t)
		writer := newTestRedisCacheOn(t, mr)
		advance(writer, -30*time.Second)

		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{item}))
		score, err := mr.ZScore(tagIndexKey(tag), item.Key)
		require.NoError(t, err)
		require.InDelta(t, time.Until(time.UnixMilli(int64(score))), mr.TTL(entryKey(item.Key)), float64(time.Second))
		require.Less(t, mr.TTL(entryKey(item.Key)), item.TTL-20*time.Second)
	})

	t.Run("an out of order write doesn't lower a member's score", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		c := newTestRedisCacheOn(t, mr)
		longer := item
		longer.TTL = time.Hour
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{longer}))
		high, err := mr.ZScore(tagIndexKey(tag), item.Key)
		require.NoError(t, err)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item}))
		score, err := mr.ZScore(tagIndexKey(tag), item.Key)
		require.NoError(t, err)
		require.Equal(t, high, score)
	})

	t.Run("a tagged write takes three round trips", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		counter := &countPipelines{}
		writer := newTestRedisCacheOn(t, mr, counter)

		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{item}))
		require.Equal(t, 3, counter.count())
	})

	// Braces in a tag mean nothing special.
	odd := enginecache.Item{Key: "v1:b", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"odd}tag"}}

	t.Run("a tag with stray braces survives a SET after the walk's UNLINK", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		split := &splitPipeline{at: splitAt{pipeline: 0, before: "set"}}
		writer := newTestRedisCacheOn(t, mr, split)
		walker := newTestRedisCacheOn(t, mr)

		split.fn = func() {
			_, err := walker.InvalidateByTags(context.Background(), odd.Tags)
			require.NoError(t, err)
		}
		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{odd}))
		split.requireFired(t)

		requireNoDangling(t, mr, odd)
	})

	t.Run("a tag with stray braces is finished by a retry", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		writer := newTestRedisCacheOn(t, mr)
		broken := newTestRedisCacheOn(t, mr, &failCommands{name: "unlink"})
		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{odd}))
		require.Equal(t, []string{odd.Key}, zmembers(t, mr, tagIndexKey(odd.Tags[0])))

		_, err := broken.InvalidateByTags(t.Context(), odd.Tags)
		require.ErrorIs(t, err, errInjected)
		require.Contains(t, zmembers(t, mr, tagIndexKey(odd.Tags[0])), odd.Key, "still named")

		removed, err := writer.InvalidateByTags(t.Context(), odd.Tags)
		require.NoError(t, err)
		require.Equal(t, 1, removed)
		require.False(t, mr.Exists(entryKey(odd.Key)))
	})

	t.Run("a writer dying before re-indexing leaves at most a lease-long entry", func(t *testing.T) {
		// A walk lands between the writer's index write and its SET, then the
		// writer dies: nothing after its first pipeline reaches redis.
		t.Parallel()
		mr := miniredis.RunT(t)
		split := &splitPipeline{at: splitAt{pipeline: 0, before: "set"}}
		writer := newTestRedisCacheOn(t, mr, &failCommands{pipelines: []int{1, 2}}, split)
		walker := newTestRedisCacheOn(t, mr)

		split.fn = func() {
			_, err := walker.InvalidateByTags(context.Background(), []string{tag})
			require.NoError(t, err)
		}
		_ = writer.SetMany(t.Context(), []enginecache.Item{item})
		split.requireFired(t)

		require.True(t, mr.Exists(entryKey(item.Key)), "unreachable for now")
		require.Positive(t, mr.TTL(entryKey(item.Key)))
		require.LessOrEqual(t, mr.TTL(entryKey(item.Key)), writeLease, "but only for the lease")

		mr.FastForward(writeLease)
		require.False(t, mr.Exists(entryKey(item.Key)))
	})

	t.Run("a confirmed write gets its full TTL", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		writer := newTestRedisCacheOn(t, mr)

		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{item}))
		require.InDelta(t, item.TTL, mr.TTL(entryKey(item.Key)), float64(time.Second))
	})

	t.Run("an item living no longer than the lease skips it", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		counter := &countPipelines{}
		writer := newTestRedisCacheOn(t, mr, counter)
		short := item
		short.TTL = writeLease / 2

		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{short}))
		require.Equal(t, short.TTL, mr.TTL(entryKey(item.Key)))
		require.Equal(t, 1, counter.count(), "nothing to finish")
	})

	t.Run("a failed lease extension leaves an indexed entry that expires early", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		writer := newTestRedisCacheOn(t, mr, &failScript{calls: "PEXPIREAT", pipelines: []int{2}})

		err := writer.SetMany(t.Context(), []enginecache.Item{item})
		require.ErrorIs(t, err, errInjected)
		require.LessOrEqual(t, mr.TTL(entryKey(item.Key)), writeLease)
		requireNoDangling(t, mr, item)
	})

	t.Run("a failed index write leaves no unindexed entry", func(t *testing.T) {
		// E: in a cluster the tag and entry keys sit on different nodes, so
		// one can fail while the other lands.
		t.Parallel()
		mr := miniredis.RunT(t)
		writer := newTestRedisCacheOn(t, mr, &failScript{calls: indexScript, pipelines: []int{0}})

		_ = writer.SetMany(t.Context(), []enginecache.Item{item})

		requireNoDangling(t, mr, item)
	})

	t.Run("an index that cannot be written leaves no entry, and says so", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		writer := newTestRedisCacheOn(t, mr, &failScript{calls: indexScript, pipelines: []int{0}})

		err := writer.SetMany(t.Context(), []enginecache.Item{item})
		require.ErrorIs(t, err, errInjected)
		var partial *enginecache.SetManyError
		if errors.As(err, &partial) {
			require.NotContains(t, partial.KnownStoredKeys, item.Key)
		}

		requireNoDangling(t, mr, item)
		require.False(t, mr.Exists(entryKey(item.Key)))
	})
}

// requireNoDangling fails if item's entry is live but missing from one of its
// tag indexes.
func requireNoDangling(t *testing.T, mr *miniredis.Miniredis, item enginecache.Item) {
	t.Helper()

	if !mr.Exists(entryKey(item.Key)) {
		return
	}
	for _, tag := range item.Tags {
		members := zmembers(t, mr, tagIndexKey(tag))
		require.Contains(t, members, item.Key, "entry is live but tag %q can't reach it", tag)
	}
}

func zmembers(t *testing.T, mr *miniredis.Miniredis, key string) []string {
	t.Helper()
	if !mr.Exists(key) {
		return nil
	}
	members, err := mr.ZMembers(key)
	require.NoError(t, err)
	return members
}

var errInjected = errors.New("injected failure")

// afterStep runs fn once, after the first command or pipeline containing a
// command named in names has been answered.
type afterStep struct {
	names []string
	fn    func()
	once  sync.Once
	fired bool
}

func (a *afterStep) fire(cmds ...redis.Cmder) {
	for _, cmd := range cmds {
		if slices.Contains(a.names, cmd.Name()) && a.fn != nil {
			a.once.Do(func() {
				a.fired = true
				a.fn()
			})
			return
		}
	}
}

// requireFired skips the test when the code under test has no such step.
func (a *afterStep) requireFired(t *testing.T) {
	t.Helper()
	if !a.fired {
		t.Skipf("no %v step in this implementation", a.names)
	}
}

func (a *afterStep) DialHook(next redis.DialHook) redis.DialHook { return next }

func (a *afterStep) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		err := next(ctx, cmd)
		a.fire(cmd)
		return err
	}
}

func (a *afterStep) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error {
		err := next(ctx, cmds)
		a.fire(cmds...)
		return err
	}
}

// splitAt names a point inside a call's pipelines: pipeline number pipeline,
// before its first command named before, or before all of it when empty.
type splitAt struct {
	pipeline int
	before   string
}

// splitPipeline runs fn at a point inside a pipeline, the way a cluster lets
// another client in between commands bound for different nodes.
type splitPipeline struct {
	at    splitAt
	fn    func()
	mu    sync.Mutex
	seen  int
	fired bool
}

// requireFired skips the test when the call has no such point.
func (s *splitPipeline) requireFired(t *testing.T) {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.fired {
		t.Skipf("no pipeline %d in this implementation", s.at.pipeline)
	}
}

func (s *splitPipeline) DialHook(next redis.DialHook) redis.DialHook { return next }

func (s *splitPipeline) ProcessHook(next redis.ProcessHook) redis.ProcessHook { return next }

func (s *splitPipeline) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error {
		s.mu.Lock()
		n := s.seen
		s.seen++
		hit := n == s.at.pipeline && s.fn != nil
		if hit {
			s.fired = true
		}
		s.mu.Unlock()
		if !hit {
			return next(ctx, cmds)
		}

		cut := 0
		if s.at.before != "" {
			cut = len(cmds)
			for i, cmd := range cmds {
				if cmd.Name() == s.at.before {
					cut = i
					break
				}
			}
		}
		var err error
		if cut > 0 {
			err = next(ctx, cmds[:cut])
		}
		s.fn()
		if cut < len(cmds) {
			err = errors.Join(err, next(ctx, cmds[cut:]))
		}
		return err
	}
}

// slowPipeline delays pipeline number pipeline before sending it.
type slowPipeline struct {
	pipeline int
	delay    time.Duration
	mu       sync.Mutex
	seen     int
}

func (s *slowPipeline) DialHook(next redis.DialHook) redis.DialHook { return next }

func (s *slowPipeline) ProcessHook(next redis.ProcessHook) redis.ProcessHook { return next }

func (s *slowPipeline) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error {
		s.mu.Lock()
		n := s.seen
		s.seen++
		s.mu.Unlock()
		if n == s.pipeline {
			time.Sleep(s.delay)
		}
		return next(ctx, cmds)
	}
}

// countPipelines counts round trips sent as pipelines.
type countPipelines struct {
	mu sync.Mutex
	n  int
}

func (c *countPipelines) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.n
}

func (c *countPipelines) DialHook(next redis.DialHook) redis.DialHook { return next }

func (c *countPipelines) ProcessHook(next redis.ProcessHook) redis.ProcessHook { return next }

func (c *countPipelines) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error {
		c.mu.Lock()
		c.n++
		c.mu.Unlock()
		return next(ctx, cmds)
	}
}

// failCommands fails every command named name (every command when empty)
// without sending it, in the listed pipelines (all when empty), the way a
// node that is down answers.
type failCommands struct {
	name      string
	pipelines []int
	mu        sync.Mutex
	seen      int
}

func (f *failCommands) matches(cmd redis.Cmder) bool {
	return f.name == "" || cmd.Name() == f.name
}

func (f *failCommands) DialHook(next redis.DialHook) redis.DialHook { return next }

func (f *failCommands) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		if f.matches(cmd) && f.pipelines == nil {
			cmd.SetErr(errInjected)
			return errInjected
		}
		return next(ctx, cmd)
	}
}

func (f *failCommands) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error {
		f.mu.Lock()
		n := f.seen
		f.seen++
		f.mu.Unlock()
		if f.pipelines != nil && !slices.Contains(f.pipelines, n) {
			return next(ctx, cmds)
		}

		send := make([]redis.Cmder, 0, len(cmds))
		var failed bool
		for _, cmd := range cmds {
			if f.matches(cmd) {
				cmd.SetErr(errInjected)
				failed = true
				continue
			}
			send = append(send, cmd)
		}
		var err error
		if len(send) > 0 {
			err = next(ctx, send)
		}
		if failed {
			return errors.Join(errInjected, err)
		}
		return err
	}
}
