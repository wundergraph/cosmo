package start_subscription

import (
	"net/http"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
)

const myModuleID = "startSubscriptionModule"

type StartSubscriptionModule struct {
	Logger                   *zap.Logger
	Callback                 func(ctx core.SubscriptionOnStartHandlerContext) error
	CallbackOnOriginResponse func(response *http.Response, ctx core.RequestContext) *http.Response
}

func (m *StartSubscriptionModule) Provision(ctx *core.ModuleContext) error {
	// Assign the logger to the module for non-request related logging
	m.Logger = ctx.Logger

	return nil
}

func (m *StartSubscriptionModule) SubscriptionOnStart(ctx core.SubscriptionOnStartHandlerContext) error {
	if m.Logger != nil {
		m.Logger.Info("SubscriptionOnStart Hook has been run")
	}

	if m.Callback != nil {
		return m.Callback(ctx)
	}

	return nil
}

func (m *StartSubscriptionModule) OnOriginResponse(response *http.Response, ctx core.RequestContext) *http.Response {
	if m.CallbackOnOriginResponse != nil {
		return m.CallbackOnOriginResponse(response, ctx)
	}

	return response
}

func (m *StartSubscriptionModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &StartSubscriptionModule{}
		},
	}
}

// Interface guard
var (
	_ core.SubscriptionOnStartHandler = (*StartSubscriptionModule)(nil)
	_ core.EnginePostOriginHandler    = (*StartSubscriptionModule)(nil)
)
