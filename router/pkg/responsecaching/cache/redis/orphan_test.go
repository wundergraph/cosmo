package redis

import (
	"context"
	"fmt"
	"math"
	"math/rand/v2"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/stretchr/testify/require"
	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

// Attempts to leave an entry live past its lease but unreachable from a tag.
func TestRedisCacheOrphanAttempts(t *testing.T) {
	t.Parallel()

	const tag = "subgraph:accounts"
	item := enginecache.Item{Key: "v1:a", Value: []byte(`{}`), TTL: time.Hour, Tags: []string{tag}}

	// B's prune uses B's clock against A's scores.
	for _, skew := range []time.Duration{tagIndexPruneGrace - time.Second, tagIndexPruneGrace + 2*time.Minute} {
		t.Run(fmt.Sprintf("another writer %s ahead prunes a live member", skew), func(t *testing.T) {
			t.Parallel()
			if skew > tagIndexPruneGrace {
				t.Skip("known gap: writer clock skew past tagIndexPruneGrace")
			}
			mr := miniredis.RunT(t)
			a := newTestRedisCacheOn(t, mr)
			b := newTestRedisCacheOn(t, mr)
			require.NoError(t, a.SetMany(t.Context(), []enginecache.Item{item}))

			// A minute left.
			elapsed := item.TTL - time.Minute
			mr.FastForward(elapsed)
			advance(a, elapsed)
			advance(b, elapsed+skew)
			other := enginecache.Item{Key: "v1:b", Value: []byte(`{}`), TTL: time.Hour, Tags: []string{tag}}
			require.NoError(t, b.SetMany(t.Context(), []enginecache.Item{other}))

			requireNoDangling(t, mr, item)
			requireInvalidated(t, mr, a, item)
		})
	}

	// Entry expires at A's absolute time, tag set after a relative TTL.
	for _, skew := range []time.Duration{tagIndexPruneGrace - time.Minute, tagIndexPruneGrace + time.Minute} {
		t.Run(fmt.Sprintf("a writer %s ahead outlives its tag set", skew), func(t *testing.T) {
			t.Parallel()
			if skew > tagIndexPruneGrace {
				t.Skip("known gap: writer clock skew past tagIndexPruneGrace")
			}
			mr := miniredis.RunT(t)
			a := newTestRedisCacheOn(t, mr)
			advance(a, skew)
			require.NoError(t, a.SetMany(t.Context(), []enginecache.Item{item}))

			mr.FastForward(tagLifetime(item) + time.Second)
			requireNoDangling(t, mr, item)
		})
	}

	// Eviction or a failover drops index state the write confirmed.
	lost := map[string]func(t *testing.T, mr *miniredis.Miniredis){
		"tag set": func(t *testing.T, mr *miniredis.Miniredis) {
			mr.Del(tagIndexKey(tag))
		},
		"member": func(t *testing.T, mr *miniredis.Miniredis) {
			_, err := mr.ZRem(tagIndexKey(tag), item.Key)
			require.NoError(t, err)
		},
	}
	for name, lose := range lost {
		t.Run("a confirmed write whose "+name+" is lost", func(t *testing.T) {
			t.Parallel()
			t.Skip("known gap: index lost to eviction or failover")
			mr := miniredis.RunT(t)
			c := newTestRedisCacheOn(t, mr)
			require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item}))

			lose(t, mr)
			requireNoDangling(t, mr, item)
		})
	}

	t.Run("a member lost between lift and extend", func(t *testing.T) {
		t.Parallel()
		t.Skip("known gap: index lost to eviction or failover")
		mr := miniredis.RunT(t)
		split := &splitPipeline{at: splitAt{pipeline: 2}}
		c := newTestRedisCacheOn(t, mr, split)
		split.fn = func() {
			_, err := mr.ZRem(tagIndexKey(tag), item.Key)
			require.NoError(t, err)
		}
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item}))
		split.requireFired(t)

		requireNoDangling(t, mr, item)
	})

	// TTL + grace overflows to a negative tag lifetime.
	t.Run("a TTL near the max duration", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		c := newTestRedisCacheOn(t, mr)
		neighbour := enginecache.Item{Key: "v1:b", Value: []byte(`{}`), TTL: time.Hour, Tags: []string{tag}}
		huge := enginecache.Item{Key: "v1:a", Value: []byte(`{}`), TTL: math.MaxInt64 - time.Minute, Tags: []string{tag}}
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{neighbour}))

		_ = c.SetMany(t.Context(), []enginecache.Item{huge})
		requireNoDangling(t, mr, neighbour)
		requireNoDangling(t, mr, huge)
		requireInvalidated(t, mr, c, neighbour)
		requireInvalidated(t, mr, c, huge)
	})

	t.Run("a key written twice in one batch with disjoint tags", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		c := newTestRedisCacheOn(t, mr)
		first := enginecache.Item{Key: "v1:a", Value: []byte(`{"v":1}`), TTL: time.Hour, Tags: []string{"x"}}
		last := enginecache.Item{Key: "v1:a", Value: []byte(`{"v":2}`), TTL: time.Hour, Tags: []string{"y"}}
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{first, last}))

		requireNoDangling(t, mr, last)
		requireInvalidated(t, mr, c, last)
	})

	// Random interleavings inside a write, clocks skewed within the grace.
	for seed := range uint64(200) {
		t.Run(fmt.Sprintf("interleaving seed %d", seed), func(t *testing.T) {
			t.Parallel()
			fuzzInterleaving(t, seed)
		})
	}
}

func fuzzInterleaving(t *testing.T, seed uint64) {
	r := rand.New(rand.NewPCG(seed, seed))
	tags := []string{"x", "y"}
	ttls := []time.Duration{5 * time.Second, 30 * time.Second, time.Hour}
	maxSkew := tagIndexPruneGrace - time.Minute
	skew := func() time.Duration { return time.Duration(r.Int64N(int64(2*maxSkew))) - maxSkew }

	// Values are unique, so the stored entry names the item it came from.
	written := map[string]enginecache.Item{}
	newItem := func() enginecache.Item {
		var picked []string
		for _, tag := range tags {
			if r.IntN(2) == 0 {
				picked = append(picked, tag)
			}
		}
		if len(picked) == 0 {
			picked = []string{tags[r.IntN(len(tags))]}
		}
		value := fmt.Sprintf(`{"w":%d}`, len(written))
		it := enginecache.Item{Key: "v1:a", Value: []byte(value), TTL: ttls[r.IntN(len(ttls))], Tags: picked}
		written[value] = it
		return it
	}

	mr := miniredis.RunT(t)
	at := splitAt{pipeline: r.IntN(3)}
	if at.pipeline == 0 && r.IntN(2) == 0 {
		at.before = "set"
	}
	split := &splitPipeline{at: at}
	writer := newTestRedisCacheOn(t, mr, split)
	advance(writer, skew())
	other := newTestRedisCacheOn(t, mr)
	advance(other, skew())
	walker := newTestRedisCacheOn(t, mr)

	ctx := context.Background()
	split.fn = func() {
		for range 1 + r.IntN(3) {
			switch r.IntN(3) {
			case 0:
				_, err := walker.InvalidateByTags(ctx, []string{tags[r.IntN(len(tags))]})
				require.NoError(t, err)
			case 1:
				require.NoError(t, other.SetMany(ctx, []enginecache.Item{newItem()}))
			case 2:
				// Walk stopping after its mark.
				stopping := newTestRedisCacheOn(t, mr, &failCommands{name: "unlink", pipelines: []int{1}})
				_, _ = stopping.InvalidateByTags(ctx, []string{tags[r.IntN(len(tags))]})
			}
		}
	}
	require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{newItem()}))

	if !mr.Exists(entryKey("v1:a")) {
		return
	}
	stored, err := mr.Get(entryKey("v1:a"))
	require.NoError(t, err)
	value, _, _, err := enginecache.DecodeEntry(entryBody([]byte(stored)))
	require.NoError(t, err)
	owner, ok := written[string(value)]
	require.True(t, ok, "entry from no known write")
	requireNoDangling(t, mr, owner)
}

// requireInvalidated invalidates item's tags and fails if its entry is still
// live past its lease.
func requireInvalidated(t *testing.T, mr *miniredis.Miniredis, c *RedisCache, item enginecache.Item) {
	t.Helper()
	_, err := c.InvalidateByTags(t.Context(), item.Tags)
	require.NoError(t, err)
	if mr.Exists(entryKey(item.Key)) {
		require.LessOrEqual(t, mr.TTL(entryKey(item.Key)), writeLease, "survived invalidating its tags")
	}
}
