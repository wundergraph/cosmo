package module

import (
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
)

// The module's settings live under `modules.<moduleID>` in the router config.
const moduleID = "origin-request"

func init() {
	core.RegisterModule(&Module{})
}

type Module struct{}

// OnOriginRequest runs before each subgraph request. Return a response to answer without calling the subgraph.
func (m *Module) OnOriginRequest(request *http.Request, ctx core.RequestContext) (*http.Request, *http.Response) {
	return request, nil
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

var _ core.EnginePreOriginHandler = (*Module)(nil)
