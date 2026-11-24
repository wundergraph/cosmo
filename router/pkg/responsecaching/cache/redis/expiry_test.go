package redis

import (
	"encoding/binary"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	enginecache "github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

// TestRedisCacheEntryExpiry covers the expiry an entry carries in its header,
// which lets a lookup do without a PTTL per key.
func TestRedisCacheEntryExpiry(t *testing.T) {
	t.Parallel()

	ctx := t.Context()

	// commandNames is what the recorder saw, by name.
	commandNames := func(r *recordCommands) []string {
		var names []string
		for _, cmd := range r.commands() {
			names = append(names, cmd.name)
		}
		return names
	}

	// storedExpiry is the expiry the header of key's entry carries.
	storedExpiry := func(t *testing.T, stored string) time.Time {
		t.Helper()
		require.GreaterOrEqual(t, len(stored), headerLen)
		require.Equal(t, headerMarker, stored[0])
		return time.UnixMilli(int64(binary.BigEndian.Uint64([]byte(stored[identityLen:headerLen]))))
	}

	t.Run("a single node is read with one MGET and no PTTL", func(t *testing.T) {
		t.Parallel()

		recorder := &recordCommands{}
		c, _ := newTestRedisCacheWithHook(t, recorder)
		require.NoError(t, c.SetMany(ctx, []enginecache.Item{
			{Key: "a", Value: []byte("1"), TTL: time.Minute},
			{Key: "b", Value: []byte("2"), TTL: time.Hour},
		}))
		recorder.reset()

		results, err := c.GetMany(ctx, []string{"a", "b", "missing"})
		require.NoError(t, err)
		require.Equal(t, map[string]enginecache.Item{
			"a": {Key: "a", Value: []byte("1"), TTL: time.Minute},
			"b": {Key: "b", Value: []byte("2"), TTL: time.Hour},
		}, results)
		require.Equal(t, []string{"mget"}, commandNames(recorder))
	})

	t.Run("a cluster is read with a GET per key and no PTTL", func(t *testing.T) {
		t.Parallel()

		recorder := &recordCommands{}
		c, mr := newTestPipelinedRedisCache(t, recorder)
		require.NoError(t, c.SetMany(ctx, []enginecache.Item{
			{Key: "a", Value: []byte("1"), TTL: time.Minute},
		}))
		fastForward(mr, 20*time.Second)
		recorder.reset()

		results, err := c.GetMany(ctx, []string{"a", "missing"})
		require.NoError(t, err)
		require.Equal(t, map[string]enginecache.Item{
			"a": {Key: "a", Value: []byte("1"), TTL: 40 * time.Second},
		}, results)
		require.Equal(t, []string{"get", "get"}, commandNames(recorder))
	})

	t.Run("a tagged entry carries the expiry it was extended to, not its lease", func(t *testing.T) {
		t.Parallel()

		c, mr := newTestRedisCache(t)
		item := enginecache.Item{Key: "v1:a", Value: []byte(`{}`), TTL: time.Hour, Tags: []string{"subgraph:accounts"}}
		require.Greater(t, item.TTL, writeLease)
		require.NoError(t, c.SetMany(ctx, []enginecache.Item{item}))

		// Extended by the tag node's clock, so the header and redis agree on
		// the same instant.
		stored, err := mr.Get(entryKey(item.Key))
		require.NoError(t, err)
		expiresAt := storedExpiry(t, stored)
		require.InDelta(t, time.Until(expiresAt), mr.TTL(entryKey(item.Key)), float64(time.Second))

		results, err := c.GetMany(ctx, []string{item.Key})
		require.NoError(t, err)
		require.Contains(t, results, item.Key)
		require.InDelta(t, item.TTL, results[item.Key].TTL, float64(time.Second))
		require.Greater(t, results[item.Key].TTL, writeLease)
	})

	t.Run("a tagged entry left on its lease reports the lease", func(t *testing.T) {
		t.Parallel()

		c, _ := newTestRedisCacheWithHook(t, &failCommands{pipelines: []int{1, 2}})
		item := enginecache.Item{Key: "v1:a", Value: []byte(`{}`), TTL: time.Hour, Tags: []string{"subgraph:accounts"}}
		_ = c.SetMany(ctx, []enginecache.Item{item})

		// Never confirmed, so never extended: what it carries is the lease.
		results, err := c.GetMany(ctx, []string{item.Key})
		require.NoError(t, err)
		require.Contains(t, results, item.Key)
		require.Equal(t, writeLease, results[item.Key].TTL)
	})

	t.Run("an extension failing midway leaves the header short of the key", func(t *testing.T) {
		t.Parallel()

		c, mr := newTestRedisCache(t)
		item := enginecache.Item{Key: "a", Value: []byte("1"), TTL: time.Minute}
		require.NoError(t, c.SetMany(ctx, []enginecache.Item{item}))
		before, err := mr.Get(entryKey(item.Key))
		require.NoError(t, err)

		// PEXPIREAT rejects an expiry that isn't a number, after the identity
		// check passed: the header must not carry the expiry it never got.
		far := time.Now().Add(24 * time.Hour).UnixMilli()
		err = c.client.Eval(ctx, extendOwn, []string{entryKey(item.Key)}, before[:identityLen], "never", encodeExpiry(far)).Err()
		require.Error(t, err)

		after, err := mr.Get(entryKey(item.Key))
		require.NoError(t, err)
		require.Equal(t, before, after)

		results, err := c.GetMany(ctx, []string{item.Key})
		require.NoError(t, err)
		require.LessOrEqual(t, results[item.Key].TTL, mr.TTL(entryKey(item.Key)))
		require.LessOrEqual(t, results[item.Key].ClientTTL, mr.TTL(entryKey(item.Key)))
	})

	t.Run("an extension to the past deletes the entry and leaves nothing behind", func(t *testing.T) {
		t.Parallel()

		c, mr := newTestRedisCache(t)
		item := enginecache.Item{Key: "a", Value: []byte("1"), TTL: time.Minute}
		require.NoError(t, c.SetMany(ctx, []enginecache.Item{item}))
		stored, err := mr.Get(entryKey(item.Key))
		require.NoError(t, err)

		past := time.Now().Add(-time.Second).UnixMilli()
		require.NoError(t, c.client.Eval(ctx, extendOwn, []string{entryKey(item.Key)}, stored[:identityLen], past, encodeExpiry(past)).Err())
		require.False(t, mr.Exists(entryKey(item.Key)))
	})

	t.Run("a legacy entry is read with a PTTL for it alone", func(t *testing.T) {
		t.Parallel()

		recorder := &recordCommands{}
		c, mr := newTestRedisCacheWithHook(t, recorder)
		require.NoError(t, c.SetMany(ctx, []enginecache.Item{
			{Key: "new", Value: []byte("1"), TTL: time.Hour},
		}))

		// Headed as before entries carried their expiry: marker, then token.
		legacy := string(legacyHeaderMarker) + "0123456789abcdef" + rawEntry("2")
		require.NoError(t, mr.Set(entryKey("legacy"), legacy))
		mr.SetTTL(entryKey("legacy"), time.Minute)
		// Written before any header.
		require.NoError(t, mr.Set(entryKey("bare"), rawEntry("3")))
		mr.SetTTL(entryKey("bare"), 2*time.Minute)
		recorder.reset()

		results, err := c.GetMany(ctx, []string{"new", "legacy", "bare"})
		require.NoError(t, err)
		require.Equal(t, map[string]enginecache.Item{
			"new": {Key: "new", Value: []byte("1"), TTL: time.Hour},
			// Seeded with no client lifetime of their own, so the client's is the whole TTL.
			"legacy": {Key: "legacy", Value: []byte("2"), TTL: time.Minute, ClientTTL: time.Minute},
			"bare":   {Key: "bare", Value: []byte("3"), TTL: 2 * time.Minute, ClientTTL: 2 * time.Minute},
		}, results)
		require.Equal(t, []string{"mget", "pttl", "pttl"}, commandNames(recorder))
	})
}
