package routerplugin

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"

	"github.com/hashicorp/go-plugin"
	"go.uber.org/zap"
	"google.golang.org/grpc"
)

type GRPCPluginConfig struct {
	PluginPath    string
	PluginName    string
	PluginCommand []string
}

type GRPCPlugin struct {
	plugin.Plugin
	plugin.GRPCPlugin

	done     chan struct{}
	mu       *sync.Mutex
	disposed atomic.Bool

	pluginPath    string
	pluginName    string
	pluginCommand []string

	cp *GRPCPluginClient
}

// GetClient implements Plugin.
func (s *GRPCPlugin) GetClient() grpc.ClientConnInterface {
	if s.cp == nil {
		return nil
	}

	return s.cp.cc
}

var _ Plugin = &GRPCPlugin{}

var _ plugin.GRPCPlugin = &GRPCPlugin{}

func NewGRPCPlugin(config GRPCPluginConfig) (*GRPCPlugin, error) {
	return &GRPCPlugin{
		done:     make(chan struct{}),
		mu:       &sync.Mutex{},
		disposed: atomic.Bool{},

		pluginPath:    config.PluginPath,
		pluginName:    config.PluginName,
		pluginCommand: config.PluginCommand,
	}, nil
}

// Name implements Plugin.
func (s *GRPCPlugin) Name() string {
	return s.pluginName
}

// Start implements Plugin.
func (s *GRPCPlugin) Start(ctx context.Context, logger *zap.Logger) error {
	if logger == nil {
		logger = zap.NewNop()
	}

	go func() {
		select {
		case <-ctx.Done():
			err := s.Stop()
			if err != nil {
				logger.Error("failed to stop plugin", zap.Error(err))
			}
		case <-s.done:
			return
		}
	}()

	filePath, err := s.validatePluginPath()
	if err != nil {
		return fmt.Errorf("failed to validate plugin path: %w", err)
	}

	// 2. Start the plugin
	handshakeConfig := plugin.HandshakeConfig{
		ProtocolVersion:  1,
		MagicCookieKey:   "GRPC_DATASOURCE_PLUGIN",
		MagicCookieValue: "GRPC_DATASOURCE_PLUGIN",
	}

	pluginClient := plugin.NewClient(&plugin.ClientConfig{
		Cmd:              exec.Command(filePath),
		AllowedProtocols: []plugin.Protocol{plugin.ProtocolGRPC},
		HandshakeConfig:  handshakeConfig,
		Logger:           NewPluginLogger(logger),
		Plugins: map[string]plugin.Plugin{
			s.pluginName: s,
		},
	})

	cp, err := pluginClient.Client()
	if err != nil {
		return fmt.Errorf("failed to create plugin client: %w", err)
	}

	rawClient, err := cp.Dispense(s.pluginName)
	if err != nil {
		return fmt.Errorf("failed to dispense plugin: %w", err)
	}

	grpcClient, ok := rawClient.(grpc.ClientConnInterface)
	if !ok {
		return fmt.Errorf("plugin does not implement grpc.ClientConnInterface")
	}

	s.cp, err = newGRPCPluginClient(pluginClient, grpcClient)
	if err != nil {
		return fmt.Errorf("failed to create grpc plugin client: %w", err)
	}

	return nil
}

// Stop implements Plugin.
func (s *GRPCPlugin) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.disposed.Load() {
		return nil
	}

	var retErr error
	if s.cp != nil {
		if err := s.cp.Close(); err != nil {
			retErr = errors.Join(retErr, err)
		}
	}

	s.disposed.Store(true)

	close(s.done)
	return retErr
}

// GRPCClient implements plugin.GRPCPlugin.
func (s *GRPCPlugin) GRPCClient(ctx context.Context, broker *plugin.GRPCBroker, conn *grpc.ClientConn) (interface{}, error) {
	return conn, nil
}

func (s *GRPCPlugin) validatePluginPath() (string, error) {
	filePath := s.pluginPath
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
