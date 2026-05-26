package core

import (
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

func TestResolveEntityCacheProviderID(t *testing.T) {
	t.Parallel()
	cfg := &config.EntityCachingConfiguration{
		SubgraphCacheOverrides: []config.EntityCachingSubgraphCacheOverride{
			{
				Name:              "products",
				StorageProviderID: "sg-redis",
				Entities: []config.EntityCachingEntityConfig{
					{Type: "Product", StorageProviderID: "entity-redis"},
				},
			},
			{
				Name:              "reviews",
				StorageProviderID: "reviews-redis",
			},
		},
	}

	t.Run("default_fallback", func(t *testing.T) {
		t.Parallel()
		result := resolveEntityCacheProviderID(cfg, "unknown-subgraph", "AnyType")
		require.Equal(t, "default", result)
	})

	t.Run("subgraph_level_match", func(t *testing.T) {
		t.Parallel()
		result := resolveEntityCacheProviderID(cfg, "reviews", "Review")
		require.Equal(t, "reviews-redis", result)
	})

	t.Run("entity_level_match", func(t *testing.T) {
		t.Parallel()
		result := resolveEntityCacheProviderID(cfg, "products", "Product")
		require.Equal(t, "entity-redis", result)
	})

	t.Run("entity_takes_precedence_over_subgraph", func(t *testing.T) {
		t.Parallel()
		// "products" subgraph has sg-redis, but Product entity has entity-redis
		result := resolveEntityCacheProviderID(cfg, "products", "Product")
		require.Equal(t, "entity-redis", result)
	})

	t.Run("no_entity_match_falls_to_subgraph", func(t *testing.T) {
		t.Parallel()
		result := resolveEntityCacheProviderID(cfg, "products", "Category")
		require.Equal(t, "sg-redis", result)
	})
}

func TestSubgraphNameByID(t *testing.T) {
	t.Parallel()
	subgraphs := []*nodev1.Subgraph{
		{Id: "sg-1", Name: "products"},
		{Id: "sg-2", Name: "reviews"},
	}

	t.Run("found", func(t *testing.T) {
		t.Parallel()
		result := subgraphNameByID(subgraphs, "sg-1")
		require.Equal(t, "products", result)
	})

	t.Run("not_found", func(t *testing.T) {
		t.Parallel()
		result := subgraphNameByID(subgraphs, "sg-unknown")
		require.Equal(t, "", result)
	})
}

func TestBuildEntityCacheInvalidationConfigs(t *testing.T) {
	t.Parallel()
	t.Run("nil_config", func(t *testing.T) {
		t.Parallel()
		result := buildEntityCacheInvalidationConfigs(nil, nil, &nodev1.EngineConfiguration{}, zap.NewNop())
		require.Nil(t, result)
	})

	t.Run("disabled", func(t *testing.T) {
		t.Parallel()
		cfg := &config.EntityCachingConfiguration{Enabled: false}
		result := buildEntityCacheInvalidationConfigs(cfg, nil, &nodev1.EngineConfiguration{}, zap.NewNop())
		require.Nil(t, result)
	})

	t.Run("no_datasources", func(t *testing.T) {
		t.Parallel()
		cfg := &config.EntityCachingConfiguration{Enabled: true}
		result := buildEntityCacheInvalidationConfigs(cfg, nil, &nodev1.EngineConfiguration{}, zap.NewNop())
		require.Nil(t, result)
	})

	t.Run("skips_datasource_with_unknown_subgraph_id", func(t *testing.T) {
		t.Parallel()
		core, observed := observer.New(zapcore.WarnLevel)
		logger := zap.New(core)
		cfg := &config.EntityCachingConfiguration{Enabled: true}
		subgraphs := []*nodev1.Subgraph{
			{Id: "ds-known", Name: "products"},
		}
		engineConfig := &nodev1.EngineConfiguration{
			DatasourceConfigurations: []*nodev1.DataSourceConfiguration{
				{
					Id: "ds-unknown", // no matching subgraph
					EntityCacheConfigurations: []*nodev1.EntityCacheConfiguration{
						{TypeName: "Mystery", MaxAgeSeconds: 60},
					},
				},
				{
					Id: "ds-known",
					EntityCacheConfigurations: []*nodev1.EntityCacheConfiguration{
						{TypeName: "Product", MaxAgeSeconds: 60},
					},
				},
			},
		}

		result := buildEntityCacheInvalidationConfigs(cfg, subgraphs, engineConfig, logger)

		// Known subgraph is present, unknown is skipped (not bucketed under "").
		require.Equal(t, map[string]map[string]*resolve.EntityCacheInvalidationConfig{
			"products": {
				"Product": {CacheName: "default", IncludeSubgraphHeaderPrefix: false},
			},
		}, result)

		// And a single warning was emitted for the unknown datasource ID.
		entries := observed.FilterMessage("entity caching: skipping datasource with unknown subgraph id").All()
		require.Len(t, entries, 1)
		require.Equal(t, "ds-unknown", entries[0].ContextMap()["datasource_id"])
	})

	t.Run("builds_correct_map", func(t *testing.T) {
		t.Parallel()
		cfg := &config.EntityCachingConfiguration{
			Enabled: true,
			SubgraphCacheOverrides: []config.EntityCachingSubgraphCacheOverride{
				{
					Name:              "products",
					StorageProviderID: "custom-redis",
				},
			},
		}
		subgraphs := []*nodev1.Subgraph{
			{Id: "ds-1", Name: "products"},
			{Id: "ds-2", Name: "reviews"},
		}
		engineConfig := &nodev1.EngineConfiguration{
			DatasourceConfigurations: []*nodev1.DataSourceConfiguration{
				{
					Id: "ds-1",
					EntityCacheConfigurations: []*nodev1.EntityCacheConfiguration{
						{TypeName: "Product", MaxAgeSeconds: 60, IncludeHeaders: true},
					},
				},
				{
					Id: "ds-2",
					EntityCacheConfigurations: []*nodev1.EntityCacheConfiguration{
						{TypeName: "Review", MaxAgeSeconds: 30},
					},
				},
			},
		}

		result := buildEntityCacheInvalidationConfigs(cfg, subgraphs, engineConfig, zap.NewNop())
		require.NotNil(t, result)
		require.Len(t, result, 2)

		// products subgraph, Product type -> custom-redis
		require.Contains(t, result, "products")
		require.Contains(t, result["products"], "Product")
		require.Equal(t, &resolve.EntityCacheInvalidationConfig{
			CacheName:                   "custom-redis",
			IncludeSubgraphHeaderPrefix: true,
		}, result["products"]["Product"])

		// reviews subgraph, Review type -> default
		require.Contains(t, result, "reviews")
		require.Contains(t, result["reviews"], "Review")
		require.Equal(t, &resolve.EntityCacheInvalidationConfig{
			CacheName:                   "default",
			IncludeSubgraphHeaderPrefix: false,
		}, result["reviews"]["Review"])
	})
}
