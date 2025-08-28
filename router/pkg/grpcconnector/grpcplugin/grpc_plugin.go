package grpcplugin

import (
	"context"
	"errors"
	"fmt"
	"go.opentelemetry.io/otel/trace"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
	"time"

	"github.com/hashicorp/go-plugin"
	"github.com/wundergraph/cosmo/router/pkg/grpcconnector"
	"github.com/wundergraph/cosmo/router/pkg/grpcconnector/grpccommon"
	"go.uber.org/zap"
	"google.golang.org/grpc"
)

type GRPCPluginConfig struct {
	Logger             *zap.Logger
	PluginPath         string
	PluginName         string
	StartupConfig      grpccommon.GRPCStartupParams
	Tracer             trace.Tracer
	GetTraceAttributes grpccommon.GRPCTraceAttributeGetter
}

type GRPCPlugin struct {
	logger *zap.Logger

	done     chan struct{}
	mu       sync.Mutex
	disposed atomic.Bool

	pluginPath string
	pluginName string

	client        *grpccommon.GRPCPluginClient
	startupConfig grpccommon.GRPCStartupParams
	tracer        trace.Tracer

	getTraceAttributes grpccommon.GRPCTraceAttributeGetter
}

var _ grpcconnector.ClientProvider = (*GRPCPlugin)(nil)

func NewGRPCPlugin(config GRPCPluginConfig) (*GRPCPlugin, error) {
	if config.Logger == nil {
		return nil, fmt.Errorf("logger is required")
	}

	if config.PluginName == "" {
		return nil, fmt.Errorf("plugin name is required")
	}

	if config.PluginPath == "" {
		return nil, fmt.Errorf("plugin path is required")
	}

	return &GRPCPlugin{
		done:     make(chan struct{}),
		mu:       sync.Mutex{},
		disposed: atomic.Bool{},

		logger: config.Logger,

		pluginPath: config.PluginPath,
		pluginName: config.PluginName,

		startupConfig: config.StartupConfig,

		tracer: config.Tracer,

		getTraceAttributes: config.GetTraceAttributes,
	}, nil
}

// GetClient implements Plugin.
func (p *GRPCPlugin) GetClient() grpc.ClientConnInterface {
	if p.client == nil {
		return nil
	}

	return p.client
}

func (p *GRPCPlugin) ensureRunningPluginProcess() {
	if p.client.IsPluginProcessExited() {
		if err := p.fork(); err != nil {
			p.logger.Error("failed to restart plugin", zap.Error(err))
		}
	}
}

func (p *GRPCPlugin) fork() error {
	filePath, err := p.validatePluginPath()
	if err != nil {
		return fmt.Errorf("failed to validate plugin path: %w", err)
	}

	handshakeConfig := plugin.HandshakeConfig{
		ProtocolVersion:  1,
		MagicCookieKey:   "GRPC_DATASOURCE_PLUGIN",
		MagicCookieValue: "GRPC_DATASOURCE_PLUGIN",
	}

	pluginCmd := exec.Command(filePath)
	err = grpccommon.PrepareCommand(pluginCmd, p.startupConfig)
	if err != nil {
		return fmt.Errorf("failed to prepare plugin command: %w", err)
	}

	pluginClient := plugin.NewClient(&plugin.ClientConfig{
		Cmd:              pluginCmd,
		AllowedProtocols: []plugin.Protocol{plugin.ProtocolGRPC},
		HandshakeConfig:  handshakeConfig,
		Logger:           grpccommon.NewPluginLogger(p.logger),
		SkipHostEnv:      true,
		Plugins: map[string]plugin.Plugin{
			p.pluginName: &grpccommon.ThinPlugin{},
		},
	})

	clientProtocol, err := pluginClient.Client()
	if err != nil {
		return fmt.Errorf("failed to create plugin client protocol: %w", err)
	}

	rawClient, err := clientProtocol.Dispense(p.pluginName)
	if err != nil {
		return fmt.Errorf("failed to dispense plugin: %w", err)
	}

	grpcClient, ok := rawClient.(grpc.ClientConnInterface)
	if !ok {
		return fmt.Errorf("plugin does not implement grpc.ClientConnInterface")
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	if p.client == nil {
		// first time we start the plugin, we need to create a new client
		p.client, err = grpccommon.NewGRPCPluginClient(pluginClient, grpcClient, grpccommon.GRPCPluginClientOpts{
			Tracer:             p.tracer,
			GetTraceAttributes: p.getTraceAttributes,
		})
		if err != nil {
			return fmt.Errorf("failed to create grpc plugin client: %w", err)
		}
		return nil
	}

	p.client.SetClients(pluginClient, grpcClient)

	return nil

}

// Start implements Plugin.
func (p *GRPCPlugin) Start(ctx context.Context) error {
	go func() {
		select {
		case <-ctx.Done():
			err := p.Stop()
			if err != nil {
				p.logger.Error("failed to stop plugin", zap.Error(err))
			}
		case <-p.done:
			return
		}
	}()

	if err := p.fork(); err != nil {
		return fmt.Errorf("failed to start plugin process: %w", err)
	}

	go func() {
		for {
			select {
			case <-p.done:
				return
			case <-time.After(time.Second * 2):
				p.ensureRunningPluginProcess()
			}
		}
	}()

	return nil
}

// Stop implements Plugin.
func (p *GRPCPlugin) Stop() error {
	if p.disposed.Load() {
		return nil
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	var retErr error
	if p.client != nil {
		if err := p.client.Close(); err != nil {
			retErr = errors.Join(retErr, err)
		}
	}

	p.disposed.Store(true)

	close(p.done)
	return retErr
}

func (p *GRPCPlugin) validatePluginPath() (string, error) {
	filePath := p.pluginPath
	info, err := os.Stat(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to stat plugin: %w", err)
	}

	if info.IsDir() {
		return "", fmt.Errorf("plugin is a directory")
	}

	if info.Size() == 0 {
		return "", fmt.Errorf("plugin is empty")
	}

	if info.Mode()&0111 == 0 {
		return "", fmt.Errorf("plugin is not executable")
	}

	return filePath, nil
}
