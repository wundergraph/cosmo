package grpcconnector

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/hashicorp/go-plugin"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type GRPCPluginClient struct {
	isClosed atomic.Bool

	pc *plugin.Client
	cc grpc.ClientConnInterface

	config GRPCPluginClientConfig

	mu sync.RWMutex
}

type GRPCPluginClientConfig struct {
	ReconnectTimeout time.Duration
	PingInterval     time.Duration
}

var defaultGRPCPluginClientConfig = GRPCPluginClientConfig{
	ReconnectTimeout: time.Second * 20,
	PingInterval:     time.Second * 2,
}

type GRPCPluginClientOption func(*GRPCPluginClientConfig)

func WithReconnectConfig(reconnectTimeout time.Duration, pingInterval time.Duration) GRPCPluginClientOption {
	return func(c *GRPCPluginClientConfig) {
		c.ReconnectTimeout = reconnectTimeout
		c.PingInterval = pingInterval
	}
}

var _ grpc.ClientConnInterface = &GRPCPluginClient{}

func newGRPCPluginClient(pc *plugin.Client, cc grpc.ClientConnInterface, options ...GRPCPluginClientOption) (*GRPCPluginClient, error) {
	if pc == nil || cc == nil {
		return nil, errors.New("plugin client or grpc client conn is nil")
	}

	config := defaultGRPCPluginClientConfig

	for _, option := range options {
		option(&config)
	}

	return &GRPCPluginClient{
		pc:     pc,
		cc:     cc,
		config: config,
	}, nil
}

func (g *GRPCPluginClient) waitForPluginToBeActive() error {
	timeout := time.After(g.config.ReconnectTimeout)
	for {
		select {
		case <-timeout:
			return errors.New("plugin was not active in time")
		default:
			isActive, err := g.isPluginActive()
			if err != nil {
				return err
			}

			if isActive {
				return nil
			}
		}
	}
}

// isPluginActive checks if the plugin is active by pinging it.
// Returns true if the plugin is active, false if it is not, and an error if there is an error.
func (g *GRPCPluginClient) isPluginActive() (bool, error) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	if g.pc == nil {
		return false, nil
	}

	clientProtocol, err := g.pc.Client()
	if err != nil {
		return false, err
	}

	if err := clientProtocol.Ping(); err != nil {
		time.Sleep(g.config.PingInterval)
		return false, nil
	}

	return true, nil
}

func (g *GRPCPluginClient) setClients(pluginClient *plugin.Client, clientConn grpc.ClientConnInterface) {
	// We need to lock here to avoid race conditions
	// We potentially access the plugin clients during invokes
	g.mu.Lock()
	defer g.mu.Unlock()
	g.pc = pluginClient
	g.cc = clientConn
}

// Invoke implements grpc.ClientConnInterface.
func (g *GRPCPluginClient) Invoke(ctx context.Context, method string, args any, reply any, opts ...grpc.CallOption) error {
	if g.IsPluginProcessExited() {
		if err := g.waitForPluginToBeActive(); err != nil {
			return err
		}
	}

	if g.isClosed.Load() {
		return status.Error(codes.Unavailable, "plugin is not active")
	}

	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.cc.Invoke(ctx, method, args, reply, opts...)
}

// NewStream implements grpc.ClientConnInterface.
func (g *GRPCPluginClient) NewStream(ctx context.Context, desc *grpc.StreamDesc, method string, opts ...grpc.CallOption) (grpc.ClientStream, error) {
	return nil, status.Error(codes.Unavailable, "streaming is currently not supported")
}

// IsPluginProcessExited checks if the plugin process has exited.
func (g *GRPCPluginClient) IsPluginProcessExited() bool {
	g.mu.RLock()
	defer g.mu.RUnlock()

	return g.pc == nil || g.pc.Exited()
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
