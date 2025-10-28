package batch

import (
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

const myModuleID = "streamReceiveModule"

type StreamReceiveModule struct {
	Logger   *zap.Logger
	Callback func(ctx core.StreamReceiveEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error)
}

func (m *StreamReceiveModule) Provision(ctx *core.ModuleContext) error {
	// Assign the logger to the module for non-request related logging
	m.Logger = ctx.Logger

	return nil
}

func (m *StreamReceiveModule) OnReceiveEvents(ctx core.StreamReceiveEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
	m.Logger.Info("Stream Hook has been run")

	if m.Callback != nil {
		return m.Callback(ctx, events)
	}

	return events, nil
}

func (m *StreamReceiveModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &StreamReceiveModule{}
		},
	}
}

// Interface guard
var (
	_ core.StreamReceiveEventHandler = (*StreamReceiveModule)(nil)
)
