package module

import (
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
)

// The module's settings live under `modules.<moduleID>` in the router config.
const moduleID = "origin-response"

func init() {
	core.RegisterModule(&Module{})
}

type Module struct{}

// OnOriginResponse runs after each subgraph response. Return a response to replace it, or nil to keep it.
func (m *Module) OnOriginResponse(response *http.Response, ctx core.RequestContext) *http.Response {
	return nil
}

func (m *Module) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       moduleID,
		Priority: 1,
		New: func() core.Module {
			return &Module{}
		},
	}
}

var _ core.EnginePostOriginHandler = (*Module)(nil)
