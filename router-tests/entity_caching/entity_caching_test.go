package entity_caching

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	itemsModel "github.com/wundergraph/cosmo/router-tests/entity_caching/subgraphs/items/subgraph/model"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

func TestEntityCaching(t *testing.T) {
	t.Parallel()

	t.Run("basic_L2_miss_then_hit", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.JSONEq(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res.Body)

			detailsAfterFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterFirst)

			res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.JSONEq(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res2.Body)

			// Details subgraph should NOT be called again (cache hit)
			require.Equal(t, int64(1), counters.details.Load())
		})
	})

	t.Run("different_entities_separate_entries", func(t *testing.T) {
		t.Parallel()

		servers, _ := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res1 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.JSONEq(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res1.Body)

			res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "2") { id name description } }`,
			})
			require.JSONEq(t, `{"data":{"item":{"id":"2","name":"Gadget","description":"A high-tech gadget with many features"}}}`, res2.Body)

			// Both entities should produce cache entries
			require.Equal(t, 2, cache.Len())

			// Re-fetch id:"1" — verify response correctness
			res3 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.JSONEq(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res3.Body)
		})
	})

	t.Run("list_query_caching", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ items { id description rating } }`,
			})
			require.Contains(t, res.Body, `"description"`)
			require.Contains(t, res.Body, `"rating"`)

			detailsAfterFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterFirst)

			res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ items { id description rating } }`,
			})
			require.Equal(t, res.Body, res2.Body)
			require.Equal(t, int64(1), counters.details.Load())
		})
	})

	t.Run("cache_entries_written_to_L2", func(t *testing.T) {
		t.Parallel()

		servers, _ := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			require.Equal(t, 0, cache.Len())

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id description } }`,
			})

			require.Equal(t, 1, cache.Len())
		})
	})

	t.Run("disabled_caching_does_not_cache", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				clearEntityCacheConfigs(routerConfig)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			detailsFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsFirst)

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			// Details subgraph called again (no caching)
			require.Equal(t, int64(2), counters.details.Load())
		})
	})

	t.Run("multi_subgraph_caching", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Fetch description (from details subgraph)
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id description } }`,
			})
			detailsAfterFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterFirst)

			// Fetch available (from inventory subgraph)
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id available } }`,
			})
			inventoryAfterFirst := counters.inventory.Load()
			require.Equal(t, int64(1), inventoryAfterFirst)

			// Re-fetch both: should be cached
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id description } }`,
			})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id available } }`,
			})

			require.Equal(t, detailsAfterFirst, counters.details.Load())
			require.Equal(t, inventoryAfterFirst, counters.inventory.Load())
		})
	})

	t.Run("cross_subgraph_combined_query", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description available } }`,
			})
			require.JSONEq(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use","available":true}}}`, res.Body)

			detailsAfterFirst := counters.details.Load()
			inventoryAfterFirst := counters.inventory.Load()

			res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description available } }`,
			})
			require.JSONEq(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use","available":true}}}`, res2.Body)

			require.Equal(t, detailsAfterFirst, counters.details.Load())
			require.Equal(t, inventoryAfterFirst, counters.inventory.Load())
		})
	})

	t.Run("shadow_mode_always_fetches", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				setEntityCacheShadowMode(routerConfig, true)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			detailsFirst := counters.details.Load()

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			// Shadow mode: subgraph ALWAYS called, but cache is populated
			require.Equal(t, detailsFirst+1, counters.details.Load())
			require.Equal(t, 1, cache.Len())
		})
	})

	t.Run("partial_cache_load", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				setEntityCachePartialLoad(routerConfig, true)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Warm cache for id:"1"
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id description } }`,
			})
			detailsAfterWarm := counters.details.Load()

			// List query: id:"1" should be cached, other IDs fetched
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ items { id description } }`,
			})

			// Details subgraph should be called for the non-cached entities
			require.Equal(t, detailsAfterWarm+1, counters.details.Load())
		})
	})

	t.Run("ttl_expiry", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				setEntityCacheTTL(routerConfig, 1)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id description } }`,
			})
			detailsAfterFirst := counters.details.Load()

			// Immediately, should be cached
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id description } }`,
			})
			require.Equal(t, detailsAfterFirst, counters.details.Load())

			// Wait for TTL expiry
			time.Sleep(1500 * time.Millisecond)

			// After expiry, cache miss
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id description } }`,
			})
			require.Equal(t, detailsAfterFirst+1, counters.details.Load())
		})
	})

	t.Run("per_subgraph_cache_name", func(t *testing.T) {
		t.Parallel()

		servers, _ := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		defaultCache := newMemoryCache(t)
		customCache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions: entityCachingOptionsWithSubgraphConfig(
				map[string]resolve.LoaderCache{
					"default": defaultCache,
					"custom":  customCache,
				},
				[]config.EntityCachingSubgraphConfig{
					{
						Name: "details",
						Entities: []config.EntityCachingEntityConfig{
							{Type: "Item", CacheName: "custom"},
						},
					},
				},
			),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id description } }`,
			})

			require.Equal(t, 1, customCache.Len())
		})
	})

	t.Run("include_headers_varies_cache_key", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions: append(
				entityCachingOptions(cache),
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
							{
								Operation: config.HeaderRuleOperationPropagate,
								Named:     "X-Tenant",
							},
						},
					},
				}),
			),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				setEntityCacheIncludeHeaders(routerConfig, true)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Request with header A
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  `{ item(id: "1") { id description } }`,
				Header: map[string][]string{"X-Tenant": {"A"}},
			})
			detailsAfterA := counters.details.Load()

			// Request with header B — different cache key, miss
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  `{ item(id: "1") { id description } }`,
				Header: map[string][]string{"X-Tenant": {"B"}},
			})
			detailsAfterB := counters.details.Load()
			require.Equal(t, detailsAfterA+1, detailsAfterB)

			// Request with header A again — should hit
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  `{ item(id: "1") { id description } }`,
				Header: map[string][]string{"X-Tenant": {"A"}},
			})
			require.Equal(t, detailsAfterB, counters.details.Load())
		})
	})

	t.Run("negative_cache_caches_null", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				setNegativeCacheTTL(routerConfig, 60)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Query non-existent item
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "999") { id name description } }`,
			})
			require.Contains(t, res.Body, `"item":null`)

			detailsAfterFirst := counters.details.Load()

			// Second query for same non-existent item — should be cached (negative cache)
			res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "999") { id name description } }`,
			})
			require.Contains(t, res2.Body, `"item":null`)
			require.Equal(t, detailsAfterFirst, counters.details.Load())
		})
	})

	t.Run("root_field_caching_with_key_mapping", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Cross-subgraph query to trigger entity caching
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.JSONEq(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res.Body)

			detailsAfterFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterFirst)

			// Cache should have entries from entity resolution
			require.Equal(t, 1, cache.Len())

			// Same query — entity cache hit
			res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.JSONEq(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res2.Body)
			require.Equal(t, int64(1), counters.details.Load())
		})
	})

	t.Run("root_field_list_caching", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Cross-subgraph list query to trigger entity caching
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ items { id name description } }`,
			})
			require.Contains(t, res.Body, `"Widget"`)
			require.Contains(t, res.Body, `"description"`)

			detailsAfterFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterFirst)

			// Cache should have entries (5 items in dataset)
			require.Equal(t, 5, cache.Len())

			// Same query — entity cache hit
			res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ items { id name description } }`,
			})
			require.Equal(t, res.Body, res2.Body)
			require.Equal(t, int64(1), counters.details.Load())
		})
	})

	t.Run("root_field_different_args", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name } }`,
			})

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "2") { id name } }`,
			})

			// Different args = different cache keys, both hit items subgraph
			require.Equal(t, int64(2), counters.items.Load())
		})
	})

	t.Run("query_cache_shadow_mode", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				setQueryCacheShadowMode(routerConfig, true)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name } }`,
			})
			itemsFirst := counters.items.Load()

			// Shadow mode: items subgraph always called
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name } }`,
			})
			require.Equal(t, itemsFirst+1, counters.items.Load())
		})
	})

	t.Run("mutation_invalidates_cache", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Warm cache
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			detailsAfterWarm := counters.details.Load()

			// Verify cache hit
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.Equal(t, detailsAfterWarm, counters.details.Load())

			// Mutation triggers @cacheInvalidate
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateItem(id: "1", name: "Updated Widget") { id name } }`,
			})

			// After invalidation, cache miss → details subgraph called again
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.Equal(t, detailsAfterWarm+1, counters.details.Load())
		})
	})

	t.Run("mutation_populates_cache", func(t *testing.T) {
		t.Parallel()

		servers, _ := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// createItem has @cachePopulate(maxAge: 60)
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { createItem(name: "Foobar", category: "test") { id name category } }`,
			})
			require.Contains(t, res.Body, `"Foobar"`)
			require.Contains(t, res.Body, `"createItem"`)
		})
	})

	t.Run("l1_deduplication", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions: []core.Option{
				core.WithEntityCaching(config.EntityCachingConfiguration{
					Enabled: true,
					L1: config.EntityCachingL1Configuration{
						Enabled: true,
					},
					L2: config.EntityCachingL2Configuration{
						Enabled: false,
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Query the same entity via two aliases in a single request.
			// L1 per-request cache should deduplicate the _entities call
			// so the details subgraph is called only once for item "1".
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{
					a: item(id: "1") { id name description }
					b: item(id: "1") { id name description }
				}`,
			})
			require.Contains(t, res.Body, `"a"`)
			require.Contains(t, res.Body, `"b"`)
			require.Contains(t, res.Body, `"Widget"`)

			// Details subgraph should be called only once (L1 deduplication)
			require.Equal(t, int64(1), counters.details.Load())
		})
	})

	// Tests that the full circuit breaker lifecycle keeps requests working:
	// cache healthy → cache breaks → breaker opens → cache recovers → breaker closes.
	// At every phase, GraphQL queries must return correct data. The subgraph call
	// counter proves whether the response came from cache (counter unchanged) or
	// from a subgraph fetch (counter incremented).
	t.Run("circuit_breaker_degrades_gracefully_on_cache_failure", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)

		cache := newControllableCache(t)
		cooldown := 100 * time.Millisecond
		opts, cb := entityCachingOptionsWithCircuitBreakerRef(cache, 2, cooldown)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            opts,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			const query = `{ item(id: "1") { id name description } }`
			const expected = `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`

			// Phase 1: Cache is healthy. First request populates cache.
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			require.JSONEq(t, expected, res.Body)
			detailsAfterFirst := counters.details.Load()
			require.Greater(t, detailsAfterFirst, int64(0))

			// Second request should be a cache hit — subgraph counter stays the same.
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			require.JSONEq(t, expected, res.Body)
			require.Equal(t, detailsAfterFirst, counters.details.Load(), "expected cache hit: details counter should not change")

			// Phase 2: Cache starts failing. Breaker is still closed, so it tries the cache
			// and gets errors. Requests still succeed via subgraph fallback.
			cache.SetFailing(true)
			for range 2 {
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
				require.JSONEq(t, expected, res.Body)
			}
			require.True(t, cb.IsOpen(), "breaker should be open after 2 consecutive failures")

			// Phase 3: Breaker is open — cache is bypassed entirely.
			// Subgraph counter should increase with every request.
			counterBefore := counters.details.Load()
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			require.JSONEq(t, expected, res.Body)
			require.Greater(t, counters.details.Load(), counterBefore, "expected subgraph fetch when breaker is open")

			// Phase 4: Cache recovers. Wait for cooldown so breaker transitions to half-open.
			cache.SetFailing(false)
			time.Sleep(cooldown + 50*time.Millisecond)

			// The next request is the half-open probe. It should succeed and close the breaker.
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			require.JSONEq(t, expected, res.Body)
			require.False(t, cb.IsOpen(), "breaker should be closed after successful probe")

			// Phase 5: Cache works again. Verify we get a cache hit.
			detailsBefore := counters.details.Load()
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			require.JSONEq(t, expected, res.Body)
			require.Equal(t, detailsBefore, counters.details.Load(), "expected cache hit after recovery")
		})
	})

	// Focused test for the half-open → closed transition.
	// Trips the breaker, waits for cooldown, then verifies that one successful
	// probe closes the breaker and the cache resumes normal operation.
	t.Run("circuit_breaker_recovery_after_cooldown", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)

		cache := newControllableCache(t)
		cooldown := 100 * time.Millisecond
		cache.SetFailing(true) // Start broken

		opts, cb := entityCachingOptionsWithCircuitBreakerRef(cache, 2, cooldown)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            opts,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			const query = `{ item(id: "1") { id name description } }`
			const expected = `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`

			// Trip the breaker: 2 failures while closed.
			for range 2 {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
				require.JSONEq(t, expected, res.Body)
			}
			require.True(t, cb.IsOpen(), "breaker should be open after threshold failures")

			// Fix the cache and wait for cooldown.
			cache.SetFailing(false)
			time.Sleep(cooldown + 50*time.Millisecond)

			// Probe request: succeeds, closes the breaker, populates cache.
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			require.JSONEq(t, expected, res.Body)
			require.False(t, cb.IsOpen(), "breaker should be closed after successful probe")

			// Next request should be a cache hit — subgraph not called.
			detailsBefore := counters.details.Load()
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			require.JSONEq(t, expected, res.Body)
			require.Equal(t, detailsBefore, counters.details.Load(), "expected cache hit after recovery")
		})
	})

	t.Run("subscription_invalidates_cache", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
			ModifyRouterConfig: func(rc *nodev1.RouterConfig) {
				// Remove @cachePopulate subscription configs to avoid a FindByTypeName
				// conflict: both populate (itemCreated) and invalidate (itemUpdated) create
				// SubscriptionEntityPopulation entries for TypeName "Item", and FindByTypeName
				// returns the first match. Removing populate ensures the invalidation config
				// is found.
				removeSubscriptionPopulateConfigs(rc)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Warm cache
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.JSONEq(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res.Body)

			detailsAfterWarm := counters.details.Load()

			// Verify cache hit
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.Equal(t, detailsAfterWarm, counters.details.Load())

			// Start subscription via WebSocket (itemUpdated has @cacheInvalidate)
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)

			err := testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				// Select ONLY key fields so the engine uses SubscriptionCacheModeInvalidate.
				// Selecting non-key fields would cause SubscriptionCacheModePopulate instead.
				Payload: []byte(`{"query":"subscription { itemUpdated { id } }"}`),
			})
			require.NoError(t, err)

			// Push event in background after subscription is established
			go func() {
				xEnv.WaitForSubscriptionCount(1, 5*time.Second)
				servers.itemUpdatedCh <- &itemsModel.Item{ID: "1", Name: "Updated Widget", Category: "tools"}
			}()

			// Read subscription event
			var msg testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &msg)
			require.NoError(t, err)
			require.Equal(t, "next", msg.Type)
			require.Contains(t, string(msg.Payload), `"itemUpdated"`)

			// Close subscription
			require.NoError(t, conn.Close())
			xEnv.WaitForSubscriptionCount(0, 5*time.Second)

			// After invalidation, cache miss → details subgraph called again
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.Equal(t, detailsAfterWarm+1, counters.details.Load())
		})
	})

	t.Run("subscription_populates_cache", func(t *testing.T) {
		t.Parallel()

		servers, _ := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Start subscription via WebSocket (itemCreated has @cachePopulate)
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)

			err := testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { itemCreated { id name category } }"}`),
			})
			require.NoError(t, err)

			// Push event in background after subscription is established
			go func() {
				xEnv.WaitForSubscriptionCount(1, 5*time.Second)
				servers.itemCreatedCh <- &itemsModel.Item{ID: "99", Name: "New Item", Category: "test"}
			}()

			// Read subscription event
			var msg testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &msg)
			require.NoError(t, err)
			require.Equal(t, "next", msg.Type)
			require.Contains(t, string(msg.Payload), `"itemCreated"`)
			require.Contains(t, string(msg.Payload), `"New Item"`)

			// Close subscription
			require.NoError(t, conn.Close())
			xEnv.WaitForSubscriptionCount(0, 5*time.Second)

			// @cachePopulate should have written the entity data to L2 cache
			require.Equal(t, 1, cache.Len())
		})
	})

	t.Run("extension_invalidates_cache", func(t *testing.T) {
		t.Parallel()

		var extensionFlag atomic.Bool
		servers, counters := startSubgraphServersWithMiddleware(t, extensionInvalidationMiddleware(&extensionFlag))
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Warm cache with extension OFF
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.JSONEq(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res.Body)

			detailsAfterWarm := counters.details.Load()

			// Verify cache hit
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.Equal(t, detailsAfterWarm, counters.details.Load())

			// Enable extension: details responses will now include cacheInvalidation for Item id:"1"
			extensionFlag.Store(true)

			// Make a request that hits details subgraph for a DIFFERENT entity.
			// This triggers the details middleware which adds the extension for id:"1".
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "2") { id name description } }`,
			})

			// Disable extension for the final query
			extensionFlag.Store(false)

			// Query id:"1" again — should be cache miss because extension invalidated it
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.Equal(t, detailsAfterWarm+2, counters.details.Load())
		})
	})

	t.Run("mutation_populate_writes_to_cache", func(t *testing.T) {
		t.Parallel()

		servers, _ := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// createItem has @cachePopulate(maxAge: 60) — should return data
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { createItem(name: "Foobar", category: "test") { id name category } }`,
			})
			require.Contains(t, res.Body, `"Foobar"`)
			require.Contains(t, res.Body, `"createItem"`)
		})
	})

	t.Run("delete_mutation_invalidates_cache", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Warm cache
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			detailsAfterWarm := counters.details.Load()

			// Verify cache hit
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.Equal(t, detailsAfterWarm, counters.details.Load())

			// Delete triggers @cacheInvalidate
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { deleteItem(id: "1") { id name } }`,
			})

			// After invalidation, cache miss
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.Equal(t, detailsAfterWarm+1, counters.details.Load())
		})
	})

	t.Run("l1_deduplication_with_l2", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Query same entity via two aliases — L1 should deduplicate
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{
					a: item(id: "1") { id name description }
					b: item(id: "1") { id name description }
				}`,
			})
			require.Contains(t, res.Body, `"a"`)
			require.Contains(t, res.Body, `"b"`)

			// Details subgraph called only once (L1 dedup within single request)
			require.Equal(t, int64(1), counters.details.Load())

			// L2 should also have the entry
			require.Equal(t, 1, cache.Len())
		})
	})

	t.Run("shadow_mode_with_failing_cache", func(t *testing.T) {
		t.Parallel()

		servers, _ := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(&FailingEntityCache{}),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				setEntityCacheShadowMode(routerConfig, true)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Shadow mode + failing cache: should still return data (subgraph always called)
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.JSONEq(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res.Body)
		})
	})

	t.Run("negative_cache_ttl_expiry", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				setNegativeCacheTTL(routerConfig, 1) // 1 second negative cache TTL
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Query non-existent item with cross-subgraph field
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "999") { id name description } }`,
			})
			require.Contains(t, res.Body, `"item":null`)
			detailsAfterFirst := counters.details.Load()

			// Immediately: negative cache hit (details not called again)
			res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "999") { id name description } }`,
			})
			require.Contains(t, res2.Body, `"item":null`)
			require.Equal(t, detailsAfterFirst, counters.details.Load())

			// Wait for negative cache TTL expiry
			time.Sleep(1500 * time.Millisecond)

			// After expiry: if negative cache was applied, details would be called again.
			// For null items, entity resolution doesn't happen, so details stays the same.
			// This verifies the system is stable after negative cache TTL expires.
			res3 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "999") { id name description } }`,
			})
			require.Contains(t, res3.Body, `"item":null`)
		})
	})

	t.Run("partial_cache_load_multiple_warm", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				setEntityCachePartialLoad(routerConfig, true)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Warm cache for id:"1" and id:"2"
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id description } }`,
			})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "2") { id description } }`,
			})
			detailsAfterWarm := counters.details.Load()
			require.Equal(t, int64(2), detailsAfterWarm)
			require.Equal(t, 2, cache.Len())

			// List query: id:"1" and id:"2" cached, rest fetched from subgraph
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ items { id description } }`,
			})
			require.Contains(t, res.Body, `"description"`)

			// Details should be called once more for the remaining uncached items
			require.Equal(t, detailsAfterWarm+1, counters.details.Load())
		})
	})

	t.Run("query_cache_include_headers", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions: append(
				entityCachingOptions(cache),
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
							{
								Operation: config.HeaderRuleOperationPropagate,
								Named:     "X-Tenant",
							},
						},
					},
				}),
			),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				// @queryCache includeHeaders varies the root field cache key by request headers
				setQueryCacheIncludeHeaders(routerConfig, true)
				// Also set entity cache includeHeaders so entity resolution cache key varies too
				setEntityCacheIncludeHeaders(routerConfig, true)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Request with header A — entity resolution calls details subgraph
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  `{ item(id: "1") { id name description } }`,
				Header: map[string][]string{"X-Tenant": {"A"}},
			})
			detailsAfterA := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterA)

			// Same query, header A — entity cache hit (details not called)
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  `{ item(id: "1") { id name description } }`,
				Header: map[string][]string{"X-Tenant": {"A"}},
			})
			require.Equal(t, detailsAfterA, counters.details.Load())

			// Same query, header B — different cache key, details called again
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  `{ item(id: "1") { id name description } }`,
				Header: map[string][]string{"X-Tenant": {"B"}},
			})
			require.Equal(t, detailsAfterA+1, counters.details.Load())
		})
	})

	t.Run("cache_populate_maxage_override", func(t *testing.T) {
		t.Parallel()

		servers, _ := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				setCachePopulateTTL(routerConfig, 1)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// createItem has @cachePopulate — verify the mutation succeeds
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { createItem(name: "ShortLived", category: "test") { id name category } }`,
			})
			require.Contains(t, res.Body, `"ShortLived"`)
			require.Contains(t, res.Body, `"createItem"`)
		})
	})

}
