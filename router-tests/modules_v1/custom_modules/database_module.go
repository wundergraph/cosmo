package custom_modules

import (
	"github.com/wundergraph/cosmo/router/core"
)

type DatabaseModule struct {}

func (m *DatabaseModule) Module() core.ModuleV1Info {
	priority := 2
	return core.ModuleV1Info{
		ID: "database_module",
		Priority: &priority,
		New: func() core.ModuleV1 {
			return &DatabaseModule{}
		},
	}
}

func (m *DatabaseModule) Provision(ctx *core.ModuleV1Context) error {
	ctx.Logger.Info("Database module provisioned")
	return nil
}

func (m *DatabaseModule) Cleanup(ctx *core.ModuleV1Context) error {
	ctx.Logger.Info("Database module cleaned up")
	return nil
}
