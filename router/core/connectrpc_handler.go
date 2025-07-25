package core

import (
	"net/http"

	"github.com/wundergraph/cosmo/router/pkg/connectrpc"
)

const ConnectRPCPrefix = "/connectrpc"

type ConnectRPCHandler struct {
	ConnectRPC  *connectrpc.ConnectRPC
	graphqlPath string
}

func (h *ConnectRPCHandler) HandlerFunc(next http.Handler) http.Handler {
	return http.HandlerFunc(func(resp http.ResponseWriter, req *http.Request) {
		handled := h.ConnectRPC.HandlerFunc(resp, req, h.graphqlPath, next)
		if !handled {
			next.ServeHTTP(resp, req)
		}
	})
}

func (h *ConnectRPCHandler) Bootstrap() error {
	return h.ConnectRPC.Bootstrap()
}

func NewConnectRPCHandler(graphqlPath, prefix string, data []connectrpc.ConnectRPCData) *ConnectRPCHandler {
	connectRPC := connectrpc.NewConnectRPC(prefix, data)
	return &ConnectRPCHandler{
		ConnectRPC:  connectRPC,
		graphqlPath: graphqlPath,
	}
}
