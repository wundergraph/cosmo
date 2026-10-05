package redis

import (
	"context"
	"errors"
	"fmt"
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
	for _, step := range []string{"zrevrange", "zscan", "eval", "zrem", "unlink"} {
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

	t.Run("a walk cancelled after removing members leaves them reachable", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		writer := newTestRedisCacheOn(t, mr)
		interposer := &afterStep{names: []string{"zrem", "evalsha", "eval"}}
		walker := newTestRedisCacheOn(t, mr, interposer)
		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{item}))

		ctx, cancel := context.WithCancel(t.Context())
		interposer.fn = cancel
		_, _ = walker.InvalidateByTags(ctx, []string{tag})
		interposer.requireFired(t)

		requireNoDangling(t, mr, item)
	})

	t.Run("a walk that fails after moving members is finished by the next one", func(t *testing.T) {
		// Stands in for a router dying between the move and the UNLINK.
		t.Parallel()
		mr := miniredis.RunT(t)
		writer := newTestRedisCacheOn(t, mr)
		broken := newTestRedisCacheOn(t, mr, &failCommands{name: "unlink"})
		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{item}))

		_, err := broken.InvalidateByTags(t.Context(), []string{tag})
		require.ErrorIs(t, err, errInjected)
		pending, ok := pendingIndexKey(tag)
		require.True(t, ok)
		require.Equal(t, []string{item.Key}, zmembers(t, mr, pending), "owed a delete")
		require.Positive(t, mr.TTL(pending), "expires with its entries")
		require.NotContains(t, zmembers(t, mr, tagIndexKey(tag)), item.Key)

		removed, err := writer.InvalidateByTags(t.Context(), []string{tag})
		require.NoError(t, err)
		require.Equal(t, 1, removed)
		require.False(t, mr.Exists(entryKey(item.Key)))
		require.False(t, mr.Exists(pending))
	})

	t.Run("a tag whose pending key can't share its slot falls back to restoring", func(t *testing.T) {
		t.Parallel()
		odd := enginecache.Item{Key: "v1:b", Value: []byte(`{}`), TTL: time.Minute, Tags: []string{"odd}tag"}}
		_, ok := pendingIndexKey(odd.Tags[0])
		require.False(t, ok)

		mr := miniredis.RunT(t)
		writer := newTestRedisCacheOn(t, mr)
		broken := newTestRedisCacheOn(t, mr, &failCommands{name: "unlink"})
		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{odd}))

		_, err := broken.InvalidateByTags(t.Context(), odd.Tags)
		require.ErrorIs(t, err, errInjected)
		requireNoDangling(t, mr, odd)

		removed, err := writer.InvalidateByTags(t.Context(), odd.Tags)
		require.NoError(t, err)
		require.Equal(t, 1, removed)
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
		require.Equal(t, item.TTL, mr.TTL(entryKey(item.Key)))
	})

	t.Run("an item living no longer than the lease skips it", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		recorder := &recordCommands{}
		writer := newTestRedisCacheOn(t, mr, recorder)
		short := item
		short.TTL = writeLease / 2

		require.NoError(t, writer.SetMany(t.Context(), []enginecache.Item{short}))
		require.Equal(t, short.TTL, mr.TTL(entryKey(item.Key)))
		for _, cmd := range recorder.commands() {
			require.NotEqual(t, "pexpire", cmd.name)
		}
	})

	t.Run("a failed lease extension leaves an indexed entry that expires early", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		writer := newTestRedisCacheOn(t, mr, &failCommands{name: "pexpire"})

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
		writer := newTestRedisCacheOn(t, mr, &failCommands{name: "zadd", pipelines: []int{0}})

		_ = writer.SetMany(t.Context(), []enginecache.Item{item})

		requireNoDangling(t, mr, item)
	})

	t.Run("an index that cannot be written leaves no entry, and says so", func(t *testing.T) {
		t.Parallel()
		mr := miniredis.RunT(t)
		writer := newTestRedisCacheOn(t, mr, &failCommands{name: "zadd"})

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

// requireNoDangling fails if item's entry is live but neither in a tag's index
// nor owed a delete in its pending set.
func requireNoDangling(t *testing.T, mr *miniredis.Miniredis, item enginecache.Item) {
	t.Helper()

	if !mr.Exists(entryKey(item.Key)) {
		return
	}
	for _, tag := range item.Tags {
		members := zmembers(t, mr, tagIndexKey(tag))
		if pending, ok := pendingIndexKey(tag); ok {
			members = append(members, zmembers(t, mr, pending)...)
		}
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

func pendingIndexKey(tag string) (string, bool) {
	return (&RedisCache{prefix: testPrefix}).pendingKey(tag)
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

// A pending key must hash to its tag key's cluster slot, or the script moving
// members between them fails CROSSSLOT.
func TestPendingKeySharesTagKeySlot(t *testing.T) {
	t.Parallel()

	var found int
	for _, prefix := range []string{"", "entity:", "{cache}:", "a{b", "a}b"} {
		c := &RedisCache{prefix: prefix}
		for _, tag := range []string{"subgraph:accounts", `User:{"id":"1"}`, "{x}", "a{b", "odd}tag", "{}", "x{}y"} {
			pending, ok := c.pendingKey(tag)
			if !ok {
				continue
			}
			found++
			require.Equal(t, clusterSlot(c.tagKey(tag)), clusterSlot(pending), "prefix %q tag %q pending %q", prefix, tag, pending)
			require.NotEqual(t, c.tagKey(tag), pending)
		}
	}
	require.NotZero(t, found)

	// Realistic prefixes and tags always get one.
	for _, prefix := range []string{"", "entity:", "{cache}:"} {
		for _, tag := range []string{"subgraph:accounts", "type:accounts:User", `User:{"id":"1"}`} {
			_, ok := (&RedisCache{prefix: prefix}).pendingKey(tag)
			require.True(t, ok, "prefix %q tag %q", prefix, tag)
		}
	}
}

// clusterSlot is Redis Cluster's key slot: CRC16 (XMODEM) of the hash tag, or
// of the whole key without one, mod 16384.
func clusterSlot(key string) int {
	if s := strings.IndexByte(key, '{'); s >= 0 {
		if e := strings.IndexByte(key[s+1:], '}'); e > 0 {
			key = key[s+1 : s+1+e]
		}
	}
	var crc uint16
	for i := 0; i < len(key); i++ {
		crc ^= uint16(key[i]) << 8
		for range 8 {
			if crc&0x8000 != 0 {
				crc = crc<<1 ^ 0x1021
			} else {
				crc <<= 1
			}
		}
	}
	return int(crc) % 16384
}
