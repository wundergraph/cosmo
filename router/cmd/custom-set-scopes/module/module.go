package module

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

// SetScopesModule is a simple module that has access to the GraphQL operation and add a header to the response
// It demonstrates how to use the different handlers to customize the router.
// It also shows how to use the config file to configure and validate your module config.
// By default, the config file is located at `config.yaml` in the working directory of the router.
type SetScopesModule struct {
	// Properties that are set by the config file are automatically populated based on the `mapstructure` tag
	// Create a new section under `modules.<name>` in the config file with the same name as your module.
	// Don't forget in Go the first letter of a property must be uppercase to be exported

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
