package cache

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/entitycaching"
)

const testPrefix = "entity:"

// newTestRedisCache returns a cache backed by an in-process Redis, plus the
// server itself so tests can inspect raw keys and drive expiry.
func newTestRedisCache(t *testing.T) (*RedisCache, *miniredis.Miniredis) {
	t.Helper()

	mr := miniredis.RunT(t)

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, client.Close())
	})

	c, err := NewRedisCache(client, testPrefix)
	require.NoError(t, err)

	return c, mr
}

func TestRedisCache(t *testing.T) {
	t.Parallel()

	ctx := context.Background()

	t.Run("NewRedisCache", func(t *testing.T) {
		t.Parallel()

		t.Run("rejects a nil client", func(t *testing.T) {
			t.Parallel()

			c, err := NewRedisCache(nil, testPrefix)
			require.Error(t, err)
			require.Nil(t, c)
		})

		t.Run("round trips through redis", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Hour},
			})
			require.NoError(t, err)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Equal(t, []enginecache.Result{{Value: []byte("value"), Found: true}}, results)
		})
	})

	t.Run("SetMany", func(t *testing.T) {
		t.Parallel()

		t.Run("nil items is a no-op", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			err := c.SetMany(ctx, nil)
			require.NoError(t, err)
			require.Empty(t, mr.Keys())
		})

		t.Run("empty items is a no-op", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{})
			require.NoError(t, err)
			require.Empty(t, mr.Keys())
		})

		t.Run("stores multiple items with their own TTLs", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("1"), TTL: time.Minute},
				{Key: "b", Value: []byte("2"), TTL: 2 * time.Minute},
			})
			require.NoError(t, err)

			stored, err := mr.Get(testPrefix + "a")
			require.NoError(t, err)
			require.Equal(t, "1", stored)

			require.Equal(t, time.Minute, mr.TTL(testPrefix+"a"))
			require.Equal(t, 2*time.Minute, mr.TTL(testPrefix+"b"))
		})

		t.Run("namespaces keys with the prefix", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.NoError(t, err)

			require.Equal(t, []string{testPrefix + "a"}, mr.Keys())
		})

		t.Run("duplicate key in one batch, last one wins", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("first"), TTL: time.Minute},
				{Key: "a", Value: []byte("second"), TTL: 2 * time.Minute},
			})
			require.NoError(t, err)

			require.Len(t, mr.Keys(), 1)
			require.Equal(t, 2*time.Minute, mr.TTL(testPrefix+"a"))

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Equal(t, []enginecache.Result{{Value: []byte("second"), Found: true}}, results)
		})

		t.Run("overwriting replaces value and TTL", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("old"), TTL: time.Minute},
			})
			require.NoError(t, err)

			err = c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("new"), TTL: time.Hour},
			})
			require.NoError(t, err)

			require.Equal(t, time.Hour, mr.TTL(testPrefix+"a"))

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Equal(t, []enginecache.Result{{Value: []byte("new"), Found: true}}, results)
		})

		t.Run("rejects an item with no TTL", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{{Key: "a", Value: []byte("value")}})
			require.ErrorIs(t, err, ErrMissingTTL)
			require.ErrorContains(t, err, "a")
			require.Empty(t, mr.Keys())
		})

		t.Run("rejects an item with a negative TTL", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: -time.Minute},
			})
			require.ErrorIs(t, err, ErrMissingTTL)
			require.Empty(t, mr.Keys())
		})

		t.Run("one bad item rejects the whole batch", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			// The valid items sit on both sides of the bad one, so an
			// implementation that queued as it went would leave traces.
			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "before", Value: []byte("1"), TTL: time.Minute},
				{Key: "no-ttl", Value: []byte("2")},
				{Key: "after", Value: []byte("3"), TTL: time.Minute},
			})
			require.ErrorIs(t, err, ErrMissingTTL)
			require.ErrorContains(t, err, "no-ttl")

			require.Empty(t, mr.Keys())
		})

		t.Run("cache tags are accepted and ignored", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{
					Key:   "a",
					Value: []byte("value"),
					TTL:   time.Minute,
				},
			})
			require.NoError(t, err)

			require.Equal(t, []string{testPrefix + "a"}, mr.Keys())
		})

		t.Run("reports a failure to reach redis", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)
			mr.Close()

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.Error(t, err)
		})
	})

	t.Run("GetMany", func(t *testing.T) {
		t.Parallel()

		t.Run("nil keys", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestRedisCache(t)

			results, err := c.GetMany(ctx, nil)
			require.NoError(t, err)
			require.Nil(t, results)
		})

		t.Run("empty keys", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestRedisCache(t)

			results, err := c.GetMany(ctx, []string{})
			require.NoError(t, err)
			require.Nil(t, results)
		})

		t.Run("misses are zero results, never an error", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestRedisCache(t)

			results, err := c.GetMany(ctx, []string{"a", "b", "c"})
			require.NoError(t, err)

			expected := make([]enginecache.Result, 3)
			require.Equal(t, expected, results)
		})

		t.Run("reads through the prefix", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			// Written straight to redis, bypassing SetMany.
			require.NoError(t, mr.Set(testPrefix+"a", "value"))

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Equal(t, []enginecache.Result{{Value: []byte("value"), Found: true}}, results)
		})

		t.Run("an unprefixed key is not visible", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			require.NoError(t, mr.Set("a", "value"))

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.False(t, results[0].Found)
		})

		t.Run("results stay positional across misses", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "hit-1", Value: []byte("1"), TTL: time.Minute},
				{Key: "hit-2", Value: []byte("2"), TTL: time.Minute},
			})
			require.NoError(t, err)

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

			c, _ := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.NoError(t, err)

			results, err := c.GetMany(ctx, []string{"a", "b", "a"})
			require.NoError(t, err)
			require.Equal(t, []enginecache.Result{
				{Value: []byte("value"), Found: true},
				{},
				{Value: []byte("value"), Found: true},
			}, results)

			// Each hit owns its bytes.
			results[0].Value[0] = 'V'
			require.Equal(t, []byte("value"), results[2].Value)
		})

		t.Run("a cached empty value is not a miss", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "empty", Value: []byte{}, TTL: time.Minute},
				{Key: "nil", Value: nil, TTL: time.Minute},
			})
			require.NoError(t, err)

			results, err := c.GetMany(ctx, []string{"empty", "nil", "missing"})
			require.NoError(t, err)

			require.True(t, results[0].Found)
			require.Empty(t, results[0].Value)

			require.True(t, results[1].Found)
			require.Empty(t, results[1].Value)

			// Only Found separates a cached empty value from a real miss.
			require.False(t, results[2].Found)
		})

		t.Run("reports a failure to reach redis", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)
			mr.Close()

			results, err := c.GetMany(ctx, []string{"a"})
			require.Error(t, err)
			// There is no partial read to salvage.
			require.Nil(t, results)
		})

		t.Run("one failed key fails the whole batch", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			// A hash where a string is expected, so GET returns WRONGTYPE. The
			// leading miss makes redis.Nil the error Exec reports, so the
			// per-command failure is only caught while reading the results.
			mr.HSet(testPrefix+"wrong-type", "field", "value")

			results, err := c.GetMany(ctx, []string{"missing", "wrong-type"})
			require.Error(t, err)
			require.ErrorContains(t, err, "wrong-type")
			require.Nil(t, results)
		})
	})

	t.Run("TTL", func(t *testing.T) {
		t.Parallel()

		t.Run("before expiry is a hit", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.NoError(t, err)

			mr.FastForward(30 * time.Second)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.True(t, results[0].Found)
		})

		t.Run("past expiry is a miss", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.NoError(t, err)

			// Redis owns expiry, so the key is gone without a sweep here.
			mr.FastForward(2 * time.Minute)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.False(t, results[0].Found)
			require.Empty(t, mr.Keys())
		})

		t.Run("expiry only drops the expired keys", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "short", Value: []byte("1"), TTL: time.Minute},
				{Key: "long", Value: []byte("2"), TTL: time.Hour},
			})
			require.NoError(t, err)

			mr.FastForward(2 * time.Minute)

			results, err := c.GetMany(ctx, []string{"short", "long"})
			require.NoError(t, err)
			require.False(t, results[0].Found)
			require.True(t, results[1].Found)
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

			c, _ := newTestRedisCache(t)

			cancelledCtx := cancelled()

			results, err := c.GetMany(cancelledCtx, []string{"a"})
			require.ErrorIs(t, err, context.Canceled)
			require.Nil(t, results)
		})

		t.Run("GetMany on an expired deadline", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestRedisCache(t)

			expiredCtx := expired(t)

			results, err := c.GetMany(expiredCtx, []string{"a"})
			require.ErrorIs(t, err, context.DeadlineExceeded)
			require.Nil(t, results)
		})

		t.Run("SetMany on a cancelled context stores nothing", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			cancelledCtx := cancelled()

			// A valid item, so the error can only be the cancellation.
			err := c.SetMany(cancelledCtx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.ErrorIs(t, err, context.Canceled)
			require.Empty(t, mr.Keys())
		})

		t.Run("SetMany on an expired deadline stores nothing", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			expiredCtx := expired(t)

			err := c.SetMany(expiredCtx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.ErrorIs(t, err, context.DeadlineExceeded)
			require.Empty(t, mr.Keys())
		})

		t.Run("a live context is unaffected", func(t *testing.T) {
			t.Parallel()

			liveCtx, cancel := context.WithTimeout(context.Background(), time.Minute)
			t.Cleanup(cancel)

			c, _ := newTestRedisCache(t)

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

var _ enginecache.Cache = (*RedisCache)(nil)
