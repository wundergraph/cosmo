package startsubscription

import (
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
)

func init() {
	// Register your module here
	core.RegisterModule(&SubscriptionModule{})
}

const (
	ModuleID = "com.example.start-subscription"
)

type SubscriptionModule struct {
	Logger *zap.Logger
}

func (m *SubscriptionModule) Provision(ctx *core.ModuleContext) error {
	// Assign the logger to the module for non-request related logging
	m.Logger = ctx.Logger

	return nil
}

func (m *SubscriptionModule) SubscriptionOnStart(ctx core.SubscriptionOnStartHookContext) error {
	m.Logger.Info("SubscriptionOnStart")
	return core.NewStreamHookError(nil, "test", 200, "test")
}

func (m *SubscriptionModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: ModuleID,
		New: func() core.Module {
			return &SubscriptionModule{}
		},
	}
}

var _ interface {
	core.SubscriptionOnStartHandler
} = (*SubscriptionModule)(nil)
