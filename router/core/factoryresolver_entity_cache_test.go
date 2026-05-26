package core

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
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
				NotFoundCacheTtlSeconds: 15,
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

func TestDataSourceMetaDataMapsRootFieldMutationSubscriptionAndRequestScopedCacheConfig(t *testing.T) {
	t.Parallel()

	mutationTTL := int64(15)
	loader := &Loader{
		entityCachingConfig: &config.EntityCachingConfiguration{
			Enabled: true,
			L2: config.EntityCachingL2Configuration{
				Enabled: true,
				Storage: config.EntityCachingL2StorageConfig{
					ProviderID: "memory-default",
				},
			},
			SubgraphCacheOverrides: []config.EntityCachingSubgraphCacheOverride{
				{
					Name: "items",
					Entities: []config.EntityCachingEntityConfig{
						{Type: "Item", StorageProviderID: "memory-items"},
					},
				},
			},
		},
	}

	meta := loader.dataSourceMetaData(&nodev1.DataSourceConfiguration{
		RootNodes: []*nodev1.TypeField{
			{TypeName: "Query", FieldNames: []string{"item"}},
			{TypeName: "Mutation", FieldNames: []string{"createItem", "deleteItem"}},
			{TypeName: "Subscription", FieldNames: []string{"itemCreated", "itemDeleted"}},
		},
		EntityCacheConfigurations: []*nodev1.EntityCacheConfiguration{
			{
				TypeName:       "Item",
				MaxAgeSeconds:  60,
				IncludeHeaders: true,
			},
		},
		RootFieldCacheConfigurations: []*nodev1.RootFieldCacheConfiguration{
			{
				FieldName:      "item",
				EntityTypeName: "Item",
				MaxAgeSeconds:  30,
				IncludeHeaders: true,
				ShadowMode:     true,
				EntityKeyMappings: []*nodev1.EntityKeyMapping{
					{
						EntityTypeName: "Item",
						FieldMappings: []*nodev1.EntityCacheFieldMapping{
							{
								EntityKeyField: "id",
								ArgumentPath:   []string{"id"},
								IsBatch:        true,
							},
						},
					},
				},
			},
		},
		CachePopulateConfigurations: []*nodev1.CachePopulateConfiguration{
			{
				FieldName:      "createItem",
				EntityTypeName: "Item",
				OperationType:  "Mutation",
				MaxAgeSeconds:  &mutationTTL,
			},
			{
				FieldName:      "itemCreated",
				EntityTypeName: "Item",
				OperationType:  "Subscription",
			},
		},
		CacheInvalidateConfigurations: []*nodev1.CacheInvalidateConfiguration{
			{
				FieldName:      "deleteItem",
				EntityTypeName: "Item",
				OperationType:  "Mutation",
			},
			{
				FieldName:      "itemDeleted",
				EntityTypeName: "Item",
				OperationType:  "Subscription",
			},
		},
		RequestScopedFields: []*nodev1.RequestScopedFieldConfiguration{
			{
				FieldName: "currentViewer",
				TypeName:  "Query",
				L1Key:     "items.currentViewer",
			},
		},
	}, "items")

	require.Len(t, meta.FederationMetaData.RootFieldCaching, 1)
	rootCfg := meta.FederationMetaData.RootFieldCaching[0]
	require.Equal(t, "Query", rootCfg.TypeName)
	require.Equal(t, "item", rootCfg.FieldName)
	require.Equal(t, "memory-items", rootCfg.CacheName)
	require.Equal(t, 30*time.Second, rootCfg.TTL)
	require.True(t, rootCfg.IncludeSubgraphHeaderPrefix)
	require.True(t, rootCfg.ShadowMode)
	require.Len(t, rootCfg.EntityKeyMappings, 1)
	require.Len(t, rootCfg.EntityKeyMappings[0].FieldMappings, 1)
	require.Equal(t, "id", rootCfg.EntityKeyMappings[0].FieldMappings[0].EntityKeyField)
	require.Equal(t, []string{"id"}, rootCfg.EntityKeyMappings[0].FieldMappings[0].ArgumentPath)
	require.True(t, rootCfg.EntityKeyMappings[0].FieldMappings[0].ArgumentIsEntityKey)

	require.Len(t, meta.FederationMetaData.MutationFieldCaching, 1)
	require.Equal(t, "createItem", meta.FederationMetaData.MutationFieldCaching[0].FieldName)
	require.True(t, meta.FederationMetaData.MutationFieldCaching[0].EnableEntityL2CachePopulation)
	require.Equal(t, 15*time.Second, meta.FederationMetaData.MutationFieldCaching[0].TTL)

	require.Len(t, meta.FederationMetaData.MutationCacheInvalidation, 1)
	require.Equal(t, "deleteItem", meta.FederationMetaData.MutationCacheInvalidation[0].FieldName)
	require.Equal(t, "Item", meta.FederationMetaData.MutationCacheInvalidation[0].EntityTypeName)

	require.Len(t, meta.FederationMetaData.SubscriptionEntityPopulation, 2)
	require.Equal(t, "itemCreated", meta.FederationMetaData.SubscriptionEntityPopulation[0].FieldName)
	require.Equal(t, "memory-items", meta.FederationMetaData.SubscriptionEntityPopulation[0].CacheName)
	require.Equal(t, 60*time.Second, meta.FederationMetaData.SubscriptionEntityPopulation[0].TTL)
	require.True(t, meta.FederationMetaData.SubscriptionEntityPopulation[0].IncludeSubgraphHeaderPrefix)
	require.False(t, meta.FederationMetaData.SubscriptionEntityPopulation[0].EnableInvalidationOnKeyOnly)

	require.Equal(t, "itemDeleted", meta.FederationMetaData.SubscriptionEntityPopulation[1].FieldName)
	require.Equal(t, "memory-items", meta.FederationMetaData.SubscriptionEntityPopulation[1].CacheName)
	require.True(t, meta.FederationMetaData.SubscriptionEntityPopulation[1].IncludeSubgraphHeaderPrefix)
	require.True(t, meta.FederationMetaData.SubscriptionEntityPopulation[1].EnableInvalidationOnKeyOnly)

	require.Len(t, meta.FederationMetaData.RequestScopedFields, 1)
	require.Equal(t, plan.RequestScopedField{
		FieldName: "currentViewer",
		TypeName:  "Query",
		L1Key:     "items.currentViewer",
	}, meta.FederationMetaData.RequestScopedFields[0])
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
