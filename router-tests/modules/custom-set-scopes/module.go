package custom_set_scopes

import (
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
)

func init() {
	// Register your module here
	core.RegisterModule(&SetScopesModule{})
}

const myModuleID = "setScopesModule"

// SetScopesModule is a simple module that has access to the GraphQL operation and adds custom scopes to the response
type SetScopesModule struct {
	Value uint64 `mapstructure:"value"`

	Logger *zap.Logger
}

func (m *SetScopesModule) Middleware(ctx core.RequestContext, next http.Handler) {
	auth := ctx.Authentication()
	if auth != nil {
		auth.SetScopes([]string{"read:employee", "read:private"})
	}

	// Call the next handler in the chain or return early by calling w.Write()
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *SetScopesModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &SetScopesModule{}
		},
	}
}

// Interface guard
var (
	_ core.RouterMiddlewareHandler = (*SetScopesModule)(nil)
)
