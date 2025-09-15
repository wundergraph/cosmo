package grpcpluginoci

import (
	"context"
	"errors"
	"fmt"
	"go.opentelemetry.io/otel/trace"
	"os"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/crane"
	v1 "github.com/google/go-containerregistry/pkg/v1"
	"github.com/hashicorp/go-plugin"
	"github.com/wundergraph/cosmo/router/pkg/grpcconnector/grpccommon"
	"go.uber.org/zap"
	"google.golang.org/grpc"
)

type GRPCPluginConfig struct {
	Logger             *zap.Logger
	ImageRef           string
	RegistryToken      string
	StartupConfig      grpccommon.GRPCStartupParams
	Tracer             trace.Tracer
	GetTraceAttributes grpccommon.GRPCTraceAttributeGetter
}

type GRPCPlugin struct {
	logger *zap.Logger

	done     chan struct{}
	mu       sync.Mutex
	disposed atomic.Bool

	workDir string

	img v1.Image

	imgRef string

	registryUsername string
	registryPassword string

	client *grpccommon.GRPCPluginClient

	startupConfig grpccommon.GRPCStartupParams

	tracer             trace.Tracer
	getTraceAttributes grpccommon.GRPCTraceAttributeGetter
}

func NewGRPCOCIPlugin(config GRPCPluginConfig) (*GRPCPlugin, error) {
	if config.Logger == nil {
		return nil, fmt.Errorf("logger is required")
	}

	if config.ImageRef == "" {
		return nil, fmt.Errorf("image source is required")
	}

	if config.RegistryToken == "" {
		return nil, fmt.Errorf("registry token is required")
	}

	return &GRPCPlugin{
		done:     make(chan struct{}),
		mu:       sync.Mutex{},
		disposed: atomic.Bool{},

		logger: config.Logger,

		imgRef: config.ImageRef,

		registryUsername: "router",
		registryPassword: config.RegistryToken,

		tracer:             config.Tracer,
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

func (p *GRPCPlugin) cleanupPluginWorkDir() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.workDir != "" {
		os.RemoveAll(p.workDir)
		p.workDir = ""
	}
}

// Start implements Plugin.
func (p *GRPCPlugin) Start(ctx context.Context) error {
	desc, err := crane.Get(p.imgRef,
		crane.WithAuth(&authn.Basic{
			Username: p.registryUsername,
			Password: p.registryPassword,
		}),
		crane.WithPlatform(&v1.Platform{
			Architecture: runtime.GOARCH,
			OS:           runtime.GOOS,
		}),
	)

	if err != nil {
		return fmt.Errorf("pulling image %s: %w", p.imgRef, err)
	}
	if desc.MediaType.IsSchema1() {
		p.img, err = desc.Schema1()
		if err != nil {
			return fmt.Errorf("pulling schema 1 image %s: %w", p.imgRef, err)
		}
	} else {
		p.img, err = desc.Image()
		if err != nil {
			return fmt.Errorf("pulling Image %s: %w", p.imgRef, err)
		}
	}

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

	if err := p.startPluginProcess(); err != nil {
		return err
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

	var retErr error
	if p.client != nil {
		if err := p.client.Close(); err != nil {
			retErr = errors.Join(retErr, err)
		}
	}

	p.mu.Unlock()

	p.cleanupPluginWorkDir()

	p.disposed.Store(true)

	close(p.done)
	return retErr
}
