package core

import (
	"net/http"
	"reflect"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestResponseCacheSettings(t *testing.T) {
	t.Parallel()

	known := []*nodev1.Subgraph{{Name: "employees"}, {Name: "mood"}}
	headerCtx := expr.Context{Request: expr.Request{
		Header: expr.Headers{Header: http.Header{"X-User-Id": []string{"h1"}}},
		Auth:   expr.RequestAuth{Claims: map[string]any{"sub": "u1"}},
	}}
	failing := func(t *testing.T) func(error) {
		return func(err error) { t.Errorf("unexpected error: %v", err) }
	}
	build := func(t *testing.T, cfg *config.ResponseCacheConfiguration) *responseCacheSettings {
		t.Helper()
		s, err := newResponseCacheSettings(cfg, expr.CreateNewExprManager(), known, zap.NewNop())
		require.NoError(t, err)
		return s
	}

	t.Run("all alone is the default", func(t *testing.T) {
		t.Parallel()
		s := build(t, &config.ResponseCacheConfiguration{
			All: config.ResponseCacheSubgraphConfiguration{Enabled: true, FallbackTTL: time.Minute, PrivateID: "request.auth.claims.sub"},
		})
		opts := s.options(headerCtx, failing(t))
		require.Equal(t, time.Minute, opts.DefaultTTL)
		require.Equal(t, "u1", opts.PrivateID)
		require.False(t, opts.DefaultDisabled)
		require.Nil(t, opts.Subgraphs)
	})

	t.Run("a disabled all disables the default and skips its private_id", func(t *testing.T) {
		t.Parallel()
		s := build(t, &config.ResponseCacheConfiguration{
			All: config.ResponseCacheSubgraphConfiguration{Enabled: false, PrivateID: "request.nope"},
		})
		opts := s.options(headerCtx, failing(t))
		require.True(t, opts.DefaultDisabled)
		require.Empty(t, opts.PrivateID)
	})

	t.Run("entries without a private_id are built once and shared", func(t *testing.T) {
		t.Parallel()
		s := build(t, &config.ResponseCacheConfiguration{
			All: config.ResponseCacheSubgraphConfiguration{Enabled: true, FallbackTTL: time.Minute},
			Subgraphs: map[string]config.ResponseCacheSubgraphConfiguration{
				"mood":      {Enabled: true, FallbackTTL: time.Hour},
				"employees": {Enabled: false},
			},
		})
		first := s.options(headerCtx, failing(t)).Subgraphs
		second := s.options(headerCtx, failing(t)).Subgraphs
		require.Equal(t, reflect.ValueOf(first).Pointer(), reflect.ValueOf(second).Pointer(), "the same map every request")
		require.Equal(t, time.Hour, first["mood"].DefaultTTL)
		require.False(t, first["mood"].Disabled)
		require.True(t, first["employees"].Disabled)
	})

	t.Run("an entry's private_id is resolved per request and replaces all's", func(t *testing.T) {
		t.Parallel()
		s := build(t, &config.ResponseCacheConfiguration{
			All: config.ResponseCacheSubgraphConfiguration{Enabled: true, FallbackTTL: time.Minute, PrivateID: "request.auth.claims.sub"},
			Subgraphs: map[string]config.ResponseCacheSubgraphConfiguration{
				"mood":      {Enabled: true, FallbackTTL: time.Minute, PrivateID: "request.header.Get('X-User-Id')"},
				"employees": {Enabled: true, FallbackTTL: time.Minute},
			},
		})
		opts := s.options(headerCtx, failing(t))
		require.Equal(t, "u1", opts.PrivateID)
		require.Equal(t, "h1", opts.Subgraphs["mood"].PrivateID)
		require.Empty(t, opts.Subgraphs["employees"].PrivateID, "not all's id")

		again := s.options(headerCtx, failing(t))
		require.NotEqual(t, reflect.ValueOf(opts.Subgraphs).Pointer(), reflect.ValueOf(again.Subgraphs).Pointer(), "built per request")
		require.Empty(t, s.options(expr.Context{}, failing(t)).Subgraphs["mood"].PrivateID, "an absent header is no id")
	})

	t.Run("one expression compiles once however many entries share it", func(t *testing.T) {
		t.Parallel()
		s := build(t, &config.ResponseCacheConfiguration{
			All: config.ResponseCacheSubgraphConfiguration{Enabled: true, FallbackTTL: time.Minute, PrivateID: "request.auth.claims.sub"},
			Subgraphs: map[string]config.ResponseCacheSubgraphConfiguration{
				"mood":      {Enabled: true, FallbackTTL: time.Minute, PrivateID: "request.auth.claims.sub"},
				"employees": {Enabled: true, FallbackTTL: time.Minute, PrivateID: "request.auth.claims.sub"},
			},
		})
		require.Same(t, s.all, s.entries["mood"].privateID)
		require.Same(t, s.entries["mood"].privateID, s.entries["employees"].privateID)
	})

	t.Run("a disabled entry's private_id is not compiled", func(t *testing.T) {
		t.Parallel()
		build(t, &config.ResponseCacheConfiguration{
			All:       config.ResponseCacheSubgraphConfiguration{Enabled: true, FallbackTTL: time.Minute},
			Subgraphs: map[string]config.ResponseCacheSubgraphConfiguration{"mood": {Enabled: false, PrivateID: "request.nope"}},
		})
	})

	t.Run("a bad entry private_id is refused by name", func(t *testing.T) {
		t.Parallel()
		_, err := newResponseCacheSettings(&config.ResponseCacheConfiguration{
			All:       config.ResponseCacheSubgraphConfiguration{Enabled: true, FallbackTTL: time.Minute},
			Subgraphs: map[string]config.ResponseCacheSubgraphConfiguration{"mood": {Enabled: true, FallbackTTL: time.Minute, PrivateID: "request.nope"}},
		}, expr.CreateNewExprManager(), known, zap.NewNop())
		require.ErrorContains(t, err, "response_cache.subgraphs.mood: response cache private_id")
	})

	t.Run("a name the graph does not have is kept and logged", func(t *testing.T) {
		t.Parallel()
		core, logs := observer.New(zap.WarnLevel)
		s, err := newResponseCacheSettings(&config.ResponseCacheConfiguration{
			All:       config.ResponseCacheSubgraphConfiguration{Enabled: true, FallbackTTL: time.Minute},
			Subgraphs: map[string]config.ResponseCacheSubgraphConfiguration{"nope": {Enabled: false}, "mood": {Enabled: false}},
		}, expr.CreateNewExprManager(), known, zap.New(core))
		require.NoError(t, err)
		require.True(t, s.options(expr.Context{}, failing(t)).Subgraphs["nope"].Disabled)

		require.Equal(t, 1, logs.Len())
		require.Equal(t, "nope", logs.All()[0].ContextMap()["subgraph"])
	})
}
