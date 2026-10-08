package redis

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

// A write's second round trip lands after another write replaced its entry.
// It must not touch the replacement.
func TestRedisCacheFinishOnlyTouchesOwnWrite(t *testing.T) {
	t.Parallel()

	const tag = "subgraph:accounts"
	long := enginecache.Item{Key: "v1:a", Value: []byte(`{"v":1}`), TTL: time.Hour, Tags: []string{tag}}
	short := enginecache.Item{Key: "v1:a", Value: []byte(`{"v":2}`), TTL: 5 * time.Second, Tags: []string{tag}}

	// writer's fn runs between its two round trips.
	between := func(t *testing.T, fn func(mr *miniredis.Miniredis, other *RedisCache)) (*miniredis.Miniredis, *RedisCache, *RedisCache) {
		t.Helper()
		mr := miniredis.RunT(t)
		split := &splitPipeline{at: splitAt{pipeline: 1}}
		writer := newTestRedisCacheOn(t, mr, split)
		other := newTestRedisCacheOn(t, mr)
		split.fn = func() { fn(mr, other) }
		_ = writer.SetMany(t.Context(), []enginecache.Item{long})
		split.requireFired(t)
		return mr, writer, other
	}

	for name, replacement := range map[string]enginecache.Item{
		"shorter TTL":       short,
		"identical payload": {Key: long.Key, Value: long.Value, TTL: 5 * time.Second, Tags: long.Tags},
		"other tags":        {Key: long.Key, Value: []byte(`{"v":2}`), TTL: 5 * time.Second, Tags: []string{"type:accounts:User"}},
		"untagged":          {Key: long.Key, Value: []byte(`{"v":2}`), TTL: 5 * time.Second},
	} {
		t.Run("a replacement with "+name+" keeps its lifetime", func(t *testing.T) {
			t.Parallel()
			mr, _, _ := between(t, func(_ *miniredis.Miniredis, other *RedisCache) {
				require.NoError(t, other.SetMany(context.Background(), []enginecache.Item{replacement}))
			})
			require.LessOrEqual(t, mr.TTL(entryKey(long.Key)), replacement.TTL)
			requireNoDangling(t, mr, replacement)
		})
	}

	t.Run("a replacement after an invalidation stays reachable once pruned", func(t *testing.T) {
		t.Parallel()
		mr, writer, other := between(t, func(_ *miniredis.Miniredis, other *RedisCache) {
			_, err := other.InvalidateByTags(context.Background(), []string{tag})
			require.NoError(t, err)
			require.NoError(t, other.SetMany(context.Background(), []enginecache.Item{short}))
		})

		// Past short's TTL and the prune grace; a write to the tag prunes it.
		later := short.TTL + tagIndexPruneGrace + time.Second
		mr.FastForward(later)
		advance(writer, later)
		advance(other, later)
		another := enginecache.Item{Key: "v1:b", Value: []byte(`{}`), TTL: time.Hour, Tags: []string{tag}}
		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{another}))

		_, err := other.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)
		require.False(t, mr.Exists(entryKey(long.Key)), "readable but unreachable")
	})

	t.Run("a failed index write doesn't delete a replacement", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		split := &splitPipeline{at: splitAt{pipeline: 1}}
		writer := newTestRedisCacheOn(t, mr, &failCommands{name: "zadd", pipelines: []int{0}}, split)
		other := newTestRedisCacheOn(t, mr)
		split.fn = func() {
			require.NoError(t, other.SetMany(context.Background(), []enginecache.Item{short}))
		}
		_ = writer.SetMany(t.Context(), []enginecache.Item{long})
		split.requireFired(t)

		got, err := other.GetMany(t.Context(), []string{short.Key})
		require.NoError(t, err)
		require.Equal(t, short.Value, got[short.Key].Value)
	})

	t.Run("a second round trip retried after the first applied changes nothing", func(t *testing.T) {
		// A lost reply makes the client resend.
		t.Parallel()
		mr := miniredis.RunT(t)
		recorder := &recordCommands{}
		writer := newTestRedisCacheOn(t, mr, &replayPipeline{pipeline: 1}, recorder)

		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{long}))
		require.InDelta(t, long.TTL, mr.TTL(entryKey(long.Key)), float64(time.Second))
		requireNoDangling(t, mr, long)
	})
}

// A write's SET lands after a walk marked its member and a shorter write
// unmarked it. Its extension must not outlive that member.
func TestRedisCacheLateSetAfterShorterRewrite(t *testing.T) {
	t.Parallel()

	const tag = "subgraph:accounts"
	long := enginecache.Item{Key: "v1:a", Value: []byte(`{"v":1}`), TTL: time.Hour, Tags: []string{tag}}
	short := enginecache.Item{Key: "v1:a", Value: []byte(`{"v":2}`), TTL: 5 * time.Second, Tags: []string{tag}}

	setup := func(t *testing.T, hooks ...redis.Hook) (*miniredis.Miniredis, *RedisCache, *RedisCache) {
		t.Helper()
		mr := miniredis.RunT(t)
		split := &splitPipeline{at: splitAt{pipeline: 0, before: "set"}}
		writer := newTestRedisCacheOn(t, mr, append(hooks, split)...)
		other := newTestRedisCacheOn(t, mr)
		split.fn = func() {
			_, err := other.InvalidateByTags(context.Background(), []string{tag})
			require.NoError(t, err)
			require.NoError(t, other.SetMany(context.Background(), []enginecache.Item{short}))
		}
		_ = writer.SetMany(t.Context(), []enginecache.Item{long})
		split.requireFired(t)
		return mr, writer, other
	}

	t.Run("stays reachable once the shorter member would be pruned", func(t *testing.T) {
		t.Parallel()
		mr, writer, other := setup(t)
		requireNoDangling(t, mr, long)

		later := short.TTL + tagIndexPruneGrace + time.Second
		mr.FastForward(later)
		advance(writer, later)
		advance(other, later)
		another := enginecache.Item{Key: "v1:b", Value: []byte(`{}`), TTL: time.Hour, Tags: []string{tag}}
		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{another}))

		_, err := other.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)
		require.False(t, mr.Exists(entryKey(long.Key)), "readable but unreachable")
	})

	t.Run("a member that can't be lifted drops the extended entry", func(t *testing.T) {
		t.Parallel()
		mr, _, _ := setup(t, &failScript{calls: "ZSCORE", pipelines: []int{1}})
		requireNoDangling(t, mr, long)
		require.LessOrEqual(t, mr.TTL(entryKey(long.Key)), writeLease)
	})
}

// replayPipeline sends pipeline number pipeline twice, the way a client
// retries after a reply is lost.
type replayPipeline struct {
	pipeline int
	mu       sync.Mutex
	seen     int
}

func (r *replayPipeline) DialHook(next redis.DialHook) redis.DialHook { return next }

func (r *replayPipeline) ProcessHook(next redis.ProcessHook) redis.ProcessHook { return next }

func (r *replayPipeline) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error {
		r.mu.Lock()
		n := r.seen
		r.seen++
		r.mu.Unlock()
		if n == r.pipeline {
			_ = next(ctx, cmds)
		}
		return next(ctx, cmds)
	}
}

// failScript fails every script calling calls without sending it, in the
// listed pipelines.
type failScript struct {
	calls     string
	pipelines []int
	mu        sync.Mutex
	seen      int
}

func (f *failScript) runs(cmd redis.Cmder) bool {
	args := cmd.Args()
	if len(args) < 2 {
		return false
	}
	body, _ := args[1].(string)
	return strings.Contains(body, f.calls)
}

func (f *failScript) DialHook(next redis.DialHook) redis.DialHook { return next }

func (f *failScript) ProcessHook(next redis.ProcessHook) redis.ProcessHook { return next }

func (f *failScript) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error {
		f.mu.Lock()
		n := f.seen
		f.seen++
		f.mu.Unlock()
		if !slices.Contains(f.pipelines, n) {
			return next(ctx, cmds)
		}
		send := make([]redis.Cmder, 0, len(cmds))
		for _, cmd := range cmds {
			if f.runs(cmd) {
				cmd.SetErr(errInjected)
				continue
			}
			send = append(send, cmd)
		}
		err := errInjected
		if len(send) > 0 {
			err = errors.Join(err, next(ctx, send))
		}
		return err
	}
}
