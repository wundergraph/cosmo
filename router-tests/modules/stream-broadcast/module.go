package stream_broadcast

import (
	"sync/atomic"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

const myModuleID = "streamBroadcastModule"

type StreamBroadcastModule struct {
	Logger        *zap.Logger
	Callback      func(ctx core.StreamBroadcastEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error)
	HookCallCount *atomic.Int32 // Counter to track how many times the hook is called
}

func (m *StreamBroadcastModule) Provision(ctx *core.ModuleContext) error {
	// Assign the logger to the module for non-request related logging
	m.Logger = ctx.Logger

	return nil
}

func (m *StreamBroadcastModule) OnBroadcastEvents(ctx core.StreamBroadcastEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
	if m.Logger != nil {
		m.Logger.Info("Stream Broadcast Hook has been run")
	}

	if m.HookCallCount != nil {
		m.HookCallCount.Add(1)
	}

	if m.Callback != nil {
		return m.Callback(ctx, events)
	}

	return events, nil
}

func (m *StreamBroadcastModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &StreamBroadcastModule{}
		},
	}
}

// Interface guard
var (
	_ core.StreamBroadcastEventHandler = (*StreamBroadcastModule)(nil)
)
