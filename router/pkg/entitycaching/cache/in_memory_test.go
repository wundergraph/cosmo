package cache

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/entitycaching"
)

func TestInMemoryCache(t *testing.T) {
	t.Parallel()

	ctx := context.Background()

	t.Run("NewInMemoryCache", func(t *testing.T) {
		t.Parallel()

		c := NewInMemoryCache()
		require.NotNil(t, c)
		require.NotNil(t, c.entries)
		require.Empty(t, c.entries)
		require.NotNil(t, c.now)

		err := c.SetMany(ctx, []enginecache.Item{
			{Key: "a", Value: []byte("value"), TTL: time.Hour},
		})
		require.NoError(t, err)

		results, err := c.GetMany(ctx, []string{"a"})
		require.NoError(t, err)
		require.Equal(t, []enginecache.Result{{Value: []byte("value"), Found: true}}, results)
	})

	t.Run("SetMany", func(t *testing.T) {
		t.Parallel()

		t.Run("nil items is a no-op", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestCache(t)

			err := c.SetMany(ctx, nil)
			require.NoError(t, err)
			require.Empty(t, c.entries)
		})

		t.Run("empty items is a no-op", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{})
			require.NoError(t, err)
			require.Empty(t, c.entries)
		})

		t.Run("stores multiple items", func(t *testing.T) {
			t.Parallel()

			c, clock := newTestCache(t)
			start := clock.Now()

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("1"), TTL: time.Minute},
				{Key: "b", Value: []byte("2"), TTL: 2 * time.Minute},
				{Key: "c", Value: []byte("3"), TTL: 3 * time.Minute},
			})
			require.NoError(t, err)

			// Each item keeps its own deadline.
			require.Equal(t, map[string]inMemoryEntry{
				"a": {value: []byte("1"), expiresAt: start.Add(time.Minute)},
				"b": {value: []byte("2"), expiresAt: start.Add(2 * time.Minute)},
				"c": {value: []byte("3"), expiresAt: start.Add(3 * time.Minute)},
			}, c.entries)
		})

		t.Run("duplicate key in one batch, last one wins", func(t *testing.T) {
			t.Parallel()

			c, clock := newTestCache(t)
			start := clock.Now()

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("first"), TTL: time.Minute},
				{Key: "a", Value: []byte("second"), TTL: 2 * time.Minute},
				{Key: "a", Value: []byte("third"), TTL: 3 * time.Minute},
			})
			require.NoError(t, err)

			require.Equal(t, map[string]inMemoryEntry{
				"a": {value: []byte("third"), expiresAt: start.Add(3 * time.Minute)},
			}, c.entries)
		})

		t.Run("overwrites an existing key", func(t *testing.T) {
			t.Parallel()

			c, clock := newTestCache(t)
			start := clock.Now()

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("old"), TTL: time.Minute},
			})
			require.NoError(t, err)

			err = c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("new"), TTL: time.Minute},
			})
			require.NoError(t, err)

			require.Equal(t, map[string]inMemoryEntry{
				"a": {value: []byte("new"), expiresAt: start.Add(time.Minute)},
			}, c.entries)
		})

		t.Run("overwriting replaces the previous TTL", func(t *testing.T) {
			t.Parallel()

			c, clock := newTestCache(t)
			start := clock.Now()

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("old"), TTL: time.Minute},
			})
			require.NoError(t, err)
			require.Equal(t, start.Add(time.Minute), c.entries["a"].expiresAt)

			// The entry is rebuilt rather than merged, so the new deadline wins
			// outright instead of being combined with the old one.
			err = c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("new"), TTL: time.Hour},
			})
			require.NoError(t, err)

			require.Equal(t, map[string]inMemoryEntry{
				"a": {value: []byte("new"), expiresAt: start.Add(time.Hour)},
			}, c.entries)
		})

		t.Run("rejects an item with no TTL", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{{Key: "a", Value: []byte("value")}})
			require.ErrorIs(t, err, ErrMissingTTL)
			require.ErrorContains(t, err, "a")
			require.Empty(t, c.entries)
		})

		t.Run("rejects an item with a negative TTL", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: -time.Minute},
			})
			require.ErrorIs(t, err, ErrMissingTTL)
			require.ErrorContains(t, err, "a")
			require.Empty(t, c.entries)
		})

		t.Run("stores the valid items and reports the skipped ones", func(t *testing.T) {
			t.Parallel()

			c, clock := newTestCache(t)
			start := clock.Now()

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "good", Value: []byte("1"), TTL: time.Minute},
				{Key: "no-ttl", Value: []byte("2")},
				{Key: "negative-ttl", Value: []byte("3"), TTL: -time.Minute},
			})
			require.ErrorIs(t, err, ErrMissingTTL)
			require.ErrorContains(t, err, "no-ttl")
			require.ErrorContains(t, err, "negative-ttl")

			// One bad item does not cost the rest of the batch.
			require.Equal(t, map[string]inMemoryEntry{
				"good": {value: []byte("1"), expiresAt: start.Add(time.Minute)},
			}, c.entries)
		})

		t.Run("a rejected item leaves an existing entry untouched", func(t *testing.T) {
			t.Parallel()

			c, clock := newTestCache(t)
			start := clock.Now()

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("original"), TTL: time.Minute},
			})
			require.NoError(t, err)

			err = c.SetMany(ctx, []enginecache.Item{{Key: "a", Value: []byte("replacement")}})
			require.ErrorIs(t, err, ErrMissingTTL)

			// A rejected overwrite is skipped, not applied and not deleted.
			require.Equal(t, map[string]inMemoryEntry{
				"a": {value: []byte("original"), expiresAt: start.Add(time.Minute)},
			}, c.entries)
		})

		t.Run("copies the value it is given", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestCache(t)

			value := []byte("original")

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: value, TTL: time.Minute},
			})
			require.NoError(t, err)

			// A caller reusing its buffer must not corrupt what was stored.
			copy(value, "mutated!")

			require.Equal(t, []byte("original"), c.entries["a"].value)
		})

		t.Run("cache tags are accepted and ignored", func(t *testing.T) {
			t.Parallel()

			c, clock := newTestCache(t)
			start := clock.Now()

			err := c.SetMany(ctx, []enginecache.Item{
				{
					Key:       "a",
					Value:     []byte("value"),
					TTL:       time.Minute,
					CacheTags: []string{"tag-1", "tag-2"},
				},
			})
			require.NoError(t, err)

			// The tags are dropped, the entry holds nothing but value and expiry.
			require.Equal(t, map[string]inMemoryEntry{
				"a": {value: []byte("value"), expiresAt: start.Add(time.Minute)},
			}, c.entries)
		})
	})

	t.Run("GetMany", func(t *testing.T) {
		t.Parallel()

		t.Run("nil keys", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestCache(t)

			results, err := c.GetMany(ctx, nil)
			require.NoError(t, err)
			require.Nil(t, results)
		})

		t.Run("empty keys", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestCache(t)

			results, err := c.GetMany(ctx, []string{})
			require.NoError(t, err)
			require.Nil(t, results)
		})

		t.Run("misses are zero results, never an error", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestCache(t)

			results, err := c.GetMany(ctx, []string{"a", "b", "c"})
			require.NoError(t, err)

			expected := make([]enginecache.Result, 3)
			require.Equal(t, expected, results)

			for i, result := range results {
				require.False(t, result.Found, "result %d", i)
				require.Nil(t, result.Value, "result %d", i)
			}
		})

		t.Run("hit", func(t *testing.T) {
			t.Parallel()

			c, clock := newTestCache(t)

			// Seeded directly rather than through SetMany, so a SetMany bug
			// cannot fail a GetMany test.
			c.entries = map[string]inMemoryEntry{
				"a": {value: []byte("value"), expiresAt: clock.Now().Add(time.Minute)},
			}

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Equal(t, []enginecache.Result{{Value: []byte("value"), Found: true}}, results)
		})

		t.Run("results stay positional across misses", func(t *testing.T) {
			t.Parallel()

			c, clock := newTestCache(t)
			expiresAt := clock.Now().Add(time.Minute)

			c.entries = map[string]inMemoryEntry{
				"hit-1": {value: []byte("1"), expiresAt: expiresAt},
				"hit-2": {value: []byte("2"), expiresAt: expiresAt},
			}

			results, err := c.GetMany(ctx, []string{"miss-1", "hit-1", "miss-2", "hit-2", "miss-3"})
			require.NoError(t, err)
			require.Equal(t, []enginecache.Result{
				{},
				{Value: []byte("1"), Found: true},
				{},
				{Value: []byte("2"), Found: true},
				{},
			}, results)
		})

		t.Run("duplicate keys are looked up independently", func(t *testing.T) {
			t.Parallel()

			c, clock := newTestCache(t)

			c.entries = map[string]inMemoryEntry{
				"a": {value: []byte("value"), expiresAt: clock.Now().Add(time.Minute)},
			}

			results, err := c.GetMany(ctx, []string{"a", "b", "a"})
			require.NoError(t, err)
			require.Equal(t, []enginecache.Result{
				{Value: []byte("value"), Found: true},
				{},
				{Value: []byte("value"), Found: true},
			}, results)

			// Independently means the two hits do not share a backing array.
			results[0].Value[0] = 'V'
			require.Equal(t, []byte("value"), results[2].Value)
		})

		t.Run("a cached empty value is not a miss", func(t *testing.T) {
			t.Parallel()

			c, clock := newTestCache(t)
			expiresAt := clock.Now().Add(time.Minute)

			c.entries = map[string]inMemoryEntry{
				"empty": {value: []byte{}, expiresAt: expiresAt},
				"nil":   {value: nil, expiresAt: expiresAt},
			}

			results, err := c.GetMany(ctx, []string{"empty", "nil", "missing"})
			require.NoError(t, err)

			require.True(t, results[0].Found)
			require.Empty(t, results[0].Value)

			require.True(t, results[1].Found)
			require.Empty(t, results[1].Value)

			// Only Found separates a cached empty value from a real miss.
			require.False(t, results[2].Found)
		})

		t.Run("returns a copy of the cached value", func(t *testing.T) {
			t.Parallel()

			c, clock := newTestCache(t)

			c.entries = map[string]inMemoryEntry{
				"a": {value: []byte("original"), expiresAt: clock.Now().Add(time.Minute)},
			}

			first, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			copy(first[0].Value, "mutated!")

			second, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Equal(t, []enginecache.Result{{Value: []byte("original"), Found: true}}, second)
		})
	})

	t.Run("TTL", func(t *testing.T) {
		t.Parallel()

		t.Run("before expiry is a hit", func(t *testing.T) {
			t.Parallel()

			c, clock := newTestCache(t)

			c.entries = map[string]inMemoryEntry{
				"a": {value: []byte("value"), expiresAt: clock.Now().Add(time.Minute)},
			}

			clock.Advance(time.Minute - time.Nanosecond)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.True(t, results[0].Found)
		})

		t.Run("exactly at expiry is still a hit", func(t *testing.T) {
			t.Parallel()

			c, clock := newTestCache(t)

			c.entries = map[string]inMemoryEntry{
				"a": {value: []byte("value"), expiresAt: clock.Now().Add(time.Minute)},
			}

			// Expiry is exclusive: the entry dies strictly after expiresAt.
			clock.Advance(time.Minute)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.True(t, results[0].Found)
			require.Len(t, c.entries, 1)
		})

		t.Run("past expiry is a miss and evicts the entry", func(t *testing.T) {
			t.Parallel()

			c, clock := newTestCache(t)

			c.entries = map[string]inMemoryEntry{
				"a": {value: []byte("value"), expiresAt: clock.Now().Add(time.Minute)},
			}

			clock.Advance(time.Minute + time.Nanosecond)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.False(t, results[0].Found)
			require.Nil(t, results[0].Value)

			// The expired entry is dropped, not merely reported as a miss.
			require.NotContains(t, c.entries, "a")
			require.Empty(t, c.entries)
		})

		t.Run("eviction only drops the expired keys", func(t *testing.T) {
			t.Parallel()

			c, clock := newTestCache(t)
			start := clock.Now()

			c.entries = map[string]inMemoryEntry{
				"expired-1": {value: []byte("1"), expiresAt: start.Add(time.Minute)},
				"expired-2": {value: []byte("2"), expiresAt: start.Add(90 * time.Second)},
				"live":      {value: []byte("3"), expiresAt: start.Add(time.Hour)},
			}

			clock.Advance(2 * time.Minute)

			results, err := c.GetMany(ctx, []string{"expired-1", "expired-2", "live"})
			require.NoError(t, err)
			require.False(t, results[0].Found)
			require.False(t, results[1].Found)
			require.True(t, results[2].Found)

			// One sweep drops every expired key it saw, and nothing else.
			require.NotContains(t, c.entries, "expired-1")
			require.NotContains(t, c.entries, "expired-2")
			require.Contains(t, c.entries, "live")
		})

		t.Run("TTL is measured from the clock at set time", func(t *testing.T) {
			t.Parallel()

			c, clock := newTestCache(t)
			start := clock.Now()

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "first", Value: []byte("1"), TTL: time.Minute},
			})
			require.NoError(t, err)

			clock.Advance(30 * time.Second)

			err = c.SetMany(ctx, []enginecache.Item{
				{Key: "second", Value: []byte("2"), TTL: time.Minute},
			})
			require.NoError(t, err)

			// The clock is read per call, so an identical TTL 30s later lands
			// 30s further out rather than on the same deadline.
			require.Equal(t, start.Add(time.Minute), c.entries["first"].expiresAt)
			require.Equal(t, start.Add(90*time.Second), c.entries["second"].expiresAt)
		})

		t.Run("an expired key can be set again", func(t *testing.T) {
			t.Parallel()

			c, clock := newTestCache(t)

			c.entries = map[string]inMemoryEntry{
				"a": {value: []byte("old"), expiresAt: clock.Now().Add(time.Minute)},
			}

			clock.Advance(2 * time.Minute)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.False(t, results[0].Found)

			err = c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("new"), TTL: time.Minute},
			})
			require.NoError(t, err)

			results, err = c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Equal(t, []enginecache.Result{{Value: []byte("new"), Found: true}}, results)
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

			c, clock := newTestCache(t)

			c.entries = map[string]inMemoryEntry{
				"a": {value: []byte("value"), expiresAt: clock.Now().Add(time.Minute)},
			}

			cancelledCtx := cancelled()

			results, err := c.GetMany(cancelledCtx, []string{"a"})
			require.ErrorIs(t, err, context.Canceled)
			// There is no partial read to salvage.
			require.Nil(t, results)
		})

		t.Run("GetMany on an expired deadline", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestCache(t)

			expiredCtx := expired(t)

			results, err := c.GetMany(expiredCtx, []string{"a"})
			require.ErrorIs(t, err, context.DeadlineExceeded)
			require.Nil(t, results)
		})

		t.Run("SetMany on a cancelled context stores nothing", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestCache(t)

			cancelledCtx := cancelled()

			// A valid item, so the error can only be the cancellation.
			err := c.SetMany(cancelledCtx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.ErrorIs(t, err, context.Canceled)
			require.Empty(t, c.entries)
		})

		t.Run("SetMany on an expired deadline stores nothing", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestCache(t)

			expiredCtx := expired(t)

			err := c.SetMany(expiredCtx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.ErrorIs(t, err, context.DeadlineExceeded)
			require.Empty(t, c.entries)
		})

		t.Run("a live context is unaffected", func(t *testing.T) {
			t.Parallel()

			liveCtx, cancel := context.WithTimeout(context.Background(), time.Minute)
			t.Cleanup(cancel)

			c, _ := newTestCache(t)

			err := c.SetMany(liveCtx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.NoError(t, err)

			results, err := c.GetMany(liveCtx, []string{"a"})
			require.NoError(t, err)
			require.True(t, results[0].Found)
		})
	})
}

var _ enginecache.Cache = (*InMemoryCache)(nil)

// fakeClock is a manually advanced clock, so TTL behaviour is exercised without
// sleeping. It is mutex guarded so it stays safe to share across goroutines.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func newFakeClock() *fakeClock {
	return &fakeClock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// newTestCache returns a cache driven by a fake clock seeded at a fixed instant,
// so a failure always reproduces.
func newTestCache(t *testing.T) (*InMemoryCache, *fakeClock) {
	t.Helper()

	c := NewInMemoryCache()
	clock := newFakeClock()
	c.now = clock.Now

	return c, clock
}
