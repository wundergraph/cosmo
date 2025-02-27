package pre_handler_module

import (
	"go.uber.org/zap"
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
)

const myModuleID = "prehandlerModule"

func init() {
	// Register your module here
	core.RegisterModule(&PreHandlerModule{})
}

type PreHandlerModule struct {
	Logger *zap.Logger
}

func (m *PreHandlerModule) Provision(ctx *core.ModuleContext) error {
	// Assign the logger to the module for non-request related logging
	m.Logger = ctx.Logger

	return nil
}

func (m *PreHandlerModule) PreHandleRequestMiddleware(ctx core.RequestContext, next http.Handler) {
	req := ctx.Request()

	req.Header.Set("Authorization", "Bearer eeee")

	m.Logger.Info("Prehandler executed")

	// Call the next handler in the chain or return early by calling w.Write()
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *PreHandlerModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &PreHandlerModule{}
		},
	}
}

// Interface guard
var (
	_ core.PreHandleRequestMiddleware = (*PreHandlerModule)(nil)
)
