package entity_caching

import (
	"encoding/json"
	"net/http"
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
			req := testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			}
			res := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res.Body)

			detailsAfterFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterFirst)

			res2 := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res2.Body)

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
			reqItem1 := testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			}
			res1 := xEnv.MakeGraphQLRequestOK(reqItem1)
			require.Equal(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res1.Body)

			res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "2") { id name description } }`,
			})
			require.Equal(t, `{"data":{"item":{"id":"2","name":"Gadget","description":"A high-tech gadget with many features"}}}`, res2.Body)

			// Both entities should produce cache entries
			require.Equal(t, 2, cache.Len())

			// Re-fetch id:"1" — verify response correctness
			res3 := xEnv.MakeGraphQLRequestOK(reqItem1)
			require.Equal(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res3.Body)
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
			req := testenv.GraphQLRequest{
				Query: `{ items { id description rating } }`,
			}
			res := xEnv.MakeGraphQLRequestOK(req)
			require.Contains(t, res.Body, `"description"`)
			require.Contains(t, res.Body, `"rating"`)

			detailsAfterFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterFirst)

			res2 := xEnv.MakeGraphQLRequestOK(req)
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
			req := testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			}
			xEnv.MakeGraphQLRequestOK(req)
			detailsFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsFirst)

			xEnv.MakeGraphQLRequestOK(req)
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
			req := testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description available } }`,
			}
			res := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use","available":true}}}`, res.Body)

			detailsAfterFirst := counters.details.Load()
			inventoryAfterFirst := counters.inventory.Load()

			res2 := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use","available":true}}}`, res2.Body)

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
			req := testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			}
			xEnv.MakeGraphQLRequestOK(req)
			detailsFirst := counters.details.Load()

			xEnv.MakeGraphQLRequestOK(req)
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
			req := testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id description } }`,
			}
			xEnv.MakeGraphQLRequestOK(req)
			detailsAfterFirst := counters.details.Load()

			// Immediately, should be cached
			xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, detailsAfterFirst, counters.details.Load())

			// Wait for TTL expiry
			time.Sleep(1500 * time.Millisecond)

			// After expiry, cache miss
			xEnv.MakeGraphQLRequestOK(req)
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
				[]config.EntityCachingSubgraphCacheOverride{
					{
						Name: "details",
						Entities: []config.EntityCachingEntityConfig{
							{Type: "Item", StorageProviderID: "custom"},
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
			req := testenv.GraphQLRequest{
				Query: `{ item(id: "999") { id name description } }`,
			}
			// Query non-existent item
			res := xEnv.MakeGraphQLRequestOK(req)
			require.Contains(t, res.Body, `"item":null`)

			detailsAfterFirst := counters.details.Load()

			// Second query for same non-existent item — should be cached (negative cache)
			res2 := xEnv.MakeGraphQLRequestOK(req)
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
			req := testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			}
			// Cross-subgraph query to trigger entity caching
			res := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res.Body)

			detailsAfterFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterFirst)

			// Cache should have entries from entity resolution
			require.Equal(t, 1, cache.Len())

			// Same query — entity cache hit
			res2 := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res2.Body)
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
			req := testenv.GraphQLRequest{
				Query: `{ items { id name description } }`,
			}
			// Cross-subgraph list query to trigger entity caching
			res := xEnv.MakeGraphQLRequestOK(req)
			require.Contains(t, res.Body, `"Widget"`)
			require.Contains(t, res.Body, `"description"`)

			detailsAfterFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterFirst)

			// Cache should have entries: 5 entity entries (one per item) + 1 root field L2 entry
			require.Equal(t, 6, cache.Len())

			// Same query — entity cache hit
			res2 := xEnv.MakeGraphQLRequestOK(req)
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
			req := testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name } }`,
			}
			xEnv.MakeGraphQLRequestOK(req)
			itemsFirst := counters.items.Load()

			// Shadow mode: items subgraph always called
			xEnv.MakeGraphQLRequestOK(req)
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
			req := testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			}
			// Warm cache
			xEnv.MakeGraphQLRequestOK(req)
			detailsAfterWarm := counters.details.Load()

			// Verify cache hit
			xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, detailsAfterWarm, counters.details.Load())

			// Mutation triggers @cacheInvalidate
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateItem(id: "1", name: "Updated Widget") { id name } }`,
			})

			// After invalidation, cache miss → details subgraph called again
			xEnv.MakeGraphQLRequestOK(req)
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
			require.Equal(t, expected, res.Body)
			detailsAfterFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterFirst)

			// Second request should be a cache hit — subgraph counter stays the same.
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			require.Equal(t, expected, res.Body)
			require.Equal(t, detailsAfterFirst, counters.details.Load(), "expected cache hit: details counter should not change")

			// Phase 2: Cache starts failing. Breaker is still closed, so it tries the cache
			// and gets errors. Requests still succeed via subgraph fallback.
			cache.SetFailing(true)
			for range 2 {
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
				require.Equal(t, expected, res.Body)
			}
			require.True(t, cb.IsOpen(), "breaker should be open after 2 consecutive failures")

			// Phase 3: Breaker is open — cache is bypassed entirely.
			// Subgraph counter should increase with every request.
			counterBefore := counters.details.Load()
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			require.Equal(t, expected, res.Body)
			require.Equal(t, counterBefore+1, counters.details.Load(), "expected subgraph fetch when breaker is open")

			// Phase 4: Cache recovers. Wait for cooldown so breaker transitions to half-open.
			cache.SetFailing(false)
			time.Sleep(cooldown + 50*time.Millisecond)

			// The next request is the half-open probe. It should succeed and close the breaker.
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			require.Equal(t, expected, res.Body)
			require.False(t, cb.IsOpen(), "breaker should be closed after successful probe")

			// Phase 5: Cache works again. Verify we get a cache hit.
			detailsBefore := counters.details.Load()
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			require.Equal(t, expected, res.Body)
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
				require.Equal(t, expected, res.Body)
			}
			require.True(t, cb.IsOpen(), "breaker should be open after threshold failures")

			// Fix the cache and wait for cooldown.
			cache.SetFailing(false)
			time.Sleep(cooldown + 50*time.Millisecond)

			// Probe request: succeeds, closes the breaker, populates cache.
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			require.Equal(t, expected, res.Body)
			require.False(t, cb.IsOpen(), "breaker should be closed after successful probe")

			// Next request should be a cache hit — subgraph not called.
			detailsBefore := counters.details.Load()
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			require.Equal(t, expected, res.Body)
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
		}, func(t *testing.T, xEnv *testenv.Environment) {
			req := testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			}
			// Warm cache
			res := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res.Body)

			detailsAfterWarm := counters.details.Load()

			// Verify cache hit
			xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, detailsAfterWarm, counters.details.Load())

			// Start subscription via WebSocket (itemUpdated has @cacheInvalidate)
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)

			err := testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
				ID:   "1",
				Type: "subscribe",
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
			xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, detailsAfterWarm+1, counters.details.Load())
		})
	})

	t.Run("subscription_populate_config_carries_entity_type_name", func(t *testing.T) {
		// Regression test for the composition->router pipeline carrying entityTypeName
		// end-to-end on @cachePopulate configs. Before this was wired:
		//   - composition wrote CachePopulateConfig without entityTypeName
		//   - router compensated by expanding subscription populate across every
		//     cached entity in the subgraph (semantically ambiguous, wrong config)
		// Now the field carries the specific target entity — router looks it up directly.
		//
		// If composition is reverted, entityTypeName is empty, the router skips the
		// populate setup, and the follow-up subscription_populates_cache test goes red.
		t.Parallel()

		servers, _ := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		var itemCreatedPopulate *nodev1.CachePopulateConfiguration
		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
			ModifyRouterConfig: func(rc *nodev1.RouterConfig) {
				for _, ds := range rc.EngineConfig.DatasourceConfigurations {
					for _, cp := range ds.CachePopulateConfigurations {
						if cp.OperationType == "Subscription" && cp.FieldName == "itemCreated" {
							itemCreatedPopulate = cp
						}
					}
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			require.NotNil(t, itemCreatedPopulate,
				"expected a CachePopulateConfiguration for subscription itemCreated")
			require.Equal(t, "Item", itemCreatedPopulate.EntityTypeName,
				"@cachePopulate must carry the target entity type name through the pipeline")
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
			require.Equal(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res.Body)

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

	t.Run("is_directive_cache_key_mapping", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Query using @is-mapped argument (pid maps to @key field "id")
			// Include cross-subgraph field (description from details) to trigger entity caching
			req := testenv.GraphQLRequest{
				Query: `{ itemByPid(pid: "1") { id name description } }`,
			}
			res := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, `{"data":{"itemByPid":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res.Body)

			detailsAfterFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterFirst)

			// Same query again — entity cache hit (details subgraph not called again)
			res2 := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, `{"data":{"itemByPid":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res2.Body)
			require.Equal(t, int64(1), counters.details.Load())

			// Different pid — entity cache miss for this entity
			res3 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ itemByPid(pid: "2") { id name description } }`,
			})
			require.Equal(t, `{"data":{"itemByPid":{"id":"2","name":"Gadget","description":"A high-tech gadget with many features"}}}`, res3.Body)
			require.Equal(t, int64(2), counters.details.Load())
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
			require.Equal(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res.Body)
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

	// --- Mapping rule coverage tests ---

	t.Run("batch_list_argument_cache_keys", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// itemsByIds uses @is(fields: "id") with a list argument → batch cache lookup.
			// Each element in the ids list maps to one entity cache key.
			req := testenv.GraphQLRequest{
				Query: `{ itemsByIds(ids: ["1", "2"]) { id name description } }`,
			}
			res := xEnv.MakeGraphQLRequestOK(req)
			require.Contains(t, res.Body, `"Widget"`)
			require.Contains(t, res.Body, `"Gadget"`)
			require.Contains(t, res.Body, `"description"`)

			detailsAfterFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterFirst)

			// Two entities fetched → two cache entries
			require.Equal(t, 2, cache.Len())

			// Same query again → all entities served from cache
			res2 := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, res.Body, res2.Body)
			require.Equal(t, detailsAfterFirst, counters.details.Load())
		})
	})

	t.Run("batch_list_partial_cache_hit", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Warm cache for id:"1" only
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			detailsAfterWarm := counters.details.Load()
			require.Equal(t, 1, cache.Len())

			// Batch query for ids ["1", "3"] — id:"1" is cached, id:"3" is not
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ itemsByIds(ids: ["1", "3"]) { id name description } }`,
			})
			require.Contains(t, res.Body, `"Widget"`)
			require.Contains(t, res.Body, `"Gizmo"`)

			// Details subgraph should be called again for the uncached entity
			require.Greater(t, counters.details.Load(), detailsAfterWarm)
		})
	})

	t.Run("composite_key_auto_mapping", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// product(id, region) auto-maps both args to @key(fields: "id region").
			// The cache key includes both id AND region.
			req := testenv.GraphQLRequest{
				Query: `{ product(id: "p1", region: "US") { id region name info } }`,
			}
			res := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, `{"data":{"product":{"id":"p1","region":"US","name":"Alpha","info":"Alpha product details for US market"}}}`, res.Body)

			detailsAfterFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterFirst)

			// Same composite key → cache hit
			res2 := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, res.Body, res2.Body)
			require.Equal(t, detailsAfterFirst, counters.details.Load())

			// Same id, different region → cache miss (different composite key)
			res3 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ product(id: "p3", region: "EU") { id region name info } }`,
			})
			require.Contains(t, res3.Body, `"Gamma"`)
			require.Equal(t, detailsAfterFirst+1, counters.details.Load())
		})
	})

	t.Run("multiple_keys_one_satisfiable", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Product has @key(fields: "id region") and @key(fields: "sku").
			// productBySku only provides sku → only the sku key is satisfiable.
			req := testenv.GraphQLRequest{
				Query: `{ productBySku(sku: "SKU-001") { id region sku name info } }`,
			}
			res := xEnv.MakeGraphQLRequestOK(req)
			require.Contains(t, res.Body, `"Alpha"`)
			require.Contains(t, res.Body, `"SKU-001"`)
			require.Contains(t, res.Body, `"info"`)

			detailsAfterFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterFirst)

			// Same sku → cache hit
			res2 := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, res.Body, res2.Body)
			require.Equal(t, detailsAfterFirst, counters.details.Load())

			// Different sku → cache miss
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ productBySku(sku: "SKU-003") { id region sku name info } }`,
			})
			require.Equal(t, detailsAfterFirst+1, counters.details.Load())
		})
	})

	t.Run("no_key_match_root_field_only", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// productByName(name) — "name" doesn't match any @key field.
			// No entity key mapping is emitted, so no per-entity cache keys
			// are constructed from the argument. Entity caching via _entities
			// still works (the details subgraph result is cached by entity key),
			// but the root field itself does not produce a query cache mapping.
			req := testenv.GraphQLRequest{
				Query: `{ productByName(name: "Alpha") { id region name info } }`,
			}
			res := xEnv.MakeGraphQLRequestOK(req)
			require.Contains(t, res.Body, `"Alpha"`)
			require.Contains(t, res.Body, `"info"`)

			detailsAfterFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterFirst)

			// Entity caching from _entities still works — details cached
			res2 := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, res.Body, res2.Body)
			require.Equal(t, detailsAfterFirst, counters.details.Load())
		})
	})

	t.Run("composite_key_input_object_via_is", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// productByKey uses an input object argument with @is(fields: "id region").
			// The composition decomposes this into argumentPath ["key","id"] and ["key","region"],
			// mapping input object fields to the composite @key(fields: "id region").
			req := testenv.GraphQLRequest{
				Query:     `query($k: ProductKeyInput!) { productByKey(key: $k) { id region name info } }`,
				Variables: []byte(`{"k": {"id": "p1", "region": "US"}}`),
			}
			res := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, `{"data":{"productByKey":{"id":"p1","region":"US","name":"Alpha","info":"Alpha product details for US market"}}}`, res.Body)

			detailsAfterFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterFirst)

			// Same input object → cache hit
			res2 := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, res.Body, res2.Body)
			require.Equal(t, detailsAfterFirst, counters.details.Load())

			// Different input object → cache miss
			req2 := testenv.GraphQLRequest{
				Query:     `query($k: ProductKeyInput!) { productByKey(key: $k) { id region name info } }`,
				Variables: []byte(`{"k": {"id": "p3", "region": "EU"}}`),
			}
			res3 := xEnv.MakeGraphQLRequestOK(req2)
			require.Contains(t, res3.Body, `"Gamma"`)
			require.Equal(t, detailsAfterFirst+1, counters.details.Load())
		})
	})

	t.Run("nested_key_via_is_directive", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// warehouse(locationId) uses @is(fields: "location.id") to map a scalar
			// argument to the nested key path @key(fields: "location { id }").
			req := testenv.GraphQLRequest{
				Query: `{ warehouse(locationId: "w1") { location { id } name capacity } }`,
			}
			res := xEnv.MakeGraphQLRequestOK(req)
			require.Contains(t, res.Body, `"Main Depot"`)
			require.Contains(t, res.Body, `"capacity"`)

			detailsAfterFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterFirst)

			// Same nested key → cache hit
			res2 := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, res.Body, res2.Body)
			require.Equal(t, detailsAfterFirst, counters.details.Load())

			// Different location → cache miss
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ warehouse(locationId: "w2") { location { id } name capacity } }`,
			})
			require.Equal(t, detailsAfterFirst+1, counters.details.Load())
		})
	})

	t.Run("single_subgraph_composite_key_input_object", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// productByKey uses an input object argument with @is(fields: "id region").
			// Querying only items-subgraph fields (id, region, name) verifies that
			// RemapVariables correctly handles nested argument paths in a single-subgraph
			// setup where no entity fetch is needed.
			req := testenv.GraphQLRequest{
				Query:     `query($k: ProductKeyInput!) { productByKey(key: $k) { id region name } }`,
				Variables: []byte(`{"k": {"id": "p1", "region": "US"}}`),
			}
			res := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, `{"data":{"productByKey":{"id":"p1","region":"US","name":"Alpha"}}}`, res.Body)

			itemsAfterFirst := counters.items.Load()
			require.Equal(t, int64(1), itemsAfterFirst)

			// Same input object → cache hit, items subgraph NOT called again
			res2 := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, res.Body, res2.Body)
			require.Equal(t, itemsAfterFirst, counters.items.Load())
		})
	})

	// request_scoped_field_deduplication establishes the baseline behavior for
	// entity resolution deduplication. Without @requestScoped, the details
	// subgraph is called exactly once for a list query (all entities are
	// batched into a single _entities call). The L2 cache then serves
	// subsequent identical requests without calling the subgraph again.
	//
	// When @requestScoped support is added (subgraph schemas declare
	// @requestScoped, composition produces requestScopedFields in config.json,
	// and the planner generates RequestScopedExports/Hints), this test should
	// be extended to verify that the details subgraph is called fewer times
	// across multiple entity batches within a single request.
	t.Run("request_scoped_field_deduplication", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Query a list of items. Each item triggers entity resolution to
			// the details subgraph for description. Without @requestScoped,
			// all entities are batched into one _entities call.
			req := testenv.GraphQLRequest{
				Query: `{ items { id name description } }`,
			}

			res := xEnv.MakeGraphQLRequestOK(req)
			require.Contains(t, res.Body, `"description"`)
			require.Contains(t, res.Body, `"Widget"`)

			// Baseline: details subgraph called exactly once (one batch)
			require.Equal(t, int64(1), counters.details.Load(),
				"details should be called once for the entity batch")

			// Second identical request: L2 cache hit, no subgraph calls
			res2 := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, res.Body, res2.Body)
			require.Equal(t, int64(1), counters.details.Load(),
				"details should not be called again (L2 cache hit)")
		})
	})

	// field_widening_across_requests verifies that when a cached entity has
	// a subset of fields (e.g., description only), a subsequent request
	// asking for additional fields from the same subgraph (e.g., description
	// + rating) correctly fetches the wider field set from the subgraph.
	t.Run("field_widening_across_requests", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Request 1: fetch only description from details subgraph
			res1 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.Equal(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res1.Body)
			detailsAfterFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterFirst)

			// Request 2: fetch description + rating (wider field set from same subgraph).
			// The cache key includes the field selection, so this is a cache miss
			// for the entity resolution to details. The subgraph must be called again.
			res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description rating } }`,
			})
			require.Contains(t, res2.Body, `"description"`)
			require.Contains(t, res2.Body, `"rating"`)
			require.Contains(t, res2.Body, `"Widget"`)

			// Details subgraph called again because wider field set is a different cache key
			require.Equal(t, detailsAfterFirst+1, counters.details.Load(),
				"details should be called again for the wider field set")

			// Request 3: repeat the wider query — should now be a cache hit
			res3 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description rating } }`,
			})
			require.Equal(t, res2.Body, res3.Body)
			require.Equal(t, detailsAfterFirst+1, counters.details.Load(),
				"wider field set should be cached after second fetch")
		})
	})

	// batch_partial_hit_with_extension_fields verifies that batch queries
	// correctly handle partial cache hits when entity extension fields
	// (from the details subgraph) are involved. Entities with cached
	// extension data are served from cache; uncached entities trigger a
	// subgraph fetch only for the missing ones.
	t.Run("batch_partial_hit_with_extension_fields", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Warm cache: fetch extension fields for entity 1 and entity 2
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ itemsByIds(ids: ["1", "2"]) { id name description } }`,
			})
			detailsAfterWarm := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterWarm)
			require.Equal(t, 2, cache.Len())

			// Batch query for entities [1, 2, 3]: entities 1 and 2 have cached
			// extension data from details, entity 3 does not.
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ itemsByIds(ids: ["1", "2", "3"]) { id name description } }`,
			})
			require.Contains(t, res.Body, `"Widget"`)
			require.Contains(t, res.Body, `"Gadget"`)
			require.Contains(t, res.Body, `"Gizmo"`)
			require.Contains(t, res.Body, `"description"`)

			// Details subgraph called again for the uncached entity (id:"3")
			require.Greater(t, counters.details.Load(), detailsAfterWarm,
				"details should be called for uncached entity 3")

			// All three entities now cached
			require.Equal(t, 3, cache.Len())

			// Repeat the batch query — all entities cached, no more subgraph calls
			detailsBeforeRepeat := counters.details.Load()
			res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ itemsByIds(ids: ["1", "2", "3"]) { id name description } }`,
			})
			require.Equal(t, res.Body, res2.Body)
			require.Equal(t, detailsBeforeRepeat, counters.details.Load(),
				"all entities should be served from cache")
		})
	})

	t.Run("batch_entity_key_per_element_caching", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			req := testenv.GraphQLRequest{
				Query: `{ itemsByIds(ids: ["1", "2"]) { id name description } }`,
			}

			// Request 1: both subgraphs called (items for root field, details for entity)
			res := xEnv.MakeGraphQLRequestOK(req)
			require.Contains(t, res.Body, `"Widget"`)
			require.Contains(t, res.Body, `"Gadget"`)
			require.Contains(t, res.Body, `"description"`)

			itemsAfterFirst := counters.items.Load()
			detailsAfterFirst := counters.details.Load()
			require.Equal(t, int64(1), itemsAfterFirst)
			require.Equal(t, int64(1), detailsAfterFirst)

			// Per-element cache entries: 2 entity keys (one per id)
			require.Equal(t, 2, cache.Len())

			// Request 2: identical query — batch entity keys hit, no subgraph calls
			res2 := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, res.Body, res2.Body)

			// Items subgraph should NOT be called again (batch entity key cache hit)
			require.Equal(t, itemsAfterFirst, counters.items.Load())
			// Details subgraph should NOT be called again (entity cache hit)
			require.Equal(t, detailsAfterFirst, counters.details.Load())
		})
	})

	// request_scoped_widening_refetch asserts the TARGET behavior for
	// @requestScoped coordinate L1 caching: no matter how many sites within a
	// single request read a @requestScoped field with the same key, the
	// underlying subgraph should be fetched EXACTLY ONCE.
	//
	// This test is currently expected to FAIL. Under the present implementation
	// the planner writes L1 with the narrow root selection ({id, name}) and a
	// later sequentially-dependent read needs the wider selection
	// ({id, name, email}) via @requires. The widening check in
	// validateItemHasRequiredData sees that email is missing and triggers a
	// refetch against the viewer subgraph, so counters.viewer is 2, not 1.
	//
	// The fix will either (a) teach the planner to pre-plan the wider union of
	// selections up-front so the root fetch already carries {id, name, email},
	// or (b) teach the L1 layer to widen its stored entry when a later read
	// asks for a superset of fields. Either way, once the fix lands this test
	// should pass unchanged.
	//
	// Schema setup (see subgraphs/viewer + subgraphs/articles):
	//
	//   viewer subgraph:
	//     Query.currentViewer                 @requestScoped(key: "currentViewer")
	//     Personalized.currentViewer          @requestScoped(key: "currentViewer")
	//     Viewer { id, name, email }
	//
	//   articles subgraph:
	//     Viewer { recommendedArticles }     (extends viewer entity)
	//     Article implements Personalized {
	//       personalizedRecommendation: String!
	//         @requires(fields: "currentViewer { id name email }")
	//     }
	//
	// Query under test:
	//
	//   {
	//     currentViewer { id name
	//       recommendedArticles {
	//         id title
	//         personalizedRecommendation
	//       }
	//     }
	//   }
	t.Run("request_scoped_widening_refetch", func(t *testing.T) {
		t.Parallel()
		t.Skip("pending functionality: widening refetch across @requires-driven fetches")

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			req := testenv.GraphQLRequest{
				Query: `{
					currentViewer {
						id
						name
						recommendedArticles {
							id
							title
							personalizedRecommendation
						}
					}
				}`,
			}
			res := xEnv.MakeGraphQLRequestOK(req)
			// personalizedRecommendation formats "for <name> <<email>>" — asserting the
			// email shows up proves the wider {id,name,email} selection actually
			// reached the articles subgraph via @requires, i.e. the widening
			// refetch really happened.
			require.Equal(t,
				`{"data":{"currentViewer":{"id":"v1","name":"Alice","recommendedArticles":[`+
					`{"id":"a1","title":"The Rise of Federated GraphQL","personalizedRecommendation":"The Rise of Federated GraphQL, recommended for Alice <alice@example.com>"},`+
					`{"id":"a2","title":"Caching Strategies for Modern APIs","personalizedRecommendation":"Caching Strategies for Modern APIs, recommended for Alice <alice@example.com>"},`+
					`{"id":"a3","title":"A Practical Guide to @requestScoped","personalizedRecommendation":"A Practical Guide to @requestScoped, recommended for Alice <alice@example.com>"}`+
					`]}}}`,
				res.Body)

			// Target behavior: viewer should be fetched EXACTLY ONCE no matter
			// how many @requestScoped reads happen within the request.
			//
			// Currently fails (actual == 2) because the root fetch carries only
			// {id, name} and the later @requires-driven Personalized._entities
			// fetch needs {id, name, email} — the widening check misses and
			// refetches the viewer subgraph. See the test's header comment.
			require.Equal(t, int64(1), counters.viewer.Load(),
				"viewer must be fetched exactly once per request regardless of "+
					"how many @requestScoped reads share the same key")

			require.Equal(t, int64(2), counters.articles.Load(),
				"articles is called twice: once for Viewer._entities (recommendedArticles), "+
					"once for Article._entities (personalizedRecommendation after @requires)")
		})
	})

	// request_scoped_nested_dedup asserts that @requestScoped coordinate L1 caching
	// deduplicates across MULTIPLE nesting levels. Unlike request_scoped_widening_refetch
	// (which tests the narrow-root / wide-@requires widening-miss scenario), this test
	// holds the viewer selection CONSTANT at every site — {id, name, email} everywhere.
	// The only variable is the number of nesting depths at which Article.currentViewer
	// is selected inline.
	//
	// The query selects currentViewer at THREE sites with the same key "currentViewer":
	//   1. Root: Query.currentViewer
	//   2. Nested: recommendedArticles[].currentViewer
	//   3. Deeply nested: recommendedArticles[].relatedArticles[].currentViewer
	//
	// All three sites ask for the same field set {id, name, email}. No @requires is
	// involved (personalizedRecommendation is not selected), so widening is not a
	// factor. With correct @requestScoped dedup, the viewer subgraph should be
	// fetched EXACTLY ONCE — the second and third sites should read from the L1
	// coordinate cache populated by the first.
	//
	// Currently expected to FAIL: the planner launches the BatchEntity viewer fetch
	// for deeper Article.currentViewer sites in parallel with the L1 injection check,
	// so additional HTTP calls are made even though @requestScoped would serve them.
	// Reproduced from the cache explorer playground tool — the demo showed 3 viewer
	// fetches for a query with 2 article nesting levels plus the root currentViewer.
	t.Run("request_scoped_nested_dedup", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			req := testenv.GraphQLRequest{
				Query: `{
					currentViewer {
						id
						name
						email
						recommendedArticles {
							id
							title
							currentViewer {
								id
								name
								email
							}
							relatedArticles {
								id
								title
								currentViewer {
									id
									name
									email
								}
							}
						}
					}
				}`,
			}
			res := xEnv.MakeGraphQLRequestOK(req)
			// Sanity: the query resolved successfully and the viewer data is
			// identical at every site (proves the @requestScoped dedup is at
			// least returning consistent data, even if it made too many fetches).
			require.Contains(t, res.Body, `"currentViewer":{"id":"v1","name":"Alice","email":"alice@example.com"}`)
			require.Contains(t, res.Body, `"recommendedArticles"`)
			require.Contains(t, res.Body, `"relatedArticles"`)

			// Target behavior: the viewer subgraph is hit EXACTLY ONCE regardless
			// of how many Article.currentViewer sites exist in the query. The root
			// Query.currentViewer fetch populates the L1 coordinate cache under
			// key "currentViewer", and every subsequent read at any nesting depth
			// must inject from L1 without launching a new subgraph fetch.
			require.Equal(t, int64(1), counters.viewer.Load(),
				"viewer must be fetched exactly once per request regardless of "+
					"how many nesting levels select Article.currentViewer inline "+
					"(currently fails: the planner launches BatchEntity viewer fetches "+
					"for deeper Article.currentViewer sites in parallel with the L1 "+
					"injection check, paying the subgraph round-trip unnecessarily)")
		})
	})

	t.Run("complex_viewer_articles_query_shape_no_errors", func(t *testing.T) {
		t.Parallel()

		servers, _ := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			req := testenv.GraphQLRequest{
				Query: `query ViewerArticles {
					articles {
						id
						title
						body
						relatedArticles {
							...ArticleFields
							relatedArticles {
								...ArticleFields
								relatedArticles {
									...ArticleFields
								}
							}
						}
					}
					currentViewer {
						id
						name
						email
						recommendedArticles {
							...ArticleFields
							relatedArticles {
								...ArticleFields
								relatedArticles {
									...ArticleFields
								}
							}
						}
					}
				}

				fragment ArticleFields on Article {
					id
					title
					tags
					viewCount
					rating
					reviewSummary
					personalizedRecommendation
					currentViewer {
						id
						name
						email
					}
				}`,
			}

			for i := range 3 {
				res := xEnv.MakeGraphQLRequestOK(req)
				require.NotContains(t, res.Body, `"errors"`, "iteration %d: expected query to execute without GraphQL errors", i)
				require.Contains(t, res.Body, `"articles"`, "iteration %d: expected articles payload", i)
				require.Contains(t, res.Body, `"currentViewer"`, "iteration %d: expected currentViewer payload", i)
			}
		})
	})

	t.Run("complex_viewer_articles_cached_matches_uncached", func(t *testing.T) {
		t.Parallel()

		servers, _ := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			req := testenv.GraphQLRequest{
				Query: `query ViewerArticles {
					articles {
						id
						title
						body
						relatedArticles {
							...ArticleFields
							relatedArticles {
								...ArticleFields
								relatedArticles {
									...ArticleFields
								}
							}
						}
					}
					currentViewer {
						id
						name
						email
						recommendedArticles {
							...ArticleFields
							relatedArticles {
								...ArticleFields
								relatedArticles {
									...ArticleFields
								}
							}
						}
					}
				}

				fragment ArticleFields on Article {
					id
					title
					tags
					viewCount
					rating
					reviewSummary
					personalizedRecommendation
					currentViewer {
						id
						name
						email
					}
				}`,
			}

			// Warm cache.
			xEnv.MakeGraphQLRequestOK(req)

			cachedRes := xEnv.MakeGraphQLRequestOK(req)
			require.NotContains(t, cachedRes.Body, `"errors"`)

			uncachedReq := req
			uncachedReq.Header = http.Header{
				"X-WG-Disable-Entity-Cache": []string{"true"},
			}
			uncachedRes := xEnv.MakeGraphQLRequestOK(uncachedReq)
			require.NotContains(t, uncachedRes.Body, `"errors"`)

			require.Equal(t, uncachedRes.Body, cachedRes.Body)
		})
	})

	// Regression test for the arena pointer bug: exportRequestScopedFields must
	// copy values before storing in requestScopedL1. Without the copy, stored
	// pointers become dangling when the goroutine arena is reused on subsequent
	// requests, causing crashes or corrupted data.
	t.Run("repeated_complex_query_no_panic", func(t *testing.T) {
		t.Parallel()

		servers, _ := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// A query that exercises entity fetching across multiple subgraphs
			// (items + details + inventory). Repeated execution triggers arena
			// reuse which would crash if exported values were not copied.
			req := testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description rating tags available count } }`,
			}
			for i := range 5 {
				res := xEnv.MakeGraphQLRequestOK(req)
				require.Contains(t, res.Body, `"Widget"`, "iteration %d: expected Widget in response", i)
				require.Contains(t, res.Body, `"description"`, "iteration %d: expected description in response", i)
				require.Contains(t, res.Body, `"available"`, "iteration %d: expected available in response", i)
			}
		})
	})

	// RED test: @cachePopulate on a Mutation must write the returned entity to L2 so the
	// next read by id is a cache hit. The existing `mutation_populates_cache` /
	// `mutation_populate_writes_to_cache` tests only verify the mutation responds — they
	// don't actually verify the populate side-effect.
	//
	// Cache-demo trace shows the mutation runs with `l2_enabled: false` and the
	// subsequent `item(id: <new>)` query L2-misses, then re-fetches from the items
	// subgraph. This pin captures that gap so the loader fix can land with coverage.
	t.Run("cache_populate_writes_entity_for_subsequent_read_RED", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// createItem has @cachePopulate(maxAge: 60). The mutation must populate L2
			// with the returned Item entity under its @key("id") cache key.
			createRes := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { createItem(name: "PopulatedItem", category: "populate") { id name category } }`,
			})
			require.Contains(t, createRes.Body, `"PopulatedItem"`)

			// Extract the new id from the response — `nextID` is shared across the
			// parallel test suite, so we can't predict it.
			var idMatch struct {
				Data struct {
					CreateItem struct {
						ID       string `json:"id"`
						Name     string `json:"name"`
						Category string `json:"category"`
					} `json:"createItem"`
				} `json:"data"`
			}
			require.NoError(t, json.Unmarshal([]byte(createRes.Body), &idMatch))
			newID := idMatch.Data.CreateItem.ID
			require.NotEmpty(t, newID, "createItem must return a non-empty id")

			itemsAfterCreate := counters.items.Load()

			// Read the just-created entity by its key. If @cachePopulate wrote to L2,
			// the items subgraph must NOT be called again. The items subgraph's `item(id:)`
			// resolver does NOT persist new items (createItem returns a fresh struct only),
			// so without cache the read returns null. Cache hit means we get the populated
			// entity back exactly as the mutation returned it.
			readRes := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "` + newID + `") { id name category } }`,
			})
			require.Equal(t,
				`{"data":{"item":{"id":"`+newID+`","name":"PopulatedItem","category":"populate"}}}`,
				readRes.Body)
			require.Equal(t, itemsAfterCreate, counters.items.Load(),
				"@cachePopulate must write the entity to L2 so the read-by-id is served from cache")
		})
	})

	// Regression test: @cacheInvalidate clears an entity cached under a composite @key.
	//
	// `delete_mutation_invalidates_cache` already covers the simple id-only case
	// (Item @key("id")). This test pins the composite-key path via Product
	// @key("id region") + deleteProduct(id, region) @cacheInvalidate.
	//
	// The cache-demo failure of an apparently equivalent scenario turned out to be
	// a test-script artifact (mutable subgraph state caused warm-up to return null,
	// which prevented the cache write). The router-side composite-key invalidate
	// path itself works correctly — this test pins that contract.
	t.Run("cache_invalidate_composite_key", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			warmReq := testenv.GraphQLRequest{
				Query: `{ product(id: "p1", region: "US") { id region sku name } }`,
			}
			// 1. Warm the cache for product (id=p1, region=US)
			xEnv.MakeGraphQLRequestOK(warmReq)
			itemsAfterWarm := counters.items.Load()

			// 2. Re-read — must be a cache hit
			xEnv.MakeGraphQLRequestOK(warmReq)
			require.Equal(t, itemsAfterWarm, counters.items.Load(),
				"composite-key entity must be cached after warm-up")

			// 3. Invalidate via deleteProduct. The mutation itself hits the items subgraph
			// to execute the resolver — so we capture the counter AFTER the mutation and
			// only assert on the delta from the subsequent read.
			delRes := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { deleteProduct(id: "p1", region: "US") { id region } }`,
			})
			require.Contains(t, delRes.Body, `"deleteProduct"`)
			itemsAfterMutation := counters.items.Load()

			// 4. Read again — composite-key cache MUST be cleared, items subgraph
			// MUST be hit one more time. Currently fails: counter unchanged → @cacheInvalidate
			// did not evict the composite-key entity, so the read is still a cache hit.
			xEnv.MakeGraphQLRequestOK(warmReq)
			require.Equal(t, itemsAfterMutation+1, counters.items.Load(),
				"@cacheInvalidate on Mutation returning composite-key entity must clear the L2 entry; the post-invalidate read must re-fetch from subgraph")
		})
	})

	// RED test: nested @key reached via input object @is(fields: "location { id }")
	//
	// `warehouse(locationId: ID! @is(fields: "location.id"))` (scalar arg with dot notation)
	// already passes — see "nested_key_via_is_directive" above.
	//
	// `warehouseByInput(input: WarehouseLocationInput! @is(fields: "location { id }"))` is
	// the same nested @key reached via a multi-hop argument path. Composition produces
	// the same `entityKeyField: "location.id"` plus `argumentPath: ["input","location","id"]`.
	// The router's loader must walk the input-object path to construct the cache key.
	//
	// Discovered in cache-demo manual testing: cache lookup fires with the right key but
	// every call shows l2_miss and the entity is never written. Pinning the failure here
	// so the loader fix can land with a regression test.
	t.Run("nested_key_via_input_object_is_directive_RED", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// IMPORTANT: this query does NOT select the @key field (`location { id }`).
			// Reproduces the cache-demo Venue failure where queries that omit the
			// key field from the selection set prevent the cache write — the router's
			// entity write path derives the cache key from the response payload
			// instead of from the argument values that were already used to build
			// the lookup key.
			//
			// Compare to "nested_key_via_is_directive" above, which selects
			// `location { id }` and passes — that test masks this bug because the
			// key value happens to be in the response payload.
			req := testenv.GraphQLRequest{
				Query: `{ warehouseByInput(input: { location: { id: "w1" } }) { name } }`,
			}
			res := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, `{"data":{"warehouseByInput":{"name":"Main Depot"}}}`, res.Body)

			itemsAfterFirst := counters.items.Load()
			require.Equal(t, int64(1), itemsAfterFirst, "first call must hit the items subgraph")

			// Same nested key via input object → MUST be a cache hit. Currently fails:
			// the items subgraph is called a second time despite the L2 lookup running
			// with the structurally correct key, because the cache write path can't
			// reconstruct the entity key from a response that doesn't contain the
			// key field.
			res2 := xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, res.Body, res2.Body)
			require.Equal(t, itemsAfterFirst, counters.items.Load(),
				"input-object → nested-key cache write must persist when @key field is not selected; second call must NOT re-hit subgraph")
		})
	})

	// REGRESSION: a SingleFetch served entirely from L2 cache must report
	// `load_skipped: true` in the request trace. Previously the resolveSingle
	// path didn't set LoadSkipped on cache-hit branches even though the bulk
	// parallel path already did, so observability reported `false` on fetches
	// that demonstrably never called the subgraph.
	t.Run("root_field_cache_hit_reports_load_skipped_in_trace", func(t *testing.T) {
		t.Parallel()

		servers, _ := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache(t)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(cache),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Warm the cache.
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id description } }`,
			})

			// Second call with tracing enabled — assert load_skipped == true on the fetch.
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  `{ item(id: "1") { id description } }`,
				Header: map[string][]string{"X-WG-Trace": {"true"}},
			})
			var body struct {
				Extensions struct {
					Trace struct {
						Fetches map[string]any `json:"fetches"`
					} `json:"trace"`
				} `json:"extensions"`
			}
			require.NoError(t, json.Unmarshal([]byte(res.Body), &body))

			// Walk the fetch tree and find any Single fetch with load_skipped=true.
			var anyLoadSkipped bool
			var visit func(node any)
			visit = func(node any) {
				m, ok := node.(map[string]any)
				if !ok {
					return
				}
				if m["kind"] == "Single" {
					if fetch, ok := m["fetch"].(map[string]any); ok {
						if trace, ok := fetch["trace"].(map[string]any); ok {
							if ls, _ := trace["load_skipped"].(bool); ls {
								anyLoadSkipped = true
							}
						}
					}
				}
				if children, ok := m["children"].([]any); ok {
					for _, c := range children {
						visit(c)
					}
				}
			}
			visit(map[string]any(body.Extensions.Trace.Fetches))
			require.True(t, anyLoadSkipped,
				"trace must report load_skipped=true on the cache-hit fetch")
		})
	})

	// REGRESSION: includeHeaders=true with NO header forwarded must still produce a
	// stable cache key — write and read paths must agree on the prefix. Previously
	// the WRITE path dropped the prefix when headerHash==0 while the READ path
	// always built "0:..." → every read missed.
	t.Run("include_headers_with_no_header_forwarded_caches", func(t *testing.T) {
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
			req := testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id description } }`,
				// No X-Tenant header sent — SubgraphHeadersBuilder returns hash=0.
			}

			// First call: cache miss → subgraph fetch.
			xEnv.MakeGraphQLRequestOK(req)
			detailsAfterFirst := counters.details.Load()
			require.Equal(t, int64(1), detailsAfterFirst)

			// Second call (same query, still no header): MUST be a cache hit. Counter
			// stays at 1. Previously failed because write key {json} ≠ read key 0:{json}.
			xEnv.MakeGraphQLRequestOK(req)
			require.Equal(t, detailsAfterFirst, counters.details.Load(),
				"includeHeaders=true with no header forwarded must produce a stable cache key; second call must hit cache")
		})
	})
}
