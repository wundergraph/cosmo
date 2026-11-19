package module

import (
	"github.com/wundergraph/cosmo/router/core"
)

// The module's settings live under `modules.<moduleID>` in the router config.
const moduleID = "subscription-start"

func init() {
	core.RegisterModule(&Module{})
}

type Module struct{}

// SubscriptionOnStart runs once when a client starts a subscription. A returned error reaches the client
// and the subscription does not start. This hook is experimental.
func (m *Module) SubscriptionOnStart(ctx core.SubscriptionOnStartHandlerContext) error {
	return nil
}

func (m *Module) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       moduleID,
		Priority: 1,
		New: func() core.Module {
			return &Module{}
		},
	}
}

var _ core.SubscriptionOnStartHandler = (*Module)(nil)
