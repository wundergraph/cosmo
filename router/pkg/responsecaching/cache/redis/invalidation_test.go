package redis

import (
	"context"
	"fmt"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

// Invalidation is the only reader of the tag index, so what these pin is that
// it removes what the index named, removes the index entry with it, and reports
// a count a caller can act on.
func TestRedisCacheInvalidateByTags(t *testing.T) {
	t.Parallel()

	item := func(key string, tags ...string) enginecache.Item {
		return enginecache.Item{Key: key, Value: []byte(`{}`), TTL: time.Minute, Tags: tags}
	}

	t.Run("a tag takes the entries it names and nothing else", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			item("v1:a", "declared:accounts:users"),
			item("v1:b", "declared:accounts:users"),
			item("v1:c", "declared:accounts:posts"),
		}))

		removed, err := c.InvalidateByTags(t.Context(), []string{"declared:accounts:users"})
		require.NoError(t, err)
		require.Equal(t, 2, removed)

		require.False(t, mr.Exists(entryKey("v1:a")))
		require.False(t, mr.Exists(entryKey("v1:b")))
		require.True(t, mr.Exists(entryKey("v1:c")))
	})

	t.Run("the tag itself goes with the entries it named", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			item("v1:a", "declared:accounts:users"),
		}))
		require.True(t, mr.Exists(tagIndexKey("declared:accounts:users")))

		_, err := c.InvalidateByTags(t.Context(), []string{"declared:accounts:users"})
		require.NoError(t, err)

		require.False(t, mr.Exists(tagIndexKey("declared:accounts:users")))
	})

	t.Run("a tag naming nothing is not an error", func(t *testing.T) {
		t.Parallel()
		c, _ := newTestRedisCache(t)

		removed, err := c.InvalidateByTags(t.Context(), []string{"declared:accounts:never-written"})
		require.NoError(t, err)
		require.Zero(t, removed)
	})

	t.Run("several tags are counted together", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			item("v1:a", "type:accounts:User"),
			item("v1:b", "type:accounts:Post"),
		}))

		removed, err := c.InvalidateByTags(t.Context(), []string{"type:accounts:User", "type:accounts:Post"})
		require.NoError(t, err)
		require.Equal(t, 2, removed)
		require.False(t, mr.Exists(entryKey("v1:a")))
		require.False(t, mr.Exists(entryKey("v1:b")))
	})

	t.Run("an entry stays named by its other tags once one has taken it", func(t *testing.T) {
		// Nothing walks back through an entry's other tags to remove it from
		// them, so what has to hold is that the leftover member costs a later
		// call nothing worse than removing a key that is already gone.
		t.Parallel()
		c, mr := newTestRedisCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			item("v1:a", "declared:accounts:users", "subgraph:accounts", "type:accounts:User"),
		}))

		removed, err := c.InvalidateByTags(t.Context(), []string{"declared:accounts:users"})
		require.NoError(t, err)
		require.Equal(t, 1, removed)
		require.False(t, mr.Exists(entryKey("v1:a")))

		members, err := mr.ZMembers(tagIndexKey("subgraph:accounts"))
		require.NoError(t, err)
		require.Equal(t, []string{"v1:a"}, members, "still named by the tag that did not take it")

		// Missing entry, expiry still ahead: indistinguishable from a write in
		// flight, so it is left until its expiry passes.
		removed, err = c.InvalidateByTags(t.Context(), []string{"subgraph:accounts"})
		require.NoError(t, err)
		require.Zero(t, removed, "counted from what redis removed, and the entry was already gone")
		members, err = mr.ZMembers(tagIndexKey("subgraph:accounts"))
		require.NoError(t, err)
		require.Equal(t, []string{"v1:a"}, members)

		advance(c, 2*time.Minute)
		removed, err = c.InvalidateByTags(t.Context(), []string{"subgraph:accounts"})
		require.NoError(t, err)
		require.Zero(t, removed)
		require.False(t, mr.Exists(tagIndexKey("subgraph:accounts")))
	})

	t.Run("an entry gone on its own TTL is not counted as removed", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			item("v1:a", "declared:accounts:users"),
		}))
		mr.FastForward(2 * time.Minute)
		advance(c, 2*time.Minute)

		removed, err := c.InvalidateByTags(t.Context(), []string{"declared:accounts:users"})
		require.NoError(t, err)
		require.Zero(t, removed)
		require.False(t, mr.Exists(tagIndexKey("declared:accounts:users")), "expired member is dropped with nothing to wait for")
	})

	t.Run("a member whose entry has not landed yet is left for the next call", func(t *testing.T) {
		// SetMany writes the index ahead of the entry and the two are not
		// atomic. Dropping the member here would leave the entry, once it
		// lands, where no invalidation could find it.
		t.Parallel()
		c, mr := newTestRedisCache(t)

		expireAt := float64(c.now().Add(time.Minute).UnixMilli())
		mr.ZAdd(tagIndexKey("subgraph:accounts"), expireAt, "v1:a")

		removed, err := c.InvalidateByTags(t.Context(), []string{"subgraph:accounts"})
		require.NoError(t, err)
		require.Zero(t, removed)
		members, err := mr.ZMembers(tagIndexKey("subgraph:accounts"))
		require.NoError(t, err)
		require.Equal(t, []string{"v1:a"}, members, "kept: nothing to remove yet, and something may be coming")

		// The entry lands. Its ZADD is a no-op on the member already there.
		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item("v1:a", "subgraph:accounts")}))

		removed, err = c.InvalidateByTags(t.Context(), []string{"subgraph:accounts"})
		require.NoError(t, err)
		require.Equal(t, 1, removed)
		require.False(t, mr.Exists(entryKey("v1:a")))
		require.False(t, mr.Exists(tagIndexKey("subgraph:accounts")))
	})

	t.Run("members left in place do not stop the walk reaching later pages", func(t *testing.T) {
		// Kept members sort ahead of what is unread, so paging has to step
		// past them or it would read the same page forever.
		t.Parallel()
		c, mr := newTestRedisCache(t)

		const count = invalidationPageSize*2 + 1
		items := make([]enginecache.Item, 0, count)
		for i := range count {
			items = append(items, item(fmt.Sprintf("v1:%d", i), "subgraph:accounts"))
		}
		require.NoError(t, c.SetMany(t.Context(), items))

		// Entries gone but members not: indistinguishable from writes in flight.
		for i := 0; i < count; i += 2 {
			mr.Del(entryKey(fmt.Sprintf("v1:%d", i)))
		}

		removed, err := c.InvalidateByTags(t.Context(), []string{"subgraph:accounts"})
		require.NoError(t, err)
		require.Equal(t, count/2, removed)

		members, err := mr.ZMembers(tagIndexKey("subgraph:accounts"))
		require.NoError(t, err)
		require.Len(t, members, count-count/2)
		for i := range count {
			require.False(t, mr.Exists(entryKey(fmt.Sprintf("v1:%d", i))))
		}
	})

	t.Run("a tag naming more entries than one page still takes all of them", func(t *testing.T) {
		// The index is walked in pages, so the boundary is where an off by one
		// would leave entries behind that the caller was told were gone.
		t.Parallel()
		c, mr := newTestRedisCache(t)

		const count = invalidationPageSize*2 + 1
		items := make([]enginecache.Item, 0, count)
		for i := range count {
			items = append(items, item(fmt.Sprintf("v1:%d", i), "subgraph:accounts"))
		}
		require.NoError(t, c.SetMany(t.Context(), items))

		removed, err := c.InvalidateByTags(t.Context(), []string{"subgraph:accounts"})
		require.NoError(t, err)
		require.Equal(t, count, removed)

		for i := range count {
			require.False(t, mr.Exists(entryKey(fmt.Sprintf("v1:%d", i))))
		}
		require.False(t, mr.Exists(tagIndexKey("subgraph:accounts")))
	})

	t.Run("a tag naming exactly one page is not walked twice", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		items := make([]enginecache.Item, 0, invalidationPageSize)
		for i := range invalidationPageSize {
			items = append(items, item(fmt.Sprintf("v1:%d", i), "subgraph:accounts"))
		}
		require.NoError(t, c.SetMany(t.Context(), items))

		removed, err := c.InvalidateByTags(t.Context(), []string{"subgraph:accounts"})
		require.NoError(t, err)
		require.Equal(t, invalidationPageSize, removed)
		require.False(t, mr.Exists(tagIndexKey("subgraph:accounts")))
	})

	t.Run("an entry written during invalidation is left for the next one", func(t *testing.T) {
		// The index is read, then its entries removed, and a write can land in
		// between. Taking the index whole would drop that write's member while
		// its entry survives, unreachable by any later invalidation.
		t.Parallel()
		interposer := &afterCommand{name: "zrevrange"}
		c, mr := newTestRedisCacheWithHook(t, interposer)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item("v1:a", "subgraph:accounts")}))

		interposer.fn = func() {
			advance(c, time.Second)
			require.NoError(t, c.SetMany(context.Background(), []enginecache.Item{item("v1:b", "subgraph:accounts")}))
		}

		removed, err := c.InvalidateByTags(t.Context(), []string{"subgraph:accounts"})
		require.NoError(t, err)
		require.Equal(t, 1, removed)
		require.False(t, mr.Exists(entryKey("v1:a")))
		require.True(t, mr.Exists(entryKey("v1:b")))

		members, err := mr.ZMembers(tagIndexKey("subgraph:accounts"))
		require.NoError(t, err)
		require.Equal(t, []string{"v1:b"}, members, "still indexed, so the next call takes it")

		interposer.fn = nil
		removed, err = c.InvalidateByTags(t.Context(), []string{"subgraph:accounts"})
		require.NoError(t, err)
		require.Equal(t, 1, removed)
		require.False(t, mr.Exists(entryKey("v1:b")))
		require.False(t, mr.Exists(tagIndexKey("subgraph:accounts")))
	})

	t.Run("no tags removes nothing", func(t *testing.T) {
		t.Parallel()
		c, mr := newTestRedisCache(t)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{item("v1:a", "declared:accounts:users")}))

		removed, err := c.InvalidateByTags(t.Context(), nil)
		require.NoError(t, err)
		require.Zero(t, removed)
		require.True(t, mr.Exists(entryKey("v1:a")))
	})

	t.Run("entries are named one key at a time so a cluster never sees CROSSSLOT", func(t *testing.T) {
		// GetMany pipelines single key GETs for the same reason. A multi key
		// UNLINK would pass here, against one server, and fail in production as
		// soon as two of a tag's entries hashed to different slots.
		t.Parallel()
		recorder := &recordCommands{}
		c, _ := newTestRedisCacheWithHook(t, recorder)

		require.NoError(t, c.SetMany(t.Context(), []enginecache.Item{
			item("v1:a", "subgraph:accounts"),
			item("v1:b", "subgraph:accounts"),
		}))

		recorder.reset()
		_, err := c.InvalidateByTags(t.Context(), []string{"subgraph:accounts"})
		require.NoError(t, err)

		var unlinks int
		for _, cmd := range recorder.commands() {
			require.NotEqual(t, "del", cmd.name, "DEL leaves reclaiming on the main thread")
			if cmd.name == "unlink" {
				unlinks++
				require.Equal(t, 1, cmd.keys, "one key per UNLINK, or a cluster answers CROSSSLOT")
			}
		}
		require.Equal(t, 2, unlinks, "one per entry; the index empties itself")
	})
}

// recordCommands notes what actually reached redis, for the cases where the
// shape of the traffic is the thing under test rather than its result.
type recordCommands struct {
	mu   sync.Mutex
	seen []recordedCommand
}

type recordedCommand struct {
	name string
	// keys is how many arguments the command named, which for UNLINK is every
	// argument after the command itself.
	keys int
}

func (r *recordCommands) reset() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.seen = nil
}

func (r *recordCommands) commands() []recordedCommand {
	r.mu.Lock()
	defer r.mu.Unlock()
	return slices.Clone(r.seen)
}

func (r *recordCommands) note(cmds ...redis.Cmder) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, cmd := range cmds {
		r.seen = append(r.seen, recordedCommand{name: cmd.Name(), keys: len(cmd.Args()) - 1})
	}
}

func (r *recordCommands) DialHook(next redis.DialHook) redis.DialHook { return next }

func (r *recordCommands) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		r.note(cmd)
		return next(ctx, cmd)
	}
}

func (r *recordCommands) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error {
		r.note(cmds...)
		return next(ctx, cmds)
	}
}

// afterCommand runs fn once the named command has been answered, for the
// cases that need a write to land in the middle of a multi step call. It
// does not fire for the commands fn itself sends.
type afterCommand struct {
	name string
	fn   func()
	mu   sync.Mutex
	busy bool
}

func (a *afterCommand) DialHook(next redis.DialHook) redis.DialHook { return next }

func (a *afterCommand) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		err := next(ctx, cmd)
		if cmd.Name() != a.name {
			return err
		}
		a.mu.Lock()
		fn, busy := a.fn, a.busy
		a.busy = true
		a.mu.Unlock()
		if fn != nil && !busy {
			fn()
		}
		a.mu.Lock()
		a.busy = false
		a.mu.Unlock()
		return err
	}
}

func (a *afterCommand) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return next
}
