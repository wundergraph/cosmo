package websocket_connection_init

import (
	"github.com/wundergraph/cosmo/router/core"
)

const myModuleID = "webSocketConnectionInitModule"

// WebSocketConnectionInitModule runs Callback for each WebSocket connection the router initializes.
type WebSocketConnectionInitModule struct {
	Callback func(ctx core.WebSocketConnectionInitHandlerContext) error
}

func (m *WebSocketConnectionInitModule) OnWebSocketConnectionInit(ctx core.WebSocketConnectionInitHandlerContext) error {
	if m.Callback != nil {
		return m.Callback(ctx)
	}
	return nil
}

func (m *WebSocketConnectionInitModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &WebSocketConnectionInitModule{}
		},
	}
}

// Interface guard
var (
	_ core.WebSocketConnectionInitHandler = (*WebSocketConnectionInitModule)(nil)
)
