package batch

import (
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

const myModuleID = "streamBatchModule"

type StreamBatchModule struct {
	Logger   *zap.Logger
	Callback func(ctx core.StreamBatchEventHookContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error)
}

func (m *StreamBatchModule) Provision(ctx *core.ModuleContext) error {
	// Assign the logger to the module for non-request related logging
	m.Logger = ctx.Logger

	return nil
}

func (m *StreamBatchModule) OnStreamEvents(ctx core.StreamBatchEventHookContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error) {
	m.Logger.Info("Stream Hook has been run")

	if m.Callback != nil {
		return m.Callback(ctx, events)
	}

	return events, nil
}

func (m *StreamBatchModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &StreamBatchModule{}
		},
	}
}

// Interface guard
var (
	_ core.StreamBatchEventHook = (*StreamBatchModule)(nil)
)
