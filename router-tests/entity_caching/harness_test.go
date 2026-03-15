package entity_caching

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/handler/transport"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/details"
	"github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/inventory"
	"github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/items"
	itemsModel "github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/items/subgraph/model"
	"github.com/wundergraph/cosmo/router/core"
	entityanalyticsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/entityanalytics/v1"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/entitycache"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"google.golang.org/protobuf/proto"
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
			if cp.OperationType != "Subscription" {
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

// setQueryCacheIncludeHeaders sets IncludeHeaders on all root field cache configs.
func setQueryCacheIncludeHeaders(rc *nodev1.RouterConfig, enabled bool) {
	for _, ds := range rc.EngineConfig.DatasourceConfigurations {
		for _, rfc := range ds.RootFieldCacheConfigurations {
			rfc.IncludeHeaders = enabled
		}
	}
}

// setCachePopulateTTL overrides MaxAgeSeconds on all cache populate configs.
func setCachePopulateTTL(rc *nodev1.RouterConfig, ttl int64) {
	for _, ds := range rc.EngineConfig.DatasourceConfigurations {
		for _, cp := range ds.CachePopulateConfigurations {
			cp.MaxAgeSeconds = &ttl
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

// ControllableCache wraps a MemoryEntityCache but can be toggled to fail on demand.
// Use SetFailing(true) to simulate a Redis outage mid-test.
type ControllableCache struct {
	inner   *entitycache.MemoryEntityCache
	failing atomic.Bool
}

func newControllableCache(t *testing.T) *ControllableCache {
	t.Helper()
	cache, err := entitycache.NewMemoryEntityCache(10 * 1024 * 1024)
	require.NoError(t, err)
	t.Cleanup(func() { _ = cache.Close() })
	return &ControllableCache{inner: cache}
}

func (c *ControllableCache) SetFailing(v bool) { c.failing.Store(v) }

func (c *ControllableCache) Get(ctx context.Context, keys []string) ([]*resolve.CacheEntry, error) {
	if c.failing.Load() {
		return nil, errCacheFailed
	}
	return c.inner.Get(ctx, keys)
}

func (c *ControllableCache) Set(ctx context.Context, entries []*resolve.CacheEntry, ttl time.Duration) error {
	if c.failing.Load() {
		return errCacheFailed
	}
	return c.inner.Set(ctx, entries, ttl)
}

func (c *ControllableCache) Delete(ctx context.Context, keys []string) error {
	if c.failing.Load() {
		return errCacheFailed
	}
	return c.inner.Delete(ctx, keys)
}

// entityCachingOptionsWithCircuitBreakerRef is like entityCachingOptionsWithCircuitBreaker
// but also returns the CircuitBreakerCache so tests can inspect its state.
func entityCachingOptionsWithCircuitBreakerRef(cache resolve.LoaderCache, threshold int, cooldown time.Duration) ([]core.Option, *entitycache.CircuitBreakerCache) {
	cb := entitycache.NewCircuitBreakerCache(cache, entitycache.CircuitBreakerConfig{
		Enabled:          true,
		FailureThreshold: threshold,
		CooldownPeriod:   cooldown,
	})
	return entityCachingOptions(cb), cb
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
func newMemoryCache(t *testing.T) *entitycache.MemoryEntityCache {
	t.Helper()
	c, err := entitycache.NewMemoryEntityCache(10 * 1024 * 1024) // 10MB for tests
	require.NoError(t, err)
	t.Cleanup(func() { _ = c.Close() })
	return c
}

// entityCachingOptionsWithAnalytics returns router options with entity caching and analytics export enabled.
func entityCachingOptionsWithAnalytics(cache resolve.LoaderCache, collectorURL string) []core.Option {
	return []core.Option{
		core.WithEntityCaching(config.EntityCachingConfiguration{
			Enabled: true,
			L1: config.EntityCachingL1Configuration{
				Enabled: true,
			},
			L2: config.EntityCachingL2Configuration{
				Enabled: true,
			},
			Analytics: config.EntityCachingAnalyticsConfig{
				Enabled:     true,
				DetailLevel: "full",
				Export: config.EntityCachingAnalyticsExportConfig{
					Enabled:   true,
					Endpoint:  collectorURL,
					BatchSize: 10,
					QueueSize: 100,
					Interval:  1 * time.Second,
					Retry: config.EntityCachingAnalyticsRetryConfig{
						Enabled:     true,
						MaxRetries:  1,
						MaxDuration: 5 * time.Second,
						Interval:    1 * time.Second,
					},
				},
			},
		}),
		core.WithEntityCacheInstances(map[string]resolve.LoaderCache{
			"default": cache,
		}),
	}
}

// fakeCollector is a test HTTP server that receives entity analytics via Connect RPC.
type fakeCollector struct {
	server   *httptest.Server
	mu       sync.Mutex
	received []*entityanalyticsv1.PublishEntityAnalyticsRequest
	ready    chan struct{} // closed on first request
	once     sync.Once
}

func newFakeCollector(t *testing.T) *fakeCollector {
	t.Helper()
	fc := &fakeCollector{
		ready: make(chan struct{}),
	}
	fc.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reader, err := gzip.NewReader(r.Body)
		require.NoError(t, err)
		defer reader.Close()

		data, err := io.ReadAll(reader)
		require.NoError(t, err)

		var req entityanalyticsv1.PublishEntityAnalyticsRequest
		err = proto.Unmarshal(data, &req)
		require.NoError(t, err)

		fc.mu.Lock()
		fc.received = append(fc.received, &req)
		fc.mu.Unlock()

		fc.once.Do(func() { close(fc.ready) })

		// Return empty response
		res := &entityanalyticsv1.PublishEntityAnalyticsResponse{}
		out, err := proto.Marshal(res)
		require.NoError(t, err)

		w.Header().Set("Content-Type", "application/proto")
		_, err = w.Write(out)
		require.NoError(t, err)
	}))
	t.Cleanup(fc.server.Close)
	return fc
}

func (fc *fakeCollector) waitForRequest(t *testing.T, timeout time.Duration) {
	t.Helper()
	select {
	case <-fc.ready:
	case <-time.After(timeout):
		t.Fatal("timeout waiting for entity analytics collector to receive data")
	}
}

func (fc *fakeCollector) allAggregations() []*entityanalyticsv1.EntityAnalyticsAggregation {
	fc.mu.Lock()
	defer fc.mu.Unlock()
	var all []*entityanalyticsv1.EntityAnalyticsAggregation
	for _, req := range fc.received {
		all = append(all, req.Aggregations...)
	}
	return all
}

// newTestRedisCache creates a miniredis-backed cache for testing.
func newTestRedisCache(t *testing.T) (*entitycache.RedisEntityCache, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { client.Close() })
	return entitycache.NewRedisEntityCache(client, "test"), mr
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
