package stream_publish

import (
	"sync/atomic"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

const myModuleID = "publishModule"

type PublishModule struct {
	Logger        *zap.Logger
	HookCallCount *atomic.Int32 // Counter to track how many times the hook is called
	Callback      func(ctx core.StreamPublishEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error)
}

func (m *PublishModule) Provision(ctx *core.ModuleContext) error {
	// Assign the logger to the module for non-request related logging
	m.Logger = ctx.Logger

	return nil
}

func (m *PublishModule) OnPublishEvents(ctx core.StreamPublishEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
	if m.Logger != nil {
		m.Logger.Info("Publish Hook has been run")
	}

	if m.HookCallCount != nil {
		m.HookCallCount.Add(1)
	}

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
