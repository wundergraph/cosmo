package routerplugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/wundergraph/cosmo/router-plugin/config"
	"github.com/wundergraph/cosmo/router-plugin/setup"

	"github.com/hashicorp/go-hclog"
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
	config      config.RouterPluginConfig
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

// WithServiceName sets the service name for the plugin.
func WithServiceName(serviceName string) PluginOption {
	return func(c *RouterPlugin) {
		c.config.ServiceName = serviceName
	}
}

// WithTracingErrorHandler sets the tracing error handler for the plugin.
func WithTracingErrorHandler(errHandler func(err error)) PluginOption {
	return func(c *RouterPlugin) {
		c.config.TracingErrorHandler = errHandler
	}
}

// WithServiceVersion sets the service version for the plugin.
func WithServiceVersion(serviceVersion string) PluginOption {
	return func(c *RouterPlugin) {
		c.config.ServiceVersion = serviceVersion
	}
}

// WithLogger configures a plugin logger at the provided level.
// The `level` parameter is the level of the logger.
func WithLogger(level hclog.Level) PluginOption {
	return func(c *RouterPlugin) {
		logger := hclog.New(&hclog.LoggerOptions{
			Level: level,
			// We use JSON format as we can retrieve those as args in the router.
			JSONFormat: true,
			// Disable timestamps to prevent duplicates when router ingests logs.
			DisableTime: true,
		})

		c.serveConfig.Logger = logger
	}
}

// WithCustomLogger sets the logger to the provided logger.
// This is useful for when you want to use a custom logger.
// For example, when you want to use a custom logger for the plugin.
func WithCustomLogger(logger hclog.Logger) PluginOption {
	return func(c *RouterPlugin) {
		c.serveConfig.Logger = logger
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

	var startupConfig config.StartupConfig
	if exporterString := os.Getenv(startupConfigKey); exporterString != "" {
		err := json.Unmarshal([]byte(exporterString), &startupConfig)
		if err != nil {
			return nil, err
		}
	}

	logger := routerPlugin.serveConfig.Logger
	if logger == nil {
		logger = hclog.New(&hclog.LoggerOptions{
			Level:       hclog.Debug,
			JSONFormat:  true,
			DisableTime: true,
		})
	}

	grpcServerFunc, err := setup.GrpcServer(setup.GrpcServerInitOpts{
		StartupConfig: startupConfig,
		PluginConfig:  routerPlugin.config,
		Logger:        logger,
	})
	if err != nil {
		return nil, err
	}

	routerPlugin.serveConfig.GRPCServer = grpcServerFunc
	return routerPlugin, nil
}

func (r *RouterPlugin) Serve() {
	there := os.Getenv("GRPC_DATASOURCE_PLUGIN")
	fmt.Println(there)
	os.Setenv("GRPC_DATASOURCE_PLUGIN", "GRPC_DATASOURCE_PLUGIN")
	plugin.Serve(r.serveConfig)
}
