package core

import (
	"net/http"

	"github.com/wundergraph/cosmo/router/pkg/connectrpc"
)

func init() {
	RegisterModule(&ConnectRPCHandler{})
}

const ConnectRPCPrefix = "/connectrpc"

type ConnectRPCHandler struct {
	ConnectRPC *connectrpc.ConnectRPC
}

func (h *ConnectRPCHandler) Module() ModuleInfo {
	return ModuleInfo{
		ID:       "connectrpc",
		Priority: 100,
		New:      func() Module { return h },
	}
}

func (h *ConnectRPCHandler) HandlerFunc(next http.Handler) http.Handler {
	return http.HandlerFunc(func(resp http.ResponseWriter, req *http.Request) {
		found := h.ConnectRPC.HandlerFunc(resp, req)
		if !found {
			next.ServeHTTP(resp, req)
			return
		}
	})
}

func NewConnectRPCHandler(prefix string, data []connectrpc.ConnectRPCData) *ConnectRPCHandler {
	connectRPC := connectrpc.NewConnectRPC(prefix, data)
	return &ConnectRPCHandler{
		ConnectRPC: connectRPC,
	}
}
