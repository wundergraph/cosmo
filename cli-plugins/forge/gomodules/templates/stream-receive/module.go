package module

import (
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

// The module's settings live under `modules.<moduleID>` in the router config.
const moduleID = "stream-receive"

func init() {
	core.RegisterModule(&Module{})
}

type Module struct{}

// OnReceiveEvents runs for each active subscription when a batch of events arrives from a broker, before
// delivery. Return fewer events to filter them; returning an error closes the subscription.
func (m *Module) OnReceiveEvents(
	ctx core.StreamReceiveEventHandlerContext,
	events datasource.StreamEvents,
) (datasource.StreamEvents, error) {
	return events, nil
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

var _ core.StreamReceiveEventHandler = (*Module)(nil)
