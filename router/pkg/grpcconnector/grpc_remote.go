package grpcconnector

import (
	"context"
	"fmt"
	"io"
	"sync"

	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// Ensure GRPCStandaloneProvider implements the ClientProvider interface
var _ ClientProvider = (*RemoteGRPCProvider)(nil)

// RemoteGRPCProvider is a client provider that manages a gRPC client connection to a standalone gRPC server.
// It is used to connect to a standalone gRPC server that is not part of the cosmo cluster.
// The provider maintains a single client connection and provides thread-safe access to it.
type RemoteGRPCProvider struct {
	logger   *zap.Logger
	name     string
	endpoint string

	cc grpc.ClientConnInterface
	mu sync.RWMutex
}

// RemoteGRPCProviderConfig holds the configuration parameters for creating a new RemoteGRPCProvider.
type RemoteGRPCProviderConfig struct {
	// Logger is the zap logger instance to use for logging. If nil, a no-op logger will be used.
	Logger *zap.Logger
	// Name is the name of the subgraph this provider is connecting to.
	Name string
	// Endpoint is the URL of the gRPC server to connect to.
	Endpoint string
}

// NewRemoteGRPCProvider creates a new RemoteGRPCProvider with the given configuration.
// It validates the configuration parameters and returns an error if any required parameters are missing.
func NewRemoteGRPCProvider(config RemoteGRPCProviderConfig) (*RemoteGRPCProvider, error) {
	if config.Logger == nil {
		config.Logger = zap.NewNop()
	}

	if config.Name == "" {
		return nil, fmt.Errorf("subgraph name is required")
	}

	if config.Endpoint == "" {
		return nil, fmt.Errorf("endpoint is required")
	}

	return &RemoteGRPCProvider{
		logger:   config.Logger,
		name:     config.Name,
		endpoint: config.Endpoint,
	}, nil
}

// GetClient returns the gRPC client connection interface.
// This method is thread-safe and can be called concurrently.
func (g *RemoteGRPCProvider) GetClient() grpc.ClientConnInterface {
	g.mu.RLock()
	defer g.mu.RUnlock()

	return g.cc
}

// Name returns the name of the provider.
func (g *RemoteGRPCProvider) Name() string {
	return g.name
}

// Start initializes the gRPC client connection if it hasn't been created yet.
// It parses the endpoint URL and creates a new insecure gRPC connection.
func (g *RemoteGRPCProvider) Start(ctx context.Context) error {
	if g.cc == nil {
		clientConn, err := grpc.NewClient(g.endpoint, grpc.WithTransportCredentials(insecure.NewCredentials()))
		if err != nil {
			return fmt.Errorf("failed to create client connection: %w", err)
		}

		g.cc = clientConn
	}

	return nil
}

// Stop closes the gRPC client connection if it implements the io.Closer interface.
// This method is thread-safe.
func (g *RemoteGRPCProvider) Stop() error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if closer, ok := g.cc.(io.Closer); ok {
		return closer.Close()
	}

	return nil
}
