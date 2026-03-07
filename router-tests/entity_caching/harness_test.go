package entity_caching

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/handler/transport"

	"github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/details"
	"github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/inventory"
	"github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/items"
	itemsModel "github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/items/subgraph/model"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/entitycache"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type requestCounters struct {
	items     atomic.Int64
	details   atomic.Int64
	inventory atomic.Int64
}

func countingMiddleware(counter *atomic.Int64, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		counter.Add(1)
		next.ServeHTTP(w, r)
	})
}

type subgraphServers struct {
	items     *httptest.Server
	details   *httptest.Server
	inventory *httptest.Server
	// Subscription channels for the items subgraph.
	itemUpdatedCh chan *itemsModel.Item
	itemCreatedCh chan *itemsModel.Item
}

func startSubgraphServers(t *testing.T) (*subgraphServers, *requestCounters) {
	t.Helper()

	counters := &requestCounters{}
	itemUpdatedCh := make(chan *itemsModel.Item, 1)
	itemCreatedCh := make(chan *itemsModel.Item, 1)

	itemsSchema := items.NewSchema(itemUpdatedCh, itemCreatedCh)
	itemsHandler := handler.New(itemsSchema)
	itemsHandler.AddTransport(transport.POST{})
	itemsHandler.AddTransport(transport.Websocket{
		KeepAlivePingInterval: 10 * time.Second,
	})

	detailsSchema := details.NewSchema()
	detailsHandler := handler.New(detailsSchema)
	detailsHandler.AddTransport(transport.POST{})

	inventorySchema := inventory.NewSchema()
	inventoryHandler := handler.New(inventorySchema)
	inventoryHandler.AddTransport(transport.POST{})

	itemsSrv := httptest.NewServer(countingMiddleware(&counters.items, itemsHandler))
	t.Cleanup(itemsSrv.Close)

	detailsSrv := httptest.NewServer(countingMiddleware(&counters.details, detailsHandler))
	t.Cleanup(detailsSrv.Close)

	inventorySrv := httptest.NewServer(countingMiddleware(&counters.inventory, inventoryHandler))
	t.Cleanup(inventorySrv.Close)

	return &subgraphServers{
		items:         itemsSrv,
		details:       detailsSrv,
		inventory:     inventorySrv,
		itemUpdatedCh: itemUpdatedCh,
		itemCreatedCh: itemCreatedCh,
	}, counters
}

func startSubgraphServersWithMiddleware(t *testing.T, mw func(http.Handler) http.Handler) (*subgraphServers, *requestCounters) {
	t.Helper()

	counters := &requestCounters{}
	itemUpdatedCh := make(chan *itemsModel.Item, 1)
	itemCreatedCh := make(chan *itemsModel.Item, 1)

	itemsSchema := items.NewSchema(itemUpdatedCh, itemCreatedCh)
	itemsHandler := handler.New(itemsSchema)
	itemsHandler.AddTransport(transport.POST{})
	itemsHandler.AddTransport(transport.Websocket{
		KeepAlivePingInterval: 10 * time.Second,
	})

	detailsSchema := details.NewSchema()
	detailsHandler := handler.New(detailsSchema)
	detailsHandler.AddTransport(transport.POST{})

	inventorySchema := inventory.NewSchema()
	inventoryHandler := handler.New(inventorySchema)
	inventoryHandler.AddTransport(transport.POST{})

	var detailsWrapped http.Handler = detailsHandler
	if mw != nil {
		detailsWrapped = mw(detailsHandler)
	}

	itemsSrv := httptest.NewServer(countingMiddleware(&counters.items, itemsHandler))
	t.Cleanup(itemsSrv.Close)

	detailsSrv := httptest.NewServer(countingMiddleware(&counters.details, detailsWrapped))
	t.Cleanup(detailsSrv.Close)

	inventorySrv := httptest.NewServer(countingMiddleware(&counters.inventory, inventoryHandler))
	t.Cleanup(inventorySrv.Close)

	return &subgraphServers{
		items:         itemsSrv,
		details:       detailsSrv,
		inventory:     inventorySrv,
		itemUpdatedCh: itemUpdatedCh,
		itemCreatedCh: itemCreatedCh,
	}, counters
}

func buildConfigJSON(servers *subgraphServers) string {
	replaced := configJSONTemplate
	replaced = strings.ReplaceAll(replaced, itemsPlaceholderURL, servers.items.URL)
	replaced = strings.ReplaceAll(replaced, detailsPlaceholderURL, servers.details.URL)
	replaced = strings.ReplaceAll(replaced, inventoryPlaceholderURL, servers.inventory.URL)
	return replaced
}

func entityCachingOptions(cache resolve.LoaderCache) []core.Option {
	return []core.Option{
		core.WithEntityCaching(config.EntityCachingConfiguration{
			Enabled: true,
			L1: config.EntityCachingL1Configuration{
				Enabled: true,
			},
			L2: config.EntityCachingL2Configuration{
				Enabled: true,
			},
		}),
		core.WithEntityCacheInstances(map[string]resolve.LoaderCache{
			"default": cache,
		}),
	}
}

func entityCachingOptionsMulti(caches map[string]resolve.LoaderCache) []core.Option {
	return []core.Option{
		core.WithEntityCaching(config.EntityCachingConfiguration{
			Enabled: true,
			L1: config.EntityCachingL1Configuration{
				Enabled: true,
			},
			L2: config.EntityCachingL2Configuration{
				Enabled: true,
			},
		}),
		core.WithEntityCacheInstances(caches),
	}
}

// clearEntityCacheConfigs removes all entity cache configs from the router config.
func clearEntityCacheConfigs(rc *nodev1.RouterConfig) {
	for _, ds := range rc.EngineConfig.DatasourceConfigurations {
		ds.EntityCacheConfigurations = nil
		ds.RootFieldCacheConfigurations = nil
		ds.CacheInvalidateConfigurations = nil
		ds.CachePopulateConfigurations = nil
	}
}

// setEntityCacheTTL overrides MaxAgeSeconds on all entity cache configs.
func setEntityCacheTTL(rc *nodev1.RouterConfig, ttl int64) {
	for _, ds := range rc.EngineConfig.DatasourceConfigurations {
		for _, ec := range ds.EntityCacheConfigurations {
			ec.MaxAgeSeconds = ttl
		}
	}
}

// setEntityCacheShadowMode sets ShadowMode on all entity cache configs.
func setEntityCacheShadowMode(rc *nodev1.RouterConfig, enabled bool) {
	for _, ds := range rc.EngineConfig.DatasourceConfigurations {
		for _, ec := range ds.EntityCacheConfigurations {
			ec.ShadowMode = enabled
		}
	}
}

// setEntityCachePartialLoad sets PartialCacheLoad on all entity cache configs.
func setEntityCachePartialLoad(rc *nodev1.RouterConfig, enabled bool) {
	for _, ds := range rc.EngineConfig.DatasourceConfigurations {
		for _, ec := range ds.EntityCacheConfigurations {
			ec.PartialCacheLoad = enabled
		}
	}
}

// setEntityCacheIncludeHeaders sets IncludeHeaders on all entity cache configs.
func setEntityCacheIncludeHeaders(rc *nodev1.RouterConfig, enabled bool) {
	for _, ds := range rc.EngineConfig.DatasourceConfigurations {
		for _, ec := range ds.EntityCacheConfigurations {
			ec.IncludeHeaders = enabled
		}
	}
}

// setNegativeCacheTTL sets NegativeCacheTtlSeconds on all entity cache configs.
func setNegativeCacheTTL(rc *nodev1.RouterConfig, ttl int64) {
	for _, ds := range rc.EngineConfig.DatasourceConfigurations {
		for _, ec := range ds.EntityCacheConfigurations {
			ec.NegativeCacheTtlSeconds = ttl
		}
	}
}

// removeSubscriptionPopulateConfigs removes @cachePopulate subscription configs.
// This avoids a FindByTypeName conflict when both @cachePopulate and @cacheInvalidate
// exist for the same entity type on different subscription fields: the planner
// returns the first match by TypeName, which can shadow the invalidation config.
func removeSubscriptionPopulateConfigs(rc *nodev1.RouterConfig) {
	for _, ds := range rc.EngineConfig.DatasourceConfigurations {
		filtered := ds.CachePopulateConfigurations[:0]
		for _, cp := range ds.CachePopulateConfigurations {
			if !strings.EqualFold(cp.OperationType, "subscription") {
				filtered = append(filtered, cp)
			}
		}
		ds.CachePopulateConfigurations = filtered
	}
}

// setQueryCacheShadowMode sets ShadowMode on all root field cache configs.
func setQueryCacheShadowMode(rc *nodev1.RouterConfig, enabled bool) {
	for _, ds := range rc.EngineConfig.DatasourceConfigurations {
		for _, rfc := range ds.RootFieldCacheConfigurations {
			rfc.ShadowMode = enabled
		}
	}
}

// FailingEntityCache implements resolve.LoaderCache and always returns errors.
type FailingEntityCache struct{}

var _ resolve.LoaderCache = (*FailingEntityCache)(nil)

func (f *FailingEntityCache) Get(_ context.Context, keys []string) ([]*resolve.CacheEntry, error) {
	return nil, errCacheFailed
}

func (f *FailingEntityCache) Set(_ context.Context, _ []*resolve.CacheEntry, _ time.Duration) error {
	return errCacheFailed
}

func (f *FailingEntityCache) Delete(_ context.Context, _ []string) error {
	return errCacheFailed
}

var errCacheFailed = &cacheFailed{}

type cacheFailed struct{}

func (c *cacheFailed) Error() string {
	return "entity cache operation failed"
}

// entityCachingOptionsWithSubgraphConfig returns router options with per-subgraph cache routing.
func entityCachingOptionsWithSubgraphConfig(caches map[string]resolve.LoaderCache, subgraphs []config.EntityCachingSubgraphConfig) []core.Option {
	return []core.Option{
		core.WithEntityCaching(config.EntityCachingConfiguration{
			Enabled: true,
			L1: config.EntityCachingL1Configuration{
				Enabled: true,
			},
			L2: config.EntityCachingL2Configuration{
				Enabled: true,
			},
			Subgraphs: subgraphs,
		}),
		core.WithEntityCacheInstances(caches),
	}
}

// newMemoryCache is a convenience wrapper.
func newMemoryCache() *entitycache.MemoryEntityCache {
	return entitycache.NewMemoryEntityCache()
}

// debugCache wraps a LoaderCache to log all operations (for test debugging).
type debugCache struct {
	inner resolve.LoaderCache
	t     testing.TB
}

func newDebugCache(t testing.TB, inner resolve.LoaderCache) *debugCache {
	return &debugCache{inner: inner, t: t}
}

func (d *debugCache) Get(ctx context.Context, keys []string) ([]*resolve.CacheEntry, error) {
	entries, err := d.inner.Get(ctx, keys)
	for i, e := range entries {
		if e != nil {
			d.t.Logf("[cache] GET key=%q → hit (value=%d bytes)", keys[i], len(e.Value))
		} else {
			d.t.Logf("[cache] GET key=%q → miss", keys[i])
		}
	}
	return entries, err
}

func (d *debugCache) Set(ctx context.Context, entries []*resolve.CacheEntry, ttl time.Duration) error {
	for _, e := range entries {
		d.t.Logf("[cache] SET key=%q ttl=%s (value=%d bytes)", e.Key, ttl, len(e.Value))
	}
	return d.inner.Set(ctx, entries, ttl)
}

func (d *debugCache) Delete(ctx context.Context, keys []string) error {
	for _, k := range keys {
		d.t.Logf("[cache] DELETE key=%q", k)
	}
	return d.inner.Delete(ctx, keys)
}

// extensionInvalidationMiddleware returns an HTTP middleware that injects
// a cacheInvalidation extension into the subgraph response when the flag is set.
// Format: {"extensions":{"cacheInvalidation":{"keys":[{"typename":"Item","key":{"id":"1"}}]}}}
func extensionInvalidationMiddleware(flag *atomic.Bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !flag.Load() {
				next.ServeHTTP(w, r)
				return
			}
			// Capture the response.
			rec := httptest.NewRecorder()
			next.ServeHTTP(rec, r)

			body := rec.Body.Bytes()
			var resp map[string]json.RawMessage
			if err := json.Unmarshal(body, &resp); err != nil {
				// Pass through on unmarshal error.
				for k, v := range rec.Header() {
					w.Header()[k] = v
				}
				w.WriteHeader(rec.Code)
				_, _ = w.Write(body)
				return
			}

			// Inject cacheInvalidation extension.
			ext := map[string]any{
				"cacheInvalidation": map[string]any{
					"keys": []map[string]any{
						{"typename": "Item", "key": map[string]any{"id": "1"}},
					},
				},
			}
			extBytes, _ := json.Marshal(ext)
			resp["extensions"] = extBytes
			modified, _ := json.Marshal(resp)

			for k, v := range rec.Header() {
				w.Header()[k] = v
			}
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(modified)))
			w.WriteHeader(rec.Code)
			_, _ = w.Write(modified)
		})
	}
}
