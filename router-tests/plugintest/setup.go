package plugintest

import (
	"context"
	"github.com/wundergraph/cosmo/router-plugin/config"
	routerplugin "github.com/wundergraph/cosmo/router-plugin/setup"
	plugin "github.com/wundergraph/cosmo/router-tests/plugintest/hello/generated"
	"net"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

type HelloService struct {
	runFunc func(_ context.Context, req *plugin.QueryRunRequest) (*plugin.QueryRunResponse, error)
	plugin.UnimplementedHelloServiceServer
}

func (s *HelloService) QueryRun(ctx context.Context, req *plugin.QueryRunRequest) (*plugin.QueryRunResponse, error) {
	return s.runFunc(ctx, req)
}

// PluginGrpcServerSetupResponse is a wrapper that holds the gRPC test components
type PluginGrpcServerSetupResponse[T any] struct {
	Client  T
	Cleanup func()
}

const (
	bufSize = 1024 * 1024
)

type PluginGrpcTestConfig[T any] struct {
	StartupConfig       config.StartupConfig
	RouterPluginConfig  config.RouterPluginConfig
	RegisterServiceFunc func(grpc.ServiceRegistrar)
	CreateClientFunc    func(conn *grpc.ClientConn) T
}

// SetupPluginGrpcServerForTest creates a local gRPC server for testing
func SetupPluginGrpcServerForTest[T any](t *testing.T, testConfig PluginGrpcTestConfig[T]) *PluginGrpcServerSetupResponse[T] {
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
		err := grpcServer.Serve(lis)
		require.NoError(t, err)
	}()

	// Create a client connection
	dialer := func(context.Context, string) (net.Conn, error) {
		return lis.Dial()
	}

	conn, err := grpc.NewClient(
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
		require.NoError(t, err)
		grpcServer.Stop()
	}

	return &PluginGrpcServerSetupResponse[T]{
		Client:  client,
		Cleanup: cleanup,
	}
}
