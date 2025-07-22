package start_subscription

import (
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
)

const myModuleID = "startSubscriptionModule"

type StartSubscriptionModule struct {
	Logger   *zap.Logger
	Callback func(ctx core.SubscriptionOnStartHookContext) (bool, error)
}

func (m *StartSubscriptionModule) Provision(ctx *core.ModuleContext) error {
	// Assign the logger to the module for non-request related logging
	m.Logger = ctx.Logger

	return nil
}

func (m *StartSubscriptionModule) SubscriptionOnStart(ctx core.SubscriptionOnStartHookContext) (bool, error) {

	m.Logger.Info("SubscriptionOnStart Hook has been run")

	if m.Callback != nil {
		return m.Callback(ctx)
	}

	return false, nil
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
)
