package plugintest

import (
	"context"
	"github.com/wundergraph/cosmo/router-plugin/config"
	routerplugin "github.com/wundergraph/cosmo/router-plugin/setup"
	"net"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

// PluginSetupResposne is a wrapper that holds the gRPC test components
type PluginSetupResposne[T any] struct {
	client  T
	cleanup func()
}

const (
	bufSize = 1024 * 1024
)

type PluginTestConfig[T any] struct {
	StartupConfig       config.StartupConfig
	RouterPluginConfig  config.RouterPluginConfig
	RegisterServiceFunc func(grpc.ServiceRegistrar)
	CreateClientFunc    func(conn *grpc.ClientConn) T
}

// SetupPluginForTest creates a local gRPC server for testing
func SetupPluginForTest[T any](t *testing.T, testConfig PluginTestConfig[T]) *PluginSetupResposne[T] {
	// Create a buffer for gRPC connections
	lis := bufconn.Listen(bufSize)

	opts := routerplugin.GrpcServerInitOpts{
		StartupConfig: testConfig.StartupConfig,
		PluginConfig:  testConfig.RouterPluginConfig,
	}

	server, err := routerplugin.GrpcServer(opts)
	require.NoError(t, err)

	// Create a new gRPC server
	grpcServer := server([]grpc.ServerOption{})

	// Register our service
	testConfig.RegisterServiceFunc(grpcServer)

	// Start the server
	go func() {
		if err := grpcServer.Serve(lis); err != nil {
			t.Fatalf("failed to serve: %v", err)
		}
	}()

	// Create a client connection
	dialer := func(context.Context, string) (net.Conn, error) {
		return lis.Dial()
	}
	conn, err := grpc.Dial(
		"passthrough:///bufnet",
		grpc.WithContextDialer(dialer),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	require.NoError(t, err)

	// Create the service client
	client := testConfig.CreateClientFunc(conn)

	// Return cleanup function
	cleanup := func() {
		err := conn.Close()
		grpcServer.Stop()
		require.NoError(t, err)
	}

	return &PluginSetupResposne[T]{
		client:  client,
		cleanup: cleanup,
	}
}
