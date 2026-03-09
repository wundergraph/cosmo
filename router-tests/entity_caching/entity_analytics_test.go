package entity_caching

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	entityanalyticsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/entityanalytics/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"google.golang.org/protobuf/proto"
)

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

func TestEntityAnalytics(t *testing.T) {
	t.Parallel()

	t.Run("basic_pipeline", func(t *testing.T) {
		t.Parallel()

		servers, _ := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache()
		collector := newFakeCollector(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptionsWithAnalytics(cache, collector.server.URL),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Make two identical requests
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.JSONEq(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res.Body)

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.JSONEq(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res.Body)
		})

		// After testenv shutdown, exporter flushes remaining items
		collector.waitForRequest(t, 60*time.Second)

		aggs := collector.allAggregations()
		require.NotEmpty(t, aggs, "expected at least one aggregation")

		// Both requests had the same operation, so they should be aggregated
		var totalRequests uint64
		for _, agg := range aggs {
			require.NotNil(t, agg.Analytics)
			require.NotNil(t, agg.Analytics.Operation)
			assert.NotEmpty(t, agg.Analytics.Operation.Hash)
			assert.Equal(t, entityanalyticsv1.OperationType_QUERY, agg.Analytics.Operation.Type)
			totalRequests += agg.RequestCount
		}
		assert.Equal(t, uint64(2), totalRequests)
	})

	t.Run("cache_hit_miss_stats", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache()
		collector := newFakeCollector(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptionsWithAnalytics(cache, collector.server.URL),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// First request: cache miss → subgraph fetch
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.JSONEq(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res.Body)
			require.Equal(t, int64(1), counters.details.Load())

			// Second request: cache hit → no subgraph fetch
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.JSONEq(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res.Body)
			require.Equal(t, int64(1), counters.details.Load(), "details subgraph should not be called again")
		})

		collector.waitForRequest(t, 60*time.Second)

		aggs := collector.allAggregations()
		require.NotEmpty(t, aggs)

		// Verify entity type analytics are present with cache stats
		for _, agg := range aggs {
			require.NotNil(t, agg.Analytics)
			if len(agg.Analytics.EntityTypes) > 0 {
				for _, et := range agg.Analytics.EntityTypes {
					assert.NotEmpty(t, et.EntityType, "entity type should be set")
					// Cache stats should be present
					if et.Cache != nil {
						// At least some cache reads should have been recorded
						totalReads := et.Cache.L1Hits + et.Cache.L1Misses +
							et.Cache.L2Hits + et.Cache.L2Misses
						if totalReads > 0 {
							t.Logf("Entity %s/%s: L1(hit=%d,miss=%d) L2(hit=%d,miss=%d)",
								et.EntityType, et.SubgraphId,
								et.Cache.L1Hits, et.Cache.L1Misses,
								et.Cache.L2Hits, et.Cache.L2Misses)
						}
					}
				}
			}
		}
	})

	t.Run("request_summary", func(t *testing.T) {
		t.Parallel()

		servers, _ := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache()
		collector := newFakeCollector(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptionsWithAnalytics(cache, collector.server.URL),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.JSONEq(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res.Body)
		})

		collector.waitForRequest(t, 60*time.Second)

		aggs := collector.allAggregations()
		require.NotEmpty(t, aggs)

		// Each aggregation should have a request summary
		for _, agg := range aggs {
			require.NotNil(t, agg.Analytics)
			require.NotNil(t, agg.Analytics.Summary, "request summary should be present")
		}
	})

	t.Run("different_operations_separate_aggregations", func(t *testing.T) {
		t.Parallel()

		servers, _ := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache()
		collector := newFakeCollector(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptionsWithAnalytics(cache, collector.server.URL),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Two different operations
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.JSONEq(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res.Body)

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ items { id name } }`,
			})
			require.Contains(t, res.Body, `"id"`)
		})

		collector.waitForRequest(t, 60*time.Second)

		aggs := collector.allAggregations()
		require.NotEmpty(t, aggs)

		// Different operations should produce different operation hashes
		hashes := map[string]bool{}
		for _, agg := range aggs {
			if agg.Analytics != nil && agg.Analytics.Operation != nil {
				hashes[agg.Analytics.Operation.Hash] = true
			}
		}
		assert.GreaterOrEqual(t, len(hashes), 2, "different operations should produce different aggregation entries")
	})
}
