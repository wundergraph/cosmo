package integration

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/entitycache"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// entityCachingConfig returns RouterOptions that enable entity caching with
// the given MemoryEntityCache as the default L2 cache.
func entityCachingConfig(cache *entitycache.MemoryEntityCache) []core.Option {
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

// addEntityCacheConfig adds entity cache configuration to all datasources
// in the router config with the given TTL in seconds.
func addEntityCacheConfig(routerConfig *nodev1.RouterConfig, ttlSeconds int64) {
	for _, ds := range routerConfig.EngineConfig.DatasourceConfigurations {
		for _, key := range ds.Keys {
			if key.DisableEntityResolver {
				continue
			}
			ds.EntityCacheConfigurations = append(ds.EntityCacheConfigurations, &nodev1.EntityCacheConfiguration{
				TypeName:      key.TypeName,
				MaxAgeSeconds: ttlSeconds,
			})
		}
	}
}

func TestEntityCaching(t *testing.T) {
	t.Parallel()

	// Cross-subgraph query: employee root from employees subgraph,
	// products field resolved by products subgraph via _entities.
	// Entity caching intercepts the _entities call.
	const crossSubgraphQuery = `{ employee(id: 1) { id products } }`

	t.Run("basic L2 miss then hit", func(t *testing.T) {
		t.Parallel()

		cache := entitycache.NewMemoryEntityCache()
		testenv.Run(t, &testenv.Config{
			RouterOptions: entityCachingConfig(cache),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				addEntityCacheConfig(routerConfig, 300)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// First request: cache miss, both employees and products subgraphs called
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: crossSubgraphQuery})
			require.Contains(t, res.Body, `"products"`)

			productsCountAfterFirst := xEnv.SubgraphRequestCount.Products.Load()
			require.Equal(t, int64(1), productsCountAfterFirst)

			// Second request: entity cache hit, products subgraph NOT called again
			res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: crossSubgraphQuery})
			require.Equal(t, res.Body, res2.Body)
			require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Products.Load())
		})
	})

	t.Run("different entities produce separate cache entries", func(t *testing.T) {
		t.Parallel()

		cache := entitycache.NewMemoryEntityCache()
		testenv.Run(t, &testenv.Config{
			RouterOptions: entityCachingConfig(cache),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				addEntityCacheConfig(routerConfig, 300)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Fetch employee 1 products
			res1 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id products } }`,
			})
			require.Contains(t, res1.Body, `"products"`)

			// Fetch employee 3 products (different entity — cache miss)
			res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 3) { id products } }`,
			})
			require.Contains(t, res2.Body, `"products"`)

			// Products subgraph called twice (once per distinct employee)
			require.Equal(t, int64(2), xEnv.SubgraphRequestCount.Products.Load())

			// Now re-fetch employee 1 — should be cached
			res3 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id products } }`,
			})
			require.Equal(t, res1.Body, res3.Body)
			require.Equal(t, int64(2), xEnv.SubgraphRequestCount.Products.Load())
		})
	})

	t.Run("multi-subgraph entity caching", func(t *testing.T) {
		t.Parallel()

		cache := entitycache.NewMemoryEntityCache()
		testenv.Run(t, &testenv.Config{
			RouterOptions: entityCachingConfig(cache),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				addEntityCacheConfig(routerConfig, 300)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// First query hits products subgraph via _entities
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id products } }`,
			})
			require.Contains(t, res.Body, `"products"`)
			require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Products.Load())

			// Second query hits availability subgraph via _entities
			res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id isAvailable } }`,
			})
			require.Contains(t, res2.Body, `"isAvailable"`)
			require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Availability.Load())

			// Re-fetch both: products and availability should be cached
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id products } }`,
			})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id isAvailable } }`,
			})
			require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Products.Load())
			require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Availability.Load())
		})
	})

	t.Run("per-subgraph cache name routes to separate instances", func(t *testing.T) {
		t.Parallel()

		defaultCache := entitycache.NewMemoryEntityCache()
		customCache := entitycache.NewMemoryEntityCache()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithEntityCaching(config.EntityCachingConfiguration{
					Enabled: true,
					L1:      config.EntityCachingL1Configuration{Enabled: true},
					L2:      config.EntityCachingL2Configuration{Enabled: true},
					Subgraphs: []config.EntityCachingSubgraphConfig{
						{
							Name: "products",
							Entities: []config.EntityCachingEntityConfig{
								{Type: "Employee", CacheName: "custom"},
							},
						},
					},
				}),
				core.WithEntityCacheInstances(map[string]resolve.LoaderCache{
					"default": defaultCache,
					"custom":  customCache,
				}),
			},
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				addEntityCacheConfig(routerConfig, 300)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: crossSubgraphQuery,
			})
			require.Contains(t, res.Body, `"products"`)

			// The custom cache should have entries (Employee on products routed to "custom")
			require.Greater(t, customCache.Len(), 0)
		})
	})

	t.Run("shadow mode always fetches from subgraph", func(t *testing.T) {
		t.Parallel()

		cache := entitycache.NewMemoryEntityCache()
		testenv.Run(t, &testenv.Config{
			RouterOptions: entityCachingConfig(cache),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				for _, ds := range routerConfig.EngineConfig.DatasourceConfigurations {
					for _, key := range ds.Keys {
						if key.DisableEntityResolver {
							continue
						}
						ds.EntityCacheConfigurations = append(ds.EntityCacheConfigurations, &nodev1.EntityCacheConfiguration{
							TypeName:      key.TypeName,
							MaxAgeSeconds: 300,
							ShadowMode:    true,
						})
					}
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// First request
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: crossSubgraphQuery})
			require.Contains(t, res.Body, `"products"`)
			productsFirst := xEnv.SubgraphRequestCount.Products.Load()

			// Second request: in shadow mode, subgraph ALWAYS called
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: crossSubgraphQuery})
			require.Greater(t, xEnv.SubgraphRequestCount.Products.Load(), productsFirst)
		})
	})

	t.Run("list query with caching", func(t *testing.T) {
		t.Parallel()

		cache := entitycache.NewMemoryEntityCache()
		testenv.Run(t, &testenv.Config{
			RouterOptions: entityCachingConfig(cache),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				addEntityCacheConfig(routerConfig, 300)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// List query that fetches multiple employees with cross-subgraph products
			query := `{ employees { id products } }`
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			require.Contains(t, res.Body, `"employees"`)
			productsFirst := xEnv.SubgraphRequestCount.Products.Load()
			require.Equal(t, int64(1), productsFirst)

			// Second list query: all _entities calls should be cached
			res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			require.Equal(t, res.Body, res2.Body)
			require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Products.Load())
		})
	})

	t.Run("disabled caching does not cache", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			// No entity caching options
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: crossSubgraphQuery})
			require.Contains(t, res.Body, `"products"`)
			productsFirst := xEnv.SubgraphRequestCount.Products.Load()

			// Second request: products subgraph called again (no caching)
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: crossSubgraphQuery})
			require.Greater(t, xEnv.SubgraphRequestCount.Products.Load(), productsFirst)
		})
	})

	t.Run("cache entries written to L2", func(t *testing.T) {
		t.Parallel()

		cache := entitycache.NewMemoryEntityCache()
		testenv.Run(t, &testenv.Config{
			RouterOptions: entityCachingConfig(cache),
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				addEntityCacheConfig(routerConfig, 300)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			require.Equal(t, 0, cache.Len())

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: crossSubgraphQuery})

			// After first request, cache should have entries
			require.Greater(t, cache.Len(), 0)
		})
	})
}
