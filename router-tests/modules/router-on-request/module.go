package router_on_request

import (
	"go.uber.org/zap"
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
)

const myModuleID = "routerOnRequestModule"

type RouterOnRequestModule struct {
	Logger *zap.Logger
	// Since the module struct seems to be getting copied during config setup
	// we use a pointer to this inner struct so the pointer address gets
	// copied but we can manipulate the inner reference from the test
	TokenContainer *TokenContainer
}

type TokenContainer struct {
	Token string
}

func (m *RouterOnRequestModule) Provision(ctx *core.ModuleContext) error {
	// Assign the logger to the module for non-request related logging
	m.Logger = ctx.Logger

	// If no token container was passed as part of the test
	// initialize a default
	if m.TokenContainer == nil {
		m.TokenContainer = &TokenContainer{}
	}

	return nil
}

func (m *RouterOnRequestModule) SetToken(token string) {
	m.TokenContainer.Token = token
}

func (m *RouterOnRequestModule) RouterOnRequest(ctx core.RequestContext, next http.Handler) {
	if m.TokenContainer.Token != "" {
		req := ctx.Request()
		tokenString := "Bearer " + m.TokenContainer.Token
		req.Header.Set("Authorization", tokenString)
	}

	m.Logger.Info("RouterOnRequest Hook has been run")

	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *RouterOnRequestModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &RouterOnRequestModule{}
		},
	}
}

// Interface guard
var (
	_ core.RouterOnRequestHandler = (*RouterOnRequestModule)(nil)
)
