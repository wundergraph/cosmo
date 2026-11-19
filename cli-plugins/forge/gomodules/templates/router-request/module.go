package module

import (
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
)

// The module's settings live under `modules.<moduleID>` in the router config.
const moduleID = "router-request"

func init() {
	core.RegisterModule(&Module{})
}

type Module struct{}

// RouterOnRequest runs before tracing, authentication and operation parsing.
func (m *Module) RouterOnRequest(ctx core.RequestContext, next http.Handler) {
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

var _ core.RouterOnRequestHandler = (*Module)(nil)
