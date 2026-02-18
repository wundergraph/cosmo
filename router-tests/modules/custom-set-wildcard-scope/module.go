package custom_set_wildcard_scope

import (
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
)

const myModuleID = "setWildcardScopeModule"

type SetWildcardScopeModule struct {
	Enabled bool `mapstructure:"enabled"`
}

func (m *SetWildcardScopeModule) Middleware(ctx core.RequestContext, next http.Handler) {
	if m.Enabled {
		ctx.SetWildcardScope(true)
	}
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *SetWildcardScopeModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       myModuleID,
		Priority: 2,
		New: func() core.Module {
			return &SetWildcardScopeModule{}
		},
	}
}

var _ core.RouterMiddlewareHandler = (*SetWildcardScopeModule)(nil)
