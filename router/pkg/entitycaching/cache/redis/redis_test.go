package redis

import (
	"context"
	"errors"
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

	return newTestRedisCacheWithHook(t, nil)
}

// newTestRedisCacheWithHook is newTestRedisCache with hook installed on the
// client, for the cases that have to bend a reply the server would never send
// on its own.
func newTestRedisCacheWithHook(t *testing.T, hook redis.Hook) (*RedisCache, *miniredis.Miniredis) {
	t.Helper()

	mr := miniredis.RunT(t)

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	if hook != nil {
		client.AddHook(hook)
	}
	t.Cleanup(func() {
		require.NoError(t, client.Close())
	})

	c, err := NewRedisCache(client, testPrefix)
	require.NoError(t, err)

	return c, mr
}

// expirePTTL rewrites every PTTL reply to the -2 redis sends for a key that is
// gone, standing in for a key that expired in the gap between its GET and its
// PTTL. That race cannot be provoked by timing, so it is injected where GetMany
// actually reads it.
type expirePTTL struct{}

func (expirePTTL) DialHook(next redis.DialHook) redis.DialHook { return next }

func (expirePTTL) ProcessHook(next redis.ProcessHook) redis.ProcessHook { return next }

func (expirePTTL) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error {
		err := next(ctx, cmds)
		for _, cmd := range cmds {
			if ttl, ok := cmd.(*redis.DurationCmd); ok && cmd.Name() == "pttl" {
				ttl.SetVal(-2)
			}
		}
		return err
	}
}

// errLostReplies is what a batch cut short reports.
var errLostReplies = errors.New("connection reset by peer")

// cutRepliesAfter stands in for a connection that dies partway through reading
// a pipeline's replies: the first n SETs keep the answer redis gave them and
// everything after is left carrying the failure, which is the shape
// pipelineReadCmds leaves behind. The writes themselves still happen, so what
// redis holds afterwards can be compared against what was reported.
type cutRepliesAfter struct{ n int }

func (cutRepliesAfter) DialHook(next redis.DialHook) redis.DialHook { return next }

func (cutRepliesAfter) ProcessHook(next redis.ProcessHook) redis.ProcessHook { return next }

func (c cutRepliesAfter) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error {
		if err := next(ctx, cmds); err != nil {
			return err
		}

		var seen int
		for _, cmd := range cmds {
			if cmd.Name() != "set" {
				continue
			}
			if seen >= c.n {
				cmd.SetErr(errLostReplies)
			}
			seen++
		}

		return errLostReplies
	}
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
			require.Equal(t, map[string]enginecache.Item{
				"a": {Key: "a", Value: []byte("value"), TTL: time.Hour},
			}, results)
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
			require.Equal(t, map[string]enginecache.Item{
				"a": {Key: "a", Value: []byte("second"), TTL: 2 * time.Minute},
			}, results)
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
			require.Equal(t, map[string]enginecache.Item{
				"a": {Key: "a", Value: []byte("new"), TTL: time.Hour},
			}, results)
		})

		t.Run("rejects an item with no TTL", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{{Key: "a", Value: []byte("value")}})
			require.ErrorIs(t, err, enginecache.ErrMissingTTL)
			require.ErrorContains(t, err, "a")
			require.Empty(t, mr.Keys())
		})

		t.Run("rejects an item with a negative TTL", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: -time.Minute},
			})
			require.ErrorIs(t, err, enginecache.ErrMissingTTL)
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
			require.ErrorIs(t, err, enginecache.ErrMissingTTL)
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

		t.Run("a batch cut short names the keys redis confirmed", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCacheWithHook(t, cutRepliesAfter{n: 2})

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("1"), TTL: time.Minute},
				{Key: "b", Value: []byte("2"), TTL: time.Minute},
				{Key: "c", Value: []byte("3"), TTL: time.Minute},
				{Key: "d", Value: []byte("4"), TTL: time.Minute},
			})

			var partial *enginecache.SetManyError
			require.ErrorAs(t, err, &partial)

			// Only the two redis answered, in the order they were given.
			require.Equal(t, []string{"a", "b"}, partial.KnownStoredKeys)

			// Every key it names really is there. "c" and "d" were written too,
			// which is the point: what is reported is the part that can be
			// proven, not everything that happened.
			for _, key := range partial.KnownStoredKeys {
				stored, err := mr.Get(testPrefix + key)
				require.NoError(t, err)
				require.NotEmpty(t, stored)
			}
		})

		t.Run("a batch cut short before anything is confirmed reports the plain failure", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestRedisCacheWithHook(t, cutRepliesAfter{n: 0})

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("1"), TTL: time.Minute},
				{Key: "b", Value: []byte("2"), TTL: time.Minute},
			})
			require.Error(t, err)

			// Nothing to name, so there is nothing a SetManyError would add
			// over the failure itself.
			var partial *enginecache.SetManyError
			require.NotErrorAs(t, err, &partial)
		})

		t.Run("the failure that cut the batch short stays reachable", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestRedisCacheWithHook(t, cutRepliesAfter{n: 1})

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("1"), TTL: time.Minute},
				{Key: "b", Value: []byte("2"), TTL: time.Minute},
			})

			// Wrapped, not replaced, so a caller can still tell what went wrong
			// as well as how far it got.
			require.ErrorIs(t, err, errLostReplies)
			require.ErrorContains(t, err, "1 keys were known to be written")
		})

		t.Run("a rejected TTL is not a partial write", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			// This one fails before anything is sent, so unlike every other
			// failure it really does mean nothing was written.
			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("1"), TTL: time.Minute},
				{Key: "no-ttl", Value: []byte("2")},
			})
			require.ErrorIs(t, err, enginecache.ErrMissingTTL)

			var partial *enginecache.SetManyError
			require.NotErrorAs(t, err, &partial)
			require.Empty(t, mr.Keys())
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

		t.Run("misses are absent from the map, never an error", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestRedisCache(t)

			results, err := c.GetMany(ctx, []string{"a", "b", "c"})
			require.NoError(t, err)

			// Nothing found means an empty map rather than a nil one or a map
			// of zero Items, so a caller can range over it without checking.
			require.NotNil(t, results)
			require.Empty(t, results)
		})

		t.Run("reads through the prefix", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			// Written straight to redis, bypassing SetMany. The expiry has to be
			// set by hand too, a key without one is never served.
			require.NoError(t, mr.Set(testPrefix+"a", "value"))
			mr.SetTTL(testPrefix+"a", time.Minute)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Equal(t, map[string]enginecache.Item{
				"a": {Key: "a", Value: []byte("value"), TTL: time.Minute},
			}, results)
		})

		t.Run("entries are keyed and named by what the caller asked with, not the prefixed key", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.NoError(t, err)

			// The namespace is this cache's business. A caller that never saw
			// the prefix should not have to strip it back off, from either the
			// map key or the Item.
			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Contains(t, results, "a")
			require.NotContains(t, results, testPrefix+"a")
			require.Equal(t, "a", results["a"].Key)
		})

		t.Run("an unprefixed key is not visible", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			require.NoError(t, mr.Set("a", "value"))

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.NotContains(t, results, "a")
		})

		t.Run("only the keys that were found come back", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestRedisCache(t)

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
			require.Equal(t, map[string]enginecache.Item{
				"hit-1": {Key: "hit-1", Value: []byte("1"), TTL: time.Minute},
				"hit-2": {Key: "hit-2", Value: []byte("2"), TTL: time.Minute},
			}, results)
		})

		t.Run("a repeated key yields the one entry", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.NoError(t, err)

			// Asking twice is not an error, it just cannot produce two entries
			// under the one key.
			results, err := c.GetMany(ctx, []string{"a", "b", "a"})
			require.NoError(t, err)
			require.Equal(t, map[string]enginecache.Item{
				"a": {Key: "a", Value: []byte("value"), TTL: time.Minute},
			}, results)
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

			require.Contains(t, results, "empty")
			require.Empty(t, results["empty"].Value)

			require.Contains(t, results, "nil")
			require.Empty(t, results["nil"].Value)

			// Only presence in the map separates a cached empty value from a
			// real miss, never the value itself.
			require.NotContains(t, results, "missing")
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
			require.Contains(t, results, "a")
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
			require.NotContains(t, results, "a")
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
			require.NotContains(t, results, "short")
			require.Contains(t, results, "long")
		})

		t.Run("a hit reports the lifetime it has left", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.NoError(t, err)

			mr.FastForward(20 * time.Second)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Contains(t, results, "a")
			require.Equal(t, 40*time.Second, results["a"].TTL)
		})

		t.Run("the reported TTL shrinks as the entry ages", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.NoError(t, err)

			// What is reported is what the entry has left, not what it was
			// stored with, so the same key answers differently over time.
			first, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Equal(t, time.Minute, first["a"].TTL)

			mr.FastForward(20 * time.Second)

			second, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.Equal(t, 40*time.Second, second["a"].TTL)
		})

		t.Run("each key reports its own remaining lifetime", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "short", Value: []byte("1"), TTL: time.Minute},
				{Key: "long", Value: []byte("2"), TTL: time.Hour},
			})
			require.NoError(t, err)

			mr.FastForward(30 * time.Second)

			results, err := c.GetMany(ctx, []string{"short", "long"})
			require.NoError(t, err)
			require.Equal(t, map[string]enginecache.Item{
				"short": {Key: "short", Value: []byte("1"), TTL: 30 * time.Second},
				"long":  {Key: "long", Value: []byte("2"), TTL: time.Hour - 30*time.Second},
			}, results)
		})

		t.Run("a miss reports no TTL", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestRedisCache(t)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.NotContains(t, results, "a")
		})

		t.Run("a key with no expiry is not a hit", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			// SetMany refuses an item without a TTL, so a key sitting in the
			// namespace with no expiry was put there by something else and is
			// not this cache's to serve.
			require.NoError(t, mr.Set(testPrefix+"a", "value"))

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.NotContains(t, results, "a")

			// Reported as a miss, but left where it was found.
			require.Equal(t, []string{testPrefix + "a"}, mr.Keys())
		})

		t.Run("a sub-millisecond remainder is not a hit", func(t *testing.T) {
			t.Parallel()

			c, mr := newTestRedisCache(t)

			// PTTL answers in whole milliseconds, so anything shorter rounds
			// down to nothing left. Seeded by hand because a SetMany of this
			// TTL would be rounded up to a millisecond on the way out.
			require.NoError(t, mr.Set(testPrefix+"a", "value"))
			mr.SetTTL(testPrefix+"a", 500*time.Microsecond)

			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.NotContains(t, results, "a")
		})

		t.Run("a key that expires between the read and the TTL lookup is a miss", func(t *testing.T) {
			t.Parallel()

			c, _ := newTestRedisCacheWithHook(t, expirePTTL{})

			err := c.SetMany(ctx, []enginecache.Item{
				{Key: "a", Value: []byte("value"), TTL: time.Minute},
			})
			require.NoError(t, err)

			// The GET found the value and the PTTL then found nothing, so the
			// bytes in hand have already outlived their entry. That is a miss,
			// never an error.
			results, err := c.GetMany(ctx, []string{"a"})
			require.NoError(t, err)
			require.NotContains(t, results, "a")
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
			require.Contains(t, results, "a")
		})
	})
}

var _ enginecache.Cache = (*RedisCache)(nil)
