package core

import (
	"context"
	"maps"
	"net/http"
	"strings"

	cachedirective "github.com/pquerna/cachecontrol/cacheobject"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

// parseRequestCacheControl reads the Cache-Control the client sent.
// It is nil when the header is absent or does not parse.
func parseRequestCacheControl(header http.Header) *cachedirective.RequestCacheDirectives {
	value := strings.TrimSpace(strings.Join(header.Values("Cache-Control"), ","))
	if value == "" {
		return nil
	}
	directives, err := cachedirective.ParseRequestCacheControl(value)
	if err != nil {
		return nil
	}
	return directives
}

// selectCacheStore selects the response cache a request may use, from the Cache-Control directives.
func selectCacheStore(store caching.Cache, directives *cachedirective.RequestCacheDirectives) caching.Cache {
	if store == nil || directives == nil {
		return store
	}
	switch {
	case directives.NoCache && directives.NoStore:
		return nil
	case directives.NoCache:
		return notCached{store}
	case directives.NoStore:
		return notStored{store}
	}
	return store
}

// notCached is a store every lookup for a body misses on. Writes pass through.
type notCached struct {
	store caching.Cache
}

// GetMany returns vary records only.
// This done to keep variants in the cache when they get stored later via SetMany,
// otherwise "no-cache" would wipe variants from cache.
func (w notCached) GetMany(ctx context.Context, keys []string) (map[string]caching.Item, error) {
	found, err := w.store.GetMany(ctx, keys)
	if err != nil {
		return nil, err
	}
	maps.DeleteFunc(found, func(_ string, item caching.Item) bool {
		return len(item.Vary) == 0
	})
	// An item with Vary does not have "body" and thus it is safe to return it here.
	return found, nil
}

func (w notCached) SetMany(ctx context.Context, items []caching.Item) error {
	return w.store.SetMany(ctx, items)
}

// notStored is a store that drops every write. Lookups pass through.
type notStored struct {
	store caching.Cache
}

func (r notStored) GetMany(ctx context.Context, keys []string) (map[string]caching.Item, error) {
	return r.store.GetMany(ctx, keys)
}

func (notStored) SetMany(context.Context, []caching.Item) error {
	return nil
}

var (
	_ caching.Cache = notCached{}
	_ caching.Cache = notStored{}
)
