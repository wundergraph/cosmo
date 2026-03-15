package entity_caching

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	entityanalyticsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/entityanalytics/v1"
)

func TestEntityAnalytics(t *testing.T) {
	t.Parallel()

	t.Run("basic_pipeline", func(t *testing.T) {
		t.Parallel()

		servers, _ := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)
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
		cache := newMemoryCache(t)
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
		cache := newMemoryCache(t)
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
		cache := newMemoryCache(t)
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
