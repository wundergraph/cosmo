package core

import (
	"testing"
	"time"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

func TestResolveEntityCacheProviderID(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		subgraph config.SubgraphCacheOverride
		entity   config.EntityCacheEntityConfiguration
		want     string
	}{
		{
			name:     "entity override wins",
			subgraph: config.SubgraphCacheOverride{StorageProviderID: "subgraph-cache"},
			entity:   config.EntityCacheEntityConfiguration{StorageProviderID: "entity-cache"},
			want:     "entity-cache",
		},
		{
			name:     "subgraph override wins over default",
			subgraph: config.SubgraphCacheOverride{StorageProviderID: "subgraph-cache"},
			entity:   config.EntityCacheEntityConfiguration{},
			want:     "subgraph-cache",
		},
		{
			name:     "falls back to default",
			subgraph: config.SubgraphCacheOverride{},
			entity:   config.EntityCacheEntityConfiguration{},
			want:     "default",
		},
		{
			name:     "missing default provider still resolves to default",
			subgraph: config.SubgraphCacheOverride{},
			entity:   config.EntityCacheEntityConfiguration{Type: "User"},
			want:     "default",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			assert.Equal(t, tt.want, resolveEntityCacheProviderID(tt.subgraph, tt.entity))
		})
	}
}

func TestRouterBuildEntityCacheInstancesIncludesDefaultWhenReferenced(t *testing.T) {
	t.Parallel()

	r := &Router{
		Config: Config{entityCaching: config.EntityCachingConfiguration{
			SubgraphCacheOverrides: []config.SubgraphCacheOverride{
				{
					Name: "accounts",
					Entities: []config.EntityCacheEntityConfiguration{
						{Type: "User", TTL: time.Minute},
					},
				},
			},
		}},
	}

	caches, err := r.buildEntityCacheInstances()

	require.NoError(t, err)
	_, ok := caches["default"]
	require.True(t, ok)
	assert.Nil(t, caches["default"])
}

func TestBuildEntityCacheInvalidationConfigs(t *testing.T) {
	t.Parallel()

	cfg := config.EntityCachingConfiguration{
		SubgraphCacheOverrides: []config.SubgraphCacheOverride{
			{
				Name:              "accounts",
				StorageProviderID: "subgraph-cache",
				Entities: []config.EntityCacheEntityConfiguration{
					{Type: "User", IncludeSubgraphHeaderPrefix: true},
					{Type: "Organization", StorageProviderID: "entity-cache"},
				},
			},
		},
	}

	assert.Equal(t, map[string]map[string]*resolve.EntityCacheInvalidationConfig{
		"accounts": {
			"User": {
				CacheName:                   "subgraph-cache",
				IncludeSubgraphHeaderPrefix: true,
			},
			"Organization": {
				CacheName: "entity-cache",
			},
		},
	}, buildEntityCacheInvalidationConfigs(cfg))
}

func TestLoaderDataSourceMetaDataTranslatesEntityCacheConfig(t *testing.T) {
	t.Parallel()

	loader := &Loader{
		entityCaching: config.EntityCachingConfiguration{
			SubgraphCacheOverrides: []config.SubgraphCacheOverride{
				{
					Name:              "accounts",
					StorageProviderID: "accounts-cache",
					Entities: []config.EntityCacheEntityConfiguration{
						{Type: "User", TTL: 5 * time.Minute, IncludeSubgraphHeaderPrefix: true, ShadowMode: true},
						{Type: "Organization", StorageProviderID: "organization-cache", TTL: 10 * time.Minute, ShadowMode: false},
						{Type: "Review", TTL: time.Minute},
					},
				},
			},
		},
		subgraphsByID: map[string]string{
			"ds-accounts": "accounts",
		},
	}

	metadata := loader.dataSourceMetaData(&nodev1.DataSourceConfiguration{
		Id: "ds-accounts",
		Keys: []*nodev1.RequiredField{
			{TypeName: "User", SelectionSet: "id"},
			{TypeName: "Organization", SelectionSet: "id"},
			{TypeName: "Product", SelectionSet: "id"},
		},
	})

	require.NotNil(t, metadata)
	assert.Equal(t, plan.EntityCacheConfigurations{
		{
			TypeName:                    "User",
			CacheName:                   "accounts-cache",
			TTL:                         5 * time.Minute,
			IncludeSubgraphHeaderPrefix: true,
			ShadowMode:                  true,
		},
		{
			TypeName:   "Organization",
			CacheName:  "organization-cache",
			TTL:        10 * time.Minute,
			ShadowMode: false,
		},
	}, metadata.FederationMetaData.EntityCacheConfig)
}

func TestLoaderDataSourceMetaDataTranslatesMutationCacheConfig(t *testing.T) {
	t.Parallel()

	loader := &Loader{
		entityCaching: config.EntityCachingConfiguration{
			SubgraphCacheOverrides: []config.SubgraphCacheOverride{
				{
					Name: "accounts",
					Mutations: []config.MutationCacheConfiguration{
						{
							FieldName:            "updateUser",
							InvalidateEntityType: "User",
							EnableL2Population:   true,
							TTL:                  3 * time.Minute,
						},
						{
							FieldName:            "deleteOrganization",
							InvalidateEntityType: "Organization",
						},
					},
				},
			},
		},
		subgraphsByID: map[string]string{
			"ds-accounts": "accounts",
		},
	}

	metadata := loader.dataSourceMetaData(&nodev1.DataSourceConfiguration{
		Id: "ds-accounts",
	})

	require.NotNil(t, metadata)
	assert.Equal(t, plan.MutationFieldCacheConfigurations{
		{
			FieldName:                     "updateUser",
			EnableEntityL2CachePopulation: true,
			TTL:                           3 * time.Minute,
		},
		{
			FieldName: "deleteOrganization",
		},
	}, metadata.FederationMetaData.MutationFieldCacheConfig)
	assert.Equal(t, plan.MutationCacheInvalidationConfigurations{
		{
			FieldName:      "updateUser",
			EntityTypeName: "User",
		},
		{
			FieldName:      "deleteOrganization",
			EntityTypeName: "Organization",
		},
	}, metadata.FederationMetaData.MutationCacheInvalidationConfig)
}
