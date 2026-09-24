package core

import (
	"context"
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
		return writeOnlyCache{store}
	case directives.NoStore:
		return readOnlyCache{store}
	}
	return store
}

// writeOnlyCache is a store every lookup misses on. Writes pass through.
type writeOnlyCache struct {
	store caching.Cache
}

func (writeOnlyCache) GetMany(context.Context, []string) (map[string]caching.Item, error) {
	return nil, nil
}

func (w writeOnlyCache) SetMany(ctx context.Context, items []caching.Item) error {
	return w.store.SetMany(ctx, items)
}

var _ caching.Cache = writeOnlyCache{}

// readOnlyCache is a store that drops every write. Lookups pass through.
type readOnlyCache struct {
	store caching.Cache
}

func (r readOnlyCache) GetMany(ctx context.Context, keys []string) (map[string]caching.Item, error) {
	return r.store.GetMany(ctx, keys)
}

func (readOnlyCache) SetMany(context.Context, []caching.Item) error {
	return nil
}

var _ caching.Cache = readOnlyCache{}
