package core

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestDescribeCacheTagHeader(t *testing.T) {
	t.Parallel()

	cfg := config.ResponseCacheTagHeaderConfig{Name: "Cache-Tag", Delimiter: " ", MaxBytes: 16384}

	t.Run("a key that can never be sent is rejected, not dropped", func(t *testing.T) {
		t.Parallel()
		trace := describeCacheTagHeader([]string{"subgraph-mood", "my tag"}, cfg, true)
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
		trace := describeCacheTagHeader([]string{"subgraph-mood", "subgraph-employees"}, small, true)
		require.Equal(t, "truncated", trace.Outcome)
		require.Len(t, trace.Dropped, 1)
		require.Empty(t, trace.Rejected)
	})

	t.Run("only rejected keys is empty", func(t *testing.T) {
		t.Parallel()
		trace := describeCacheTagHeader([]string{"my tag"}, cfg, true)
		require.Equal(t, "empty", trace.Outcome)
		require.False(t, trace.Emitted)
	})

	t.Run("a writer that never sets the header is not emitted", func(t *testing.T) {
		t.Parallel()
		require.False(t, describeCacheTagHeader([]string{"subgraph-mood"}, cfg, false).Emitted)
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
