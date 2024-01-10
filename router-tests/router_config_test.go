package integration

import (
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/core"
	"testing"
)

func TestRouterConfigParsing(t *testing.T) {
	t.Parallel()

	routerConfig, err := core.SerializeConfigFromFile("./testdata/routerConfig.json")
	require.NoError(t, err)

	assert.Equal(t, routerConfig.Version, "96f0fab1-d0a4-4fc1-801d-59f684f8315d")
	assert.NotNil(t, routerConfig.EngineConfig)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].Id)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].Kind)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].RootNodes)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].ChildNodes)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].OverrideFieldPathFromAlias)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].RequestTimeoutSeconds)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].Keys)
	assert.NotNil(t, routerConfig.EngineConfig.FieldConfigurations)
	assert.NotNil(t, routerConfig.EngineConfig.FieldConfigurations[0].TypeName)
	assert.NotNil(t, routerConfig.EngineConfig.FieldConfigurations[0].FieldName)
	assert.NotNil(t, routerConfig.EngineConfig.FieldConfigurations[0].ArgumentsConfiguration)
	assert.NotNil(t, routerConfig.EngineConfig.StringStorage)
	assert.NotNil(t, routerConfig.EngineConfig.GraphqlSchema)
	assert.Equal(t, routerConfig.EngineConfig.DefaultFlushInterval, int64(500))
	assert.Equal(t, len(routerConfig.EngineConfig.DatasourceConfigurations), 4)
	assert.NotNil(t, routerConfig.Subgraphs)
	assert.Equal(t, len(routerConfig.Subgraphs), 4)
	assert.NotNil(t, routerConfig.Subgraphs[0].Id)
	assert.NotNil(t, routerConfig.Subgraphs[0].Name)
	assert.NotNil(t, routerConfig.Subgraphs[0].RoutingUrl)
	assert.Equal(t, routerConfig.Subgraphs[0].Name, "employees")
}
