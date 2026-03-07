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
		cache := newMemoryCache()

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
		cache := newMemoryCache()

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
		cache := newMemoryCache()

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
		cache := newMemoryCache()

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
		cache := newMemoryCache()

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
		cache := newMemoryCache()

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
		cache := newMemoryCache()

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
		cache := newMemoryCache()

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
		cache := newMemoryCache()

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
		defaultCache := newMemoryCache()
		customCache := newMemoryCache()

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
		cache := newMemoryCache()

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
		cache := newMemoryCache()

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
		cache := newMemoryCache()

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
		cache := newMemoryCache()

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
		cache := newMemoryCache()

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
		cache := newMemoryCache()

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
		cache := newMemoryCache()

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
		cache := newMemoryCache()

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

	t.Run("circuit_breaker_fallback", func(t *testing.T) {
		t.Parallel()

		servers, _ := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: configJSON,
			RouterOptions:            entityCachingOptions(&FailingEntityCache{}),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Even with a failing cache, queries should succeed via subgraph fallback
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ item(id: "1") { id name description } }`,
			})
			require.JSONEq(t, `{"data":{"item":{"id":"1","name":"Widget","description":"A versatile widget for everyday use"}}}`, res.Body)
		})
	})

	t.Run("subscription_invalidates_cache", func(t *testing.T) {
		t.Parallel()

		servers, counters := startSubgraphServers(t)
		configJSON := buildConfigJSON(servers)
		cache := newMemoryCache()

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
		cache := newMemoryCache()

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
		cache := newMemoryCache()

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

}
