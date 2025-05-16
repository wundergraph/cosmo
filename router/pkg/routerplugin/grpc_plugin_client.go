package routerplugin

import (
	"context"
	"errors"
	"sync/atomic"

	"github.com/hashicorp/go-plugin"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type GRPCPluginClient struct {
	isClosed atomic.Bool

	pc *plugin.Client
	cc grpc.ClientConnInterface
}

var _ grpc.ClientConnInterface = &GRPCPluginClient{}

func newGRPCPluginClient(pc *plugin.Client, cc grpc.ClientConnInterface) (*GRPCPluginClient, error) {
	if pc == nil || cc == nil {
		return nil, errors.New("plugin client or grpc client conn is nil")
	}

	return &GRPCPluginClient{
		pc: pc,
		cc: cc,
	}, nil
}

// Invoke implements grpc.ClientConnInterface.
func (g *GRPCPluginClient) Invoke(ctx context.Context, method string, args any, reply any, opts ...grpc.CallOption) error {
	if !g.isClosed.Load() {
		return status.Error(codes.Unavailable, "plugin is not active")
	}

	return g.cc.Invoke(ctx, method, args, reply, opts...)
}

// NewStream implements grpc.ClientConnInterface.
func (g *GRPCPluginClient) NewStream(ctx context.Context, desc *grpc.StreamDesc, method string, opts ...grpc.CallOption) (grpc.ClientStream, error) {
	return nil, status.Error(codes.Unavailable, "streaming is currently not supported")
}

func (g *GRPCPluginClient) Close() error {
	if g.pc.Exited() || g.isClosed.Load() {
		return nil
	}

	g.isClosed.Store(true)

	g.pc.Kill()
	g.cc = nil

	return nil
}
