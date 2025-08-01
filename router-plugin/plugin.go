package routerplugin

import (
	"context"
	"errors"
	"os"

	"github.com/hashicorp/go-plugin"
	"google.golang.org/grpc"
)

// HandshakeConfig is the handshake config for the plugin.
var RouterPluginHandshakeConfig = plugin.HandshakeConfig{
	ProtocolVersion:  1,
	MagicCookieKey:   "GRPC_DATASOURCE_PLUGIN",
	MagicCookieValue: "GRPC_DATASOURCE_PLUGIN",
}

const startupConfigKey = "startup_config"

// PluginMapName is the name of the plugin in the plugin map.
var PluginMapName = "grpc_datasource"

type RouterPlugin struct {
	plugin.Plugin
	registrationFunc func(*grpc.Server)

	serveConfig *plugin.ServeConfig
	config      RouterPluginConfig
}

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

type PluginOption func(*RouterPlugin)

func WithTestConfig(testConfig *plugin.ServeTestConfig) PluginOption {
	return func(c *RouterPlugin) {
		c.serveConfig.Test = testConfig
	}
}

// WithTracing enables tracing for the plugin.
// This includes creating a tracing interceptor
func WithTracing() PluginOption {
	return func(c *RouterPlugin) {
		c.config.TracingEnabled = true
	}
}

func WithServiceName(serviceName string) PluginOption {
	return func(c *RouterPlugin) {
		c.config.ServiceName = serviceName
	}
}

func WithTracingErrorHandler(errHandler func(err error)) PluginOption {
	return func(c *RouterPlugin) {
		c.config.TracingErrorHandler = errHandler
	}
}

func WithServiceVersion(serviceVersion string) PluginOption {
	return func(c *RouterPlugin) {
		c.config.ServiceVersion = serviceVersion
	}
}

func NewRouterPlugin(registrationfunc func(*grpc.Server), opts ...PluginOption) (*RouterPlugin, error) {
	if registrationfunc == nil {
		return nil, errors.New("unable to register service, registration function not provided")
	}

	routerPlugin := &RouterPlugin{
		registrationFunc: registrationfunc,
	}

	routerPlugin.serveConfig = &plugin.ServeConfig{
		HandshakeConfig: RouterPluginHandshakeConfig,
		GRPCServer:      plugin.DefaultGRPCServer,
		Plugins: map[string]plugin.Plugin{
			PluginMapName: routerPlugin,
		},
	}

	for _, opt := range opts {
		opt(routerPlugin)
	}

	grpcServerFunc, err := GrpcServer(GrpcServerInitOpts{
		ExporterConfig: os.Getenv(startupConfigKey),
		PluginConfig:   routerPlugin.config,
	})
	if err != nil {
		return nil, err
	}

	routerPlugin.serveConfig.GRPCServer = grpcServerFunc

	return routerPlugin, nil
}

func (r *RouterPlugin) Serve() {
	plugin.Serve(r.serveConfig)
}
