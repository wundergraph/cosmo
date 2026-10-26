package core

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestDescribeCacheTagHeader(t *testing.T) {
	t.Parallel()

	cfg := config.ResponseCacheTagHeaderConfig{Name: "Cache-Tag", Delimiter: " ", MaxBytes: 16384, Tiers: []string{"subgraph", "type", "cache_tag"}}
	header := newCacheTagHeader(cfg, nil)

	t.Run("a key that can never be sent is rejected, not dropped", func(t *testing.T) {
		t.Parallel()
		trace := describeCacheTagHeader(tieredKeys("subgraph-mood", "my tag"), &header, true)
		require.Equal(t, "subgraph-mood", trace.Value)
		require.Equal(t, []string{"my tag"}, trace.Rejected)
		require.Empty(t, trace.Dropped)
		require.Equal(t, "complete", trace.Outcome)
		require.Equal(t, len("subgraph-mood"), trace.UntruncatedSize)
	})

	t.Run("a key over max_bytes is dropped", func(t *testing.T) {
		t.Parallel()
		small := cfg
		small.MaxBytes = len("subgraph-mood")
		h := newCacheTagHeader(small, nil)
		trace := describeCacheTagHeader(tieredKeys("subgraph-mood", "subgraph-employees"), &h, true)
		require.Equal(t, "truncated", trace.Outcome)
		require.Len(t, trace.Dropped, 1)
		require.Empty(t, trace.Rejected)
	})

	t.Run("only rejected keys is empty", func(t *testing.T) {
		t.Parallel()
		trace := describeCacheTagHeader(tieredKeys("my tag"), &header, true)
		require.Equal(t, "empty", trace.Outcome)
		require.False(t, trace.Emitted)
	})

	t.Run("a writer that never sets the header is not emitted", func(t *testing.T) {
		t.Parallel()
		require.False(t, describeCacheTagHeader(tieredKeys("subgraph-mood"), &header, false).Emitted)
	})

	t.Run("keys of other tiers are excluded", func(t *testing.T) {
		t.Parallel()
		declaredOnly := cfg
		declaredOnly.Tiers = []string{"cache_tag"}
		h := newCacheTagHeader(declaredOnly, nil)
		trace := describeCacheTagHeader(tieredKeys("subgraph-mood", "type-mood-Employee", "employee-1"), &h, true)
		require.Equal(t, "employee-1", trace.Value)
		require.Equal(t, []string{"subgraph-mood", "type-mood-Employee"}, trace.Excluded)
		require.Equal(t, []string{"cache_tag"}, trace.Tiers)
		require.Equal(t, "complete", trace.Outcome)

		trace = describeCacheTagHeader(tieredKeys("subgraph-mood"), &h, true)
		require.Equal(t, "empty", trace.Outcome)
		require.False(t, trace.Emitted)
	})

	t.Run("an overflow under on_overflow private sends nothing", func(t *testing.T) {
		t.Parallel()
		private := cfg
		private.MaxBytes = len("subgraph-mood")
		private.OnOverflow = config.ResponseCacheTagHeaderOverflowPrivate
		h := newCacheTagHeader(private, nil)
		trace := describeCacheTagHeader(tieredKeys("subgraph-mood", "subgraph-employees"), &h, true)
		require.Equal(t, "private", trace.Outcome)
		require.Empty(t, trace.Value)
		require.False(t, trace.Emitted)
		require.Equal(t, []string{"subgraph-mood", "subgraph-employees"}, trace.Dropped)
	})
}

func TestInvalidationEndpointURL(t *testing.T) {
	t.Parallel()

	for listenAddr, want := range map[string]string{
		"localhost:5027": "http://localhost:5027/invalidation",
		":5027":          "http://localhost:5027/invalidation",
		"0.0.0.0:5027":   "http://localhost:5027/invalidation",
		"[::]:5027":      "http://localhost:5027/invalidation",
		"10.0.0.7:5027":  "http://10.0.0.7:5027/invalidation",
		"localhost":      "",
	} {
		require.Equal(t, want, invalidationEndpointURL(listenAddr, "/invalidation"), listenAddr)
	}
}
