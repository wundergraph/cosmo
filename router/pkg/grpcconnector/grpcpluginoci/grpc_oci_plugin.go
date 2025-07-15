package grpcpluginoci

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"time"

	v1 "github.com/google/go-containerregistry/pkg/v1"
	"github.com/hashicorp/go-plugin"
	"github.com/wundergraph/cosmo/router/pkg/grpcconnector/grpccommon"
	"go.uber.org/zap"
	"google.golang.org/grpc"
)

type GRPCPluginConfig struct {
	Logger      *zap.Logger
	ImageSource ImageSource
}

type GRPCPlugin struct {
	logger *zap.Logger

	done     chan struct{}
	mu       sync.Mutex
	disposed atomic.Bool

	workDir string

	imageSource ImageSource
	img         v1.Image

	client *grpccommon.GRPCPluginClient
}

func NewGRPCPlugin(config GRPCPluginConfig) (*GRPCPlugin, error) {
	if config.Logger == nil {
		return nil, fmt.Errorf("logger is required")
	}

	if config.ImageSource == nil {
		return nil, fmt.Errorf("image source is required")
	}

	return &GRPCPlugin{
		done:     make(chan struct{}),
		mu:       sync.Mutex{},
		disposed: atomic.Bool{},

		logger:      config.Logger,
		imageSource: config.ImageSource,
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
	if p.client == nil || p.client.IsPluginProcessExited() {
		p.cleanupPluginWorkDir()
		if err := p.startPluginProcess(); err != nil {
			p.logger.Error("failed to restart plugin", zap.Error(err))
		}
	}
}

func (p *GRPCPlugin) startPluginProcess() error {
	handshakeConfig := plugin.HandshakeConfig{
		ProtocolVersion:  1,
		MagicCookieKey:   "GRPC_DATASOURCE_PLUGIN",
		MagicCookieValue: "GRPC_DATASOURCE_PLUGIN",
	}

	pluginCmd, err := p.PreparePlugin(p.img)
	if err != nil {
		return fmt.Errorf("failed to prepare plugin: %w", err)
	}

	p.logger.Debug("Prepared working directory for plugin", zap.String("dir", p.workDir))

	pluginClient := plugin.NewClient(&plugin.ClientConfig{
		Cmd:              pluginCmd,
		AllowedProtocols: []plugin.Protocol{plugin.ProtocolGRPC},
		HandshakeConfig:  handshakeConfig,
		Logger:           grpccommon.NewPluginLogger(p.logger),
		Plugins: map[string]plugin.Plugin{
			"grpc_datasource": &grpccommon.ThinPlugin{},
		},
	})

	clientProtocol, err := pluginClient.Client()
	if err != nil {
		return fmt.Errorf("failed to create plugin client protocol: %w", err)
	}

	rawClient, err := clientProtocol.Dispense("grpc_datasource")
	if err != nil {
		return fmt.Errorf("failed to dispense plugin: %w", err)
	}

	grpcClient, ok := rawClient.(grpc.ClientConnInterface)
	if !ok {
		return fmt.Errorf("plugin does not implement grpc.ClientConnInterface")
	}

	if p.client == nil {
		// first time we start the plugin, we need to create a new client
		p.client, err = grpccommon.NewGRPCPluginClient(pluginClient, grpcClient)
		if err != nil {
			return fmt.Errorf("failed to create grpc plugin client: %w", err)
		}
		return nil
	}

	p.client.SetClients(pluginClient, grpcClient)

	return nil

}

func (p *GRPCPlugin) cleanupPluginWorkDir() {
	if p.workDir != "" {
		os.RemoveAll(p.workDir)
		p.workDir = ""
	}
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

	imgCh := p.imageSource.Images(ctx)
	img := <-imgCh
	if img == nil {
		return fmt.Errorf("image is nil")
	}
	p.img = img
	if err := p.startPluginProcess(); err != nil {
		return err
	}

	// Start monitoring for image changes if more images are sent
	go func() {
		for {
			select {
			case <-p.done:
				return
			case img, ok := <-imgCh:
				if !ok {
					return
				}
				p.logger.Debug("Detected new image, reloading plugin")
				p.cleanupPluginWorkDir()
				p.img = img
				err := p.startPluginProcess()
				if err != nil {
					p.logger.Error("Failed to reload plugin", zap.Error(err))
					continue
				}
			}
		}
	}()

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

	if p.workDir != "" {
		os.RemoveAll(p.workDir)
	}

	p.disposed.Store(true)

	close(p.done)
	return retErr
}
