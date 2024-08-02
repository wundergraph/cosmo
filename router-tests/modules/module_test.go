package module_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"

	"github.com/wundergraph/cosmo/router/cmd/custom/module"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestModuleSetCustomHeader(t *testing.T) {
	cfg := config.Config{
		Graph: config.Graph{},
		Modules: map[string]interface{}{
			"myModule": module.MyModule{
				Value: 1,
			},
		},
	}

	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{
			core.WithModulesConfig(cfg.Modules),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query:         `query MyQuery { employees { id } }`,
			OperationName: json.RawMessage(`"MyQuery"`),
		})
		require.NoError(t, err)

		assert.Equal(t, 200, res.Response.StatusCode)

		assert.JSONEq(t, res.Body, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`)
	})
}

func TestSortingModulesByPriority(t *testing.T) {
	cfg := config.Config{
		Modules: map[string]interface{}{
			"myModule": module.MyModule{
				Value: 1,
			},
		},
	}

	modulesW := make(map[string]core.ModuleInfo)
	modulesW["module1"] = core.ModuleInfo{
		ID: "module1",
		New: func() core.Module {
			return nil
		},
	}
	modulesW["module2"] = core.ModuleInfo{
		ID: "module2",
		New: func() core.Module {
			return nil
		},
	}

	modulesX := make(map[string]core.ModuleInfo)
	modulesX["module1"] = core.ModuleInfo{
		ID:       "module1",
		Priority: 1,
		New: func() core.Module {
			return nil
		},
	}
	modulesX["module2"] = core.ModuleInfo{
		ID:       "module2",
		Priority: 2,
		New: func() core.Module {
			return nil
		},
	}

	modulesY := make(map[string]core.ModuleInfo)
	modulesY["module1"] = core.ModuleInfo{
		ID:       "module1",
		Priority: 2,
		New: func() core.Module {
			return nil
		},
	}
	modulesY["module2"] = core.ModuleInfo{
		ID:       "module2",
		Priority: 1,
		New: func() core.Module {
			return nil
		},
	}

	modulesZ := make(map[string]core.ModuleInfo)
	modulesZ["module1"] = core.ModuleInfo{
		ID: "module1",
		New: func() core.Module {
			return nil
		},
	}
	modulesZ["module2"] = core.ModuleInfo{
		ID:       "module2",
		Priority: 2,
		New: func() core.Module {
			return nil
		},
	}

	testenv.Run(t, &testenv.Config{RouterOptions: []core.Option{
		core.WithModulesConfig(cfg.Modules),
	}}, func(t *testing.T, xEnv *testenv.Environment) {
		sortedModulesW := core.SortModules(modulesW)

		assert.Equal(t, 2, len(sortedModulesW))

		sortedModulesX := core.SortModules(modulesX)

		assert.Equal(t, core.ModuleID("module1"), sortedModulesX[0].ID)
		assert.Equal(t, 1, sortedModulesX[0].Priority)
		assert.Equal(t, core.ModuleID("module2"), sortedModulesX[1].ID)
		assert.Equal(t, 2, sortedModulesX[1].Priority)

		sortedModulesY := core.SortModules(modulesY)

		assert.Equal(t, core.ModuleID("module2"), sortedModulesY[0].ID)
		assert.Equal(t, 1, sortedModulesY[0].Priority)
		assert.Equal(t, core.ModuleID("module1"), sortedModulesY[1].ID)
		assert.Equal(t, 2, sortedModulesY[1].Priority)

		sortedModulesZ := core.SortModules(modulesZ)

		assert.Equal(t, core.ModuleID("module2"), sortedModulesZ[0].ID)
		assert.Equal(t, 2, sortedModulesZ[0].Priority)
		assert.Equal(t, core.ModuleID("module1"), sortedModulesZ[1].ID)
		assert.Equal(t, 0, sortedModulesZ[1].Priority)
	})
}
