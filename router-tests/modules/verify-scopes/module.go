package verify_scopes

import (
	"net/http"
	"slices"

	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
)

func init() {
	// Register your module here
	core.RegisterModule(&VerifyScopesModule{})
}

const myModuleID = "verifyScopesModule"

// VerifyScopesModule is a simple module that has access to the GraphQL operation and adds custom scopes to the response
type VerifyScopesModule struct {
	Value  uint64   `mapstructure:"value"`
	Scopes []string `mapstructure:"scopes"`
	Logger *zap.Logger
}

func (m *VerifyScopesModule) Middleware(ctx core.RequestContext, next http.Handler) {
	auth := ctx.Authentication()
	if m.Scopes != nil && slices.Compare(m.Scopes, auth.Scopes()) != 0 {
		ctx.ResponseWriter().WriteHeader(http.StatusBadRequest)
		next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
		return
	}

	// Call the next handler in the chain or return early by calling w.Write()
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *VerifyScopesModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 5,
		New: func() core.Module {
			return &VerifyScopesModule{}
		},
	}
}

// Interface guard
var (
	_ core.RouterMiddlewareHandler = (*VerifyScopesModule)(nil)
)
