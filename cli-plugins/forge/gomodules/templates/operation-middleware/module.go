package module

import (
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
)

// The module's settings live under `modules.<moduleID>` in the router config.
const moduleID = "operation-middleware"

func init() {
	core.RegisterModule(&Module{})
}

type Module struct{}

// Middleware runs once the operation is parsed and planned; ctx.Operation() describes it.
func (m *Module) Middleware(ctx core.RequestContext, next http.Handler) {
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
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

var _ core.RouterMiddlewareHandler = (*Module)(nil)
