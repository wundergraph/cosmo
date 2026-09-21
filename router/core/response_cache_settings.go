package core

import (
	"fmt"
	"maps"
	"slices"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// validateResponseCacheSubgraphs refuses what the schema cannot see: env
// overrides and configs assembled in go never pass through it. The graph
// server compiles every private_id again with its own manager; this compile
// only refuses a bad expression before any store is built.
func validateResponseCacheSubgraphs(cfg *config.ResponseCacheConfiguration, log *zap.Logger) error {
	mgr := expr.CreateNewExprManager()
	if cfg.All.Enabled {
		if cfg.All.FallbackTTL <= 0 {
			return fmt.Errorf("response cache is enabled but all.fallback_ttl is %s, which must be greater than zero", cfg.All.FallbackTTL)
		}
		if _, err := newResponseCachePrivateID(cfg.All.PrivateID, mgr); err != nil {
			return err
		}
	}
	enabled := cfg.All.Enabled
	for _, name := range slices.Sorted(maps.Keys(cfg.Subgraphs)) {
		o := cfg.Subgraphs[name]
		if !o.Enabled {
			continue
		}
		enabled = true
		if o.FallbackTTL <= 0 {
			return fmt.Errorf("response_cache.subgraphs.%s.fallback_ttl is %s, which must be greater than zero", name, o.FallbackTTL)
		}
		if _, err := newResponseCachePrivateID(o.PrivateID, mgr); err != nil {
			return fmt.Errorf("response_cache.subgraphs.%s: %w", name, err)
		}
	}
	if !enabled && log != nil {
		log.Warn("Response cache is enabled but all.enabled is false and no subgraph entry enables it, so nothing is cached")
	}
	return nil
}

// responseCacheSettings is the per-subgraph configuration compiled once per
// graph, and turned into the engine's options once per request.
type responseCacheSettings struct {
	defaultDisabled bool
	fallbackTTL     time.Duration
	// all is nil when all has no private_id.
	all     *responseCachePrivateID
	entries map[string]responseCacheSubgraphEntry
	// static is handed to every request when no entry has a private_id, so a
	// request only allocates when it must.
	static map[string]resolve.ResponseCacheSubgraphOptions
}

type responseCacheSubgraphEntry struct {
	disabled  bool
	ttl       time.Duration
	privateID *responseCachePrivateID
}

// newResponseCacheSettings compiles every private_id once per distinct
// expression. An entry naming a subgraph the graph does not have is kept and
// logged: feature flag graphs have subgraph sets of their own.
func newResponseCacheSettings(cfg *config.ResponseCacheConfiguration, mgr *expr.Manager, known []*nodev1.Subgraph, log *zap.Logger) (*responseCacheSettings, error) {
	s := &responseCacheSettings{
		defaultDisabled: !cfg.All.Enabled,
		fallbackTTL:     cfg.All.FallbackTTL,
	}
	programs := make(map[string]*responseCachePrivateID)
	compile := func(expression string) (*responseCachePrivateID, error) {
		if p, ok := programs[expression]; ok {
			return p, nil
		}
		p, err := newResponseCachePrivateID(expression, mgr)
		if err != nil {
			return nil, err
		}
		programs[expression] = p
		return p, nil
	}

	var err error
	if cfg.All.Enabled {
		if s.all, err = compile(cfg.All.PrivateID); err != nil {
			return nil, err
		}
	}
	if len(cfg.Subgraphs) == 0 {
		return s, nil
	}

	names := make(map[string]struct{}, len(known))
	for _, sg := range known {
		names[sg.GetName()] = struct{}{}
	}

	s.entries = make(map[string]responseCacheSubgraphEntry, len(cfg.Subgraphs))
	dynamic := false
	for _, name := range slices.Sorted(maps.Keys(cfg.Subgraphs)) {
		if _, ok := names[name]; !ok && log != nil {
			log.Warn("response_cache.subgraphs names a subgraph this graph does not have", zap.String("subgraph", name))
		}
		o := cfg.Subgraphs[name]
		entry := responseCacheSubgraphEntry{disabled: !o.Enabled, ttl: o.FallbackTTL}
		if o.Enabled && o.PrivateID != "" {
			if entry.privateID, err = compile(o.PrivateID); err != nil {
				return nil, fmt.Errorf("response_cache.subgraphs.%s: %w", name, err)
			}
			dynamic = true
		}
		s.entries[name] = entry
	}
	if !dynamic {
		s.static = s.subgraphs(expr.Context{}, nil)
	}
	return s, nil
}

// options is what the engine takes for one request. Store, OnError and
// Invalidation are the caller's to fill in.
func (s *responseCacheSettings) options(ctx expr.Context, onError func(error)) resolve.ResponseCacheOptions {
	opts := resolve.ResponseCacheOptions{
		DefaultTTL:      s.fallbackTTL,
		DefaultDisabled: s.defaultDisabled,
		PrivateID:       s.all.resolve(ctx, onError),
	}
	if s.static != nil {
		opts.Subgraphs = s.static
	} else if len(s.entries) > 0 {
		opts.Subgraphs = s.subgraphs(ctx, onError)
	}
	return opts
}

func (s *responseCacheSettings) subgraphs(ctx expr.Context, onError func(error)) map[string]resolve.ResponseCacheSubgraphOptions {
	out := make(map[string]resolve.ResponseCacheSubgraphOptions, len(s.entries))
	// One evaluation per program, however many entries share it.
	resolved := make(map[*responseCachePrivateID]string)
	for name, entry := range s.entries {
		o := resolve.ResponseCacheSubgraphOptions{Disabled: entry.disabled, DefaultTTL: entry.ttl}
		if entry.privateID != nil {
			id, ok := resolved[entry.privateID]
			if !ok {
				id = entry.privateID.resolve(ctx, onError)
				resolved[entry.privateID] = id
			}
			o.PrivateID = id
		}
		out[name] = o
	}
	return out
}
