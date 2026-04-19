package core

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestDataSourceMetaDataMapsNegativeEntityCacheTTL(t *testing.T) {
	t.Parallel()

	loader := &Loader{
		entityCachingConfig: &config.EntityCachingConfiguration{Enabled: true},
	}

	meta := loader.dataSourceMetaData(&nodev1.DataSourceConfiguration{
		EntityCacheConfigurations: []*nodev1.EntityCacheConfiguration{
			{
				TypeName:                "Item",
				MaxAgeSeconds:           300,
				NegativeCacheTtlSeconds: 15,
				IncludeHeaders:          true,
				PartialCacheLoad:        true,
				ShadowMode:              true,
			},
		},
	}, "items")

	require.Len(t, meta.FederationMetaData.EntityCaching, 1)

	cfg := meta.FederationMetaData.EntityCaching[0]
	require.Equal(t, "Item", cfg.TypeName)
	require.Equal(t, "default", cfg.CacheName)
	require.Equal(t, 300*time.Second, cfg.TTL)
	require.Equal(t, 15*time.Second, cfg.NegativeCacheTTL)
	require.True(t, cfg.IncludeSubgraphHeaderPrefix)
	require.True(t, cfg.EnablePartialCacheLoad)
	require.True(t, cfg.ShadowMode)
}

func TestRootTypeNameForField(t *testing.T) {
	t.Parallel()

	t.Run("field found in Query type", func(t *testing.T) {
		t.Parallel()
		rootNodes := []*nodev1.TypeField{
			{TypeName: "Query", FieldNames: []string{"user", "users"}},
			{TypeName: "Mutation", FieldNames: []string{"createUser"}},
		}
		assert.Equal(t, "Query", rootTypeNameForField(rootNodes, "user"))
	})

	t.Run("field found in Mutation type", func(t *testing.T) {
		t.Parallel()
		rootNodes := []*nodev1.TypeField{
			{TypeName: "Query", FieldNames: []string{"user"}},
			{TypeName: "Mutation", FieldNames: []string{"createUser", "deleteUser"}},
		}
		assert.Equal(t, "Mutation", rootTypeNameForField(rootNodes, "createUser"))
	})

	t.Run("field not found", func(t *testing.T) {
		t.Parallel()
		rootNodes := []*nodev1.TypeField{
			{TypeName: "Query", FieldNames: []string{"user"}},
			{TypeName: "Mutation", FieldNames: []string{"createUser"}},
		}
		assert.Equal(t, "", rootTypeNameForField(rootNodes, "nonExistent"))
	})

	t.Run("empty root nodes", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t, "", rootTypeNameForField(nil, "user"))
	})

	t.Run("field in renamed query type", func(t *testing.T) {
		t.Parallel()
		rootNodes := []*nodev1.TypeField{
			{TypeName: "RootQuery", FieldNames: []string{"user", "products"}},
		}
		assert.Equal(t, "RootQuery", rootTypeNameForField(rootNodes, "products"))
	})
}
