package subscription_on_create

import (
	"sync/atomic"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
)

const myModuleID = "subscriptionOnCreateModule"

type SubscriptionOnCreateModule struct {
	Logger        *zap.Logger
	Callback      func(ctx core.SubscriptionOnCreateHandlerContext) error
	HookCallCount *atomic.Int32
}

func (m *SubscriptionOnCreateModule) Provision(ctx *core.ModuleContext) error {
	m.Logger = ctx.Logger
	return nil
}

func (m *SubscriptionOnCreateModule) SubscriptionOnCreate(ctx core.SubscriptionOnCreateHandlerContext) error {
	if m.HookCallCount != nil {
		m.HookCallCount.Add(1)
	}
	if m.Callback != nil {
		return m.Callback(ctx)
	}
	return nil
}

func (m *SubscriptionOnCreateModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       myModuleID,
		Priority: 1,
		New: func() core.Module {
			return &SubscriptionOnCreateModule{}
		},
	}
}

var _ core.SubscriptionOnCreateHandler = (*SubscriptionOnCreateModule)(nil)
