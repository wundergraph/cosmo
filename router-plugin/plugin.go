package routerplugin

import (
	"context"
	"errors"

	"github.com/hashicorp/go-plugin"
	"google.golang.org/grpc"
)

// HandshakeConfig is the handshake config for the plugin.
var RouterPluginHandshakeConfig = plugin.HandshakeConfig{
	ProtocolVersion:  1,
	MagicCookieKey:   "GRPC_DATASOURCE_PLUGIN",
	MagicCookieValue: "GRPC_DATASOURCE_PLUGIN",
}

// PluginMapName is the name of the plugin in the plugin map.
var PluginMapName = "grpc_datasource"

// GRPCPlugin is the interface that is implemented to serve/connect to
// a plugin over gRPC.
func (p *RouterPlugin) GRPCServer(_ *plugin.GRPCBroker, server *grpc.Server) error {
	p.registrationFunc(server)
	return nil
}

// GRPCClient is the interface that is implemented to serve/connect to
// a plugin over gRPC.
func (p *RouterPlugin) GRPCClient(_ context.Context, _ *plugin.GRPCBroker, cc *grpc.ClientConn) (interface{}, error) {
	return cc, nil
}

type RouterPlugin struct {
	plugin.Plugin
	registrationFunc func(*grpc.Server)

	serveConfig *plugin.ServeConfig
}

type PluginOption func(*plugin.ServeConfig)

func WithTestConfig(testConfig *plugin.ServeTestConfig) PluginOption {
	return func(c *plugin.ServeConfig) {
		c.Test = testConfig
	}
}

func NewRouterPlugin(registrationfunc func(*grpc.Server), opts ...PluginOption) (*RouterPlugin, error) {
	if registrationfunc == nil {
		return nil, errors.New("unable to register service, registration function not provided")
	}

	routerPlugin := &RouterPlugin{
		registrationFunc: registrationfunc,
	}

	serveConfig := &plugin.ServeConfig{
		HandshakeConfig: RouterPluginHandshakeConfig,
		GRPCServer:      plugin.DefaultGRPCServer,
		Plugins: map[string]plugin.Plugin{
			PluginMapName: routerPlugin,
		},
	}

	for _, opt := range opts {
		opt(serveConfig)
	}

	routerPlugin.serveConfig = serveConfig
	return routerPlugin, nil
}

func (r *RouterPlugin) Serve() {
	plugin.Serve(r.serveConfig)
}
