package custom_set_auth_scopes

import (
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
)

func init() {
	// Register your module here
	core.RegisterModule(&SetAuthenticationScopesModule{})
}

const myModuleID = "setAuthenticationScopesModule"

// SetAuthenticationScopesModule is a simple module that has access to the GraphQL operation and adds custom scopes to the response
type SetAuthenticationScopesModule struct {
	Value  uint64   `mapstructure:"value"`
	Scopes []string `mapstructure:"scopes"`
	Logger *zap.Logger
}

func (m *SetAuthenticationScopesModule) Middleware(ctx core.RequestContext, next http.Handler) {
	if m.Scopes != nil {
		ctx.SetAuthenticationScopes(m.Scopes)
	}

	// Call the next handler in the chain or return early by calling w.Write()
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *SetAuthenticationScopesModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 2,
		New: func() core.Module {
			return &SetAuthenticationScopesModule{}
		},
	}
}

// Interface guard
var (
	_ core.RouterMiddlewareHandler = (*SetAuthenticationScopesModule)(nil)
)
