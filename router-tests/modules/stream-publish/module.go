package publish

import (
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

const myModuleID = "publishModule"

type PublishModule struct {
	Logger   *zap.Logger
	Callback func(ctx core.StreamPublishEventHandlerContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error)
}

func (m *PublishModule) Provision(ctx *core.ModuleContext) error {
	// Assign the logger to the module for non-request related logging
	m.Logger = ctx.Logger

	return nil
}

func (m *PublishModule) OnPublishEvents(ctx core.StreamPublishEventHandlerContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error) {
	m.Logger.Info("Publish Hook has been run")

	if m.Callback != nil {
		return m.Callback(ctx, events)
	}

	return events, nil
}

func (m *PublishModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &PublishModule{}
		},
	}
}

// Interface guard
var (
	_ core.StreamPublishEventHandler = (*PublishModule)(nil)
)
