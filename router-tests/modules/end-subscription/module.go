package end_subscription

import (
	"sync/atomic"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
)

const myModuleID = "endSubscriptionModule"

type EndSubscriptionModule struct {
	Logger        *zap.Logger
	Callback      func(ctx core.SubscriptionOnEndHandlerContext)
	HookCallCount *atomic.Int32 // Counter to track how many times the hook is called
}

func (m *EndSubscriptionModule) Provision(ctx *core.ModuleContext) error {
	// Assign the logger to the module for non-request related logging
	m.Logger = ctx.Logger

	return nil
}

func (m *EndSubscriptionModule) SubscriptionOnEnd(ctx core.SubscriptionOnEndHandlerContext) {
	// Increment the hook call counter
	if m.HookCallCount != nil {
		m.HookCallCount.Add(1)
	}

	if m.Callback != nil {
		m.Callback(ctx)
	}
}

func (m *EndSubscriptionModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &EndSubscriptionModule{}
		},
	}
}

// Interface guard
var _ core.SubscriptionOnEndHandler = (*EndSubscriptionModule)(nil)
