package routerplugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/wundergraph/cosmo/router-plugin/config"
	"github.com/wundergraph/cosmo/router-plugin/tracing"
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
	config      RouterPluginConfig

	startupConfig config.StartupConfig
}

type RouterPluginConfig struct {
	ServiceName         string
	ServiceVersion      string
	TracingEnabled      bool
	TracingErrorHandler func(err error)
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

	if exporterConfig := os.Getenv(startupConfigKey); exporterConfig != "" {
		var startupConfig config.StartupConfig
		err := json.Unmarshal([]byte(exporterConfig), &startupConfig)
		if err != nil {
			return nil, err
		}
		routerPlugin.startupConfig = startupConfig
	}

	grpcOpts := make([]grpc.ServerOption, 0)
	if routerPlugin.config.TracingEnabled && routerPlugin.startupConfig.Telemetry != nil {
		tracingInterceptor, err := tracing.CreateTracingInterceptor(tracing.TracingOptions{
			ServiceName:      routerPlugin.config.ServiceName,
			ServiceVersion:   routerPlugin.config.ServiceVersion,
			ErrorHandlerFunc: routerPlugin.config.TracingErrorHandler,
			TracingConfig:    routerPlugin.startupConfig.Telemetry.Tracing,
			IPAnonymization:  routerPlugin.startupConfig.IPAnonymization,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create tracing interceptor: %w", err)
		}
		grpcOpts = append(grpcOpts, grpc.UnaryInterceptor(tracingInterceptor))
	}

	routerPlugin.serveConfig.GRPCServer = func(serverOpts []grpc.ServerOption) *grpc.Server {
		allOpts := append(serverOpts, grpcOpts...)
		return grpc.NewServer(allOpts...)
	}

	return routerPlugin, nil
}

func (r *RouterPlugin) Serve() {
	plugin.Serve(r.serveConfig)
}
