package grpccommon

import (
	"context"

	"github.com/hashicorp/go-plugin"
	"google.golang.org/grpc"
)

type ThinPlugin struct {
	plugin.Plugin
	plugin.GRPCPlugin
}

// GRPCClient implements plugin.GRPCPlugin.
func (p *ThinPlugin) GRPCClient(_ context.Context, _ *plugin.GRPCBroker, conn *grpc.ClientConn) (interface{}, error) {
	return conn, nil
}
