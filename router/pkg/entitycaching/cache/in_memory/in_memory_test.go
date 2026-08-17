package in_memory

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/entitycaching"
	"go.uber.org/goleak"
)

// Every cache here runs goroutines until it is closed, so a case that forgets
// to close one is a leak this catches rather than a slow drift nobody notices.
func TestMain(m *testing.M) {
	goleak.VerifyTestMain(m)
}

const (
	// ttlSlack is how much of a nominal TTL a case allows to have been spent
	// between the write and the read. The upper bound needs no slack: a
	// reported TTL is what was stored minus however long has passed, so it can
	// only come back smaller. Only the lower bound is at the mercy of the
	// machine, and five seconds is orders of magnitude more than these cases
	// take while still being far too small to confuse minute-apart TTLs.
	ttlSlack = 5 * time.Second

	// Polling beats sleeping in both directions: it finishes as soon as the
	// property holds instead of always paying the worst case, and a stalled
	// runner costs time rather than a false failure.
	eventuallyFor  = 2 * time.Second
	eventuallyTick = 10 * time.Millisecond

	// shortTTL is what a case uses when it wants an entry to go away. It sets
	// the earliest moment the entry can vanish, never a deadline for noticing,
	// so it can be short without being fragile.
	shortTTL = 10 * time.Millisecond
)

// newTestCache returns a cache with far more room than any case here needs.
// While the cache holds fewer entries than its size, every write is admitted
// outright rather than weighed against what is already there, so a SetMany
// followed by a GetMany is decided by this file and not by an eviction sample.
func newTestCache(t *testing.T) *InMemoryCache {
	t.Helper()

	return newTestCacheOfSize(t, 1000)
}

// newTestCacheOfSize is newTestCache for the one case that cares about what
// happens at the size limit.
func newTestCacheOfSize(t *testing.T, maxEntries int64) *InMemoryCache {
	t.Helper()

	c, err := NewInMemoryCache(maxEntries)
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, c.Close())
	})

	return c
}

// requireTTLNear asserts a reported lifetime is at most what was stored and no
// more than ttlSlack short of it.
func requireTTLNear(t *testing.T, want, got time.Duration) {
	t.Helper()

	require.Positive(t, got)
	require.LessOrEqual(t, got, want)
	require.Greater(t, got, want-ttlSlack)
}

func TestInMemoryCache(t *testing.T) {
	t.Parallel()

	ctx := context.Background()

	t.Run("NewInMemoryCache", func(t *testing.T) {
		t.Parallel()

		t.Run("rejects a size of zero", func(t *testing.T) {
			t.Parallel()

			c, err := NewInMemoryCache(0)
			require.Error(t, err)
			require.Nil(t, c)
		})

		t.Run("rejects a negative size", func(t *testing.T) {
			t.Parallel()

			c, err := NewInMemoryCache(-1)
			require.Error(t, err)
			require.Nil(t, c)
		})

		t.Run("rejects a size too large to count", func(t *testing.T) {
			t.Parallel()

			// Ten counters per entry has to fit, and this is the size at which
			// that multiplication is what overflows rather than the size.
			c, err := NewInMemoryCache(math.MaxInt64)
			require.Error(t, err)
			require.Nil(t, c)
		})

		t.Run("round trips through the cache", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Hour},
			})
			require.NoError(t, err)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Contains(t, results, "a")
			require.Equal(t, "a", results["a"].Key)
			require.Equal(t, []byte("value"), results["a"].Value)
			requireTTLNear(t, time.Hour, results["a"].TTL)
		})
	})

	t.Run("SetMany", func(t *testing.T) {
		t.Parallel()

		t.Run("nil items is a no-op", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, nil)
			require.NoError(t, err)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Empty(t, results)
		})

		t.Run("empty items is a no-op", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{})
			require.NoError(t, err)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Empty(t, results)
		})

		t.Run("what it stores is visible as soon as it returns", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			// The cache applies writes on a background goroutine, so without a
			// flush before SetMany returns this read would be a race. Several
			// keys, because one would be the easiest case to get right by luck.
			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("1"), TTL: time.Hour},
				{Key: "b", Value: []byte("2"), TTL: time.Hour},
				{Key: "c", Value: []byte("3"), TTL: time.Hour},
			})
			require.NoError(t, err)

			results, err := c.GetMany(ctx, []string{"a", "b", "c"})
			require.NoError(t, err)
			require.Len(t, results, 3)
		})

		t.Run("stores multiple items with their own TTLs", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("1"), TTL: time.Minute},
				{Key: "b", Value: []byte("2"), TTL: 2 * time.Minute},
				{Key: "c", Value: []byte("3"), TTL: 3 * time.Minute},
			})
			require.NoError(t, err)

			results, err := c.GetMany(ctx, []string{"a", "b", "c"})
			require.NoError(t, err)
			require.Len(t, results, 3)

			// Each item keeps its own deadline, and they stay far enough apart
			// that the slack cannot blur one into another.
			require.Equal(t, []byte("1"), results["a"].Value)
			requireTTLNear(t, time.Minute, results["a"].TTL)
			requireTTLNear(t, 2*time.Minute, results["b"].TTL)
			requireTTLNear(t, 3*time.Minute, results["c"].TTL)
		})

		t.Run("duplicate key in one batch, last one wins", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			// The cache underneath cannot be handed the same new key three
			// times and be relied on to keep the last: until a write leaves its
			// buffer the next one looks like another fresh insert, which its
			// admission policy turns down for a key it is already holding. So
			// SetMany writes only the last mention of a key, and this is what
			// says so.
			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("first"), TTL: time.Minute},
				{Key: "a", Value: []byte("second"), TTL: 2 * time.Minute},
				{Key: "a", Value: []byte("third"), TTL: 3 * time.Minute},
			})
			require.NoError(t, err)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Len(t, results, 1)
			require.Equal(t, []byte("third"), results["a"].Value)
			requireTTLNear(t, 3*time.Minute, results["a"].TTL)
		})

		t.Run("overwrites an existing key", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("old"), TTL: time.Minute},
			})
			require.NoError(t, err)

			err = c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("new"), TTL: time.Minute},
			})
			require.NoError(t, err)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Equal(t, []byte("new"), results["a"].Value)
		})

		t.Run("overwriting replaces the previous TTL", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("old"), TTL: time.Minute},
			})
			require.NoError(t, err)

			// The entry is rebuilt rather than merged, so the new deadline wins
			// outright instead of being combined with the old one.
			err = c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("new"), TTL: time.Hour},
			})
			require.NoError(t, err)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			requireTTLNear(t, time.Hour, results["a"].TTL)
		})

		t.Run("rejects an item with no TTL", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{{Key: "a", Value: []byte("value")}})
			require.ErrorIs(t, err, enginecache.ErrMissingTTL)
			require.ErrorContains(t, err, "a")

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Empty(t, results)
		})

		t.Run("rejects an item with a negative TTL", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: -time.Minute},
			})
			require.ErrorIs(t, err, enginecache.ErrMissingTTL)
			require.ErrorContains(t, err, "a")

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Empty(t, results)
		})

		t.Run("one item with an invalid TTL rejects the whole batch", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			// The items with a valid TTL sit on both sides of the invalid one,
			// so an implementation that wrote as it went would leave traces.
			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "before", Value: []byte("1"), TTL: time.Minute},
				{Key: "invalid-ttl", Value: []byte("2")},
				{Key: "after", Value: []byte("3"), TTL: time.Minute},
			})
			require.ErrorIs(t, err, enginecache.ErrMissingTTL)
			require.ErrorContains(t, err, "invalid-ttl")

			results, err := c.GetMany(ctx, []string{"before", "invalid-ttl", "after"})
			require.NoError(t, err)
			require.Empty(t, results)
		})

		t.Run("a rejected item leaves an existing entry untouched", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("original"), TTL: time.Minute},
			})
			require.NoError(t, err)

			err = c.SetMany(ctx, []enginecache.Item{{Key: "a", Value: []byte("replacement")}})
			require.ErrorIs(t, err, enginecache.ErrMissingTTL)

			// A rejected overwrite is skipped, not applied and not deleted.
			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Equal(t, []byte("original"), results["a"].Value)
		})

		t.Run("copies the value it is given", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			value := []byte("original")

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: value, TTL: time.Minute},
			})
			require.NoError(t, err)

			// The cache underneath keeps the slice it is handed, so without a
			// copy a caller reusing its buffer would rewrite what was stored.
			copy(value, "mutated!")

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Equal(t, []byte("original"), results["a"].Value)
		})

		t.Run("a write beyond the cache size is not an error", func(t *testing.T) {
			t.Parallel()

			c := newTestCacheOfSize(t, 1)

			// Past its size the cache decides for itself what is worth keeping,
			// and a write it turns down is not a failure to report. Nothing is
			// asserted about which of these survives, only that asking was not
			// an error: a nil error here was never a promise of a later hit.
			for _, key := range []string{"a", "b", "c"} {
				err := c.SetMany(ctx, []enginecache.Item{
					{Key: key, Value: []byte(key), TTL: time.Hour},
				})
				require.NoError(t, err)
			}
		})
	})

	t.Run("GetMany", func(t *testing.T) {
		t.Parallel()

		t.Run("nil keys", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			results, err := c.GetMany(ctx, nil)
			require.NoError(t, err)
			require.Nil(t, results)
		})

		t.Run("empty keys", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			results, err := c.GetMany(ctx, []string{})
			require.NoError(t, err)
			require.Nil(t, results)
		})

		t.Run("misses are absent from the map, never an error", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			results, err := c.GetMany(ctx, []string{"a", "b", "c"})
			require.NoError(t, err)

			// Nothing found means an empty map rather than a nil one or a map
			// of zero Items, so a caller can range over it without checking.
			require.NotNil(t, results)
			require.Empty(t, results)
		})

		t.Run("hit", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.NoError(t, err)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Len(t, results, 1)
			require.Equal(t, "a", results["a"].Key)
			require.Equal(t, []byte("value"), results["a"].Value)
		})

		t.Run("only the keys that were found come back", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "hit-1", Value: []byte("1"), TTL: time.Minute},
				{Key: "hit-2", Value: []byte("2"), TTL: time.Minute},
			})
			require.NoError(t, err)

			// The misses are interleaved, so an implementation that lined the
			// map up with the key order rather than the keys themselves would
			// mislabel the hits.
			results, err := c.GetMany(ctx, []string{"miss-1", "hit-1", "miss-2", "hit-2", "miss-3"})
			require.NoError(t, err)
			require.Len(t, results, 2)
			require.Equal(t, []byte("1"), results["hit-1"].Value)
			require.Equal(t, []byte("2"), results["hit-2"].Value)
		})

		t.Run("a repeated key yields the one entry", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.NoError(t, err)

			// Asking twice is not an error, it just cannot produce two entries
			// under the one key.
			results, err := c.GetMany(ctx, []string{"a", "b", "a"})
			require.NoError(t, err)
			require.Len(t, results, 1)
			require.Equal(t, []byte("value"), results["a"].Value)
		})

		t.Run("a cached empty value is not a miss", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "empty", Value: []byte{}, TTL: time.Minute},
				{Key: "nil", Value: nil, TTL: time.Minute},
			})
			require.NoError(t, err)

			results, err := c.GetMany(ctx, []string{"empty", "nil", "missing"})
			require.NoError(t, err)

			require.Contains(t, results, "empty")
			require.Empty(t, results["empty"].Value)

			require.Contains(t, results, "nil")
			require.Empty(t, results["nil"].Value)

			// Only presence in the map separates a cached empty value from a
			// real miss, never the value itself.
			require.NotContains(t, results, "missing")
		})

		t.Run("returns a copy of the cached value", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("original"), TTL: time.Minute},
			})
			require.NoError(t, err)

			// The cache underneath hands back the slice it stored, so without a
			// copy this would rewrite the entry rather than the caller's own.
			first, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			copy(first["a"].Value, "mutated!")

			second, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Equal(t, []byte("original"), second["a"].Value)
		})
	})

	t.Run("TTL", func(t *testing.T) {
		t.Parallel()

		t.Run("a hit reports the lifetime it has left", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Hour},
			})
			require.NoError(t, err)

			// Asserted outright rather than polled: SetMany has already flushed
			// what it wrote, so a miss here would be a bug and waiting for one
			// to go away would only hide it.
			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Contains(t, results, "a")
			requireTTLNear(t, time.Hour, results["a"].TTL)
		})

		t.Run("the reported TTL shrinks as the entry ages", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Hour},
			})
			require.NoError(t, err)

			// What is reported is what the entry has left, not what it was
			// stored with, so the same key answers differently over time.
			first, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Contains(t, first, "a")

			// Polled rather than read twice back to back, which would be a bet
			// on the clock separating two adjacent calls.
			require.Eventually(t, func() bool {
				later, err := c.GetMany(ctx, []string{"a"})
				if err != nil {
					return false
				}
				item, ok := later["a"]

				return ok && item.TTL < first["a"].TTL
			}, eventuallyFor, eventuallyTick)
		})

		t.Run("a miss reports no TTL", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.NotContains(t, results, "a")
			require.Zero(t, results["a"].TTL)
		})

		t.Run("past expiry is a miss", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: shortTTL},
			})
			require.NoError(t, err)

			// An expired entry is refused the moment it is past its deadline,
			// so this is waiting on the deadline itself rather than on whatever
			// eventually reclaims the memory.
			require.Eventually(t, func() bool {
				results, err := c.GetMany(ctx, []string{"a"})

				return err == nil && len(results) == 0
			}, eventuallyFor, eventuallyTick)
		})

		t.Run("expiry only drops the expired keys", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "short", Value: []byte("1"), TTL: shortTTL},
				{Key: "long", Value: []byte("2"), TTL: time.Hour},
			})
			require.NoError(t, err)

			require.Eventually(t, func() bool {
				results, err := c.GetMany(ctx, []string{"short"})

				return err == nil && len(results) == 0
			}, eventuallyFor, eventuallyTick)

			results, err := c.GetMany(ctx, []string{"short", "long"})
			require.NoError(t, err)
			require.NotContains(t, results, "short")
			require.Contains(t, results, "long")
			requireTTLNear(t, time.Hour, results["long"].TTL)
		})

		t.Run("an expired key can be set again", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("old"), TTL: shortTTL},
			})
			require.NoError(t, err)

			require.Eventually(t, func() bool {
				results, err := c.GetMany(ctx, []string{"a"})

				return err == nil && len(results) == 0
			}, eventuallyFor, eventuallyTick)

			// The expired entry may well still be sitting there unreclaimed, so
			// this is the case where a write lands on top of one rather than
			// arriving as a fresh insert.
			err = c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("new"), TTL: time.Hour},
			})
			require.NoError(t, err)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Equal(t, []byte("new"), results["a"].Value)
			requireTTLNear(t, time.Hour, results["a"].TTL)
		})

		t.Run("a hit always has something left", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: 20 * time.Millisecond},
			})
			require.NoError(t, err)

			// Read across the deadline until the entry goes. Presence is never
			// asserted, only what a hit has to look like, so the race decides
			// how many times round this goes and never whether it passes.
			var vanished bool
			for deadline := time.Now().Add(eventuallyFor); time.Now().Before(deadline); {
				results, err := c.GetMany(ctx, []string{"a"})
				require.NoError(t, err)

				item, ok := results["a"]
				if !ok {
					vanished = true
					break
				}

				// Handed back spent is the one thing it may never be.
				require.Positive(t, item.TTL)
			}
			require.True(t, vanished, "the entry never expired")
		})
	})

	t.Run("Close", func(t *testing.T) {
		t.Parallel()

		t.Run("is idempotent", func(t *testing.T) {
			t.Parallel()

			// Twice here, and a third time from the cleanup the helper
			// registered, so a second shutdown path reaching it is not a panic.
			c := newTestCache(t)
			require.NoError(t, c.Close())
			require.NoError(t, c.Close())
		})
	})

	t.Run("context cancellation", func(t *testing.T) {
		t.Parallel()

		cancelled := func() context.Context {
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			return ctx
		}

		expired := func(t *testing.T) context.Context {
			ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Hour))
			t.Cleanup(cancel)
			return ctx
		}

		t.Run("GetMany on a cancelled context", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.NoError(t, err)

			results, err := c.GetMany(cancelled(), []string{"a"})
			require.ErrorIs(t, err, context.Canceled)
			// There is no partial read to salvage.
			require.Nil(t, results)
		})

		t.Run("GetMany on an expired deadline", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			results, err := c.GetMany(expired(t), []string{"a"})
			require.ErrorIs(t, err, context.DeadlineExceeded)
			require.Nil(t, results)
		})

		t.Run("SetMany on a cancelled context stores nothing", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			// A valid item, so the error can only be the cancellation.
			err := c.SetMany(cancelled(), []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.ErrorIs(t, err, context.Canceled)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Empty(t, results)
		})

		t.Run("SetMany on an expired deadline stores nothing", func(t *testing.T) {
			t.Parallel()

			c := newTestCache(t)

			err := c.SetMany(expired(t), []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.ErrorIs(t, err, context.DeadlineExceeded)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Empty(t, results)
		})

		t.Run("a live context is unaffected", func(t *testing.T) {
			t.Parallel()

			liveCtx, cancel := context.WithTimeout(context.Background(), time.Minute)
			t.Cleanup(cancel)

			c := newTestCache(t)

			err := c.SetMany(liveCtx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.NoError(t, err)

			results, err := c.GetMany(liveCtx, []string{"a"})
			require.NoError(t, err)
			require.Contains(t, results, "a")
		})
	})
}

var _ enginecache.Cache = (*InMemoryCache)(nil)
