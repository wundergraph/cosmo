package plugintest

import (
	"context"
	"github.com/wundergraph/cosmo/router-plugin/config"
	plugin "github.com/wundergraph/cosmo/router-tests/plugintest/hello/generated"
	"google.golang.org/grpc"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
)

type HellosService struct {
	plugin.UnimplementedHelloServiceServer
}

func (s *HellosService) QueryHello(ctx context.Context, req *plugin.QueryHelloRequest) (*plugin.QueryHelloResponse, error) {
	response := &plugin.QueryHelloResponse{
		Hello: &plugin.World{
			Id:   "1",
			Name: req.Name,
		},
	}
	return response, nil
}

func TestFramework(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter(t)

	startup := config.StartupConfig{
		Telemetry: &config.Telemetry{
			Tracing: &config.Tracing{
				Sampler:     1.0,
				Propagators: []config.Propagator{"tracecontext"},
			},
		},
	}

	opts := config.RouterPluginConfig{
		ServiceName:    "test-service",
		ServiceVersion: "1.0.0",
		TracingEnabled: true,
		MemoryExporter: exporter,
	}

	svc := SetupPluginForTest[plugin.HelloServiceClient](t, PluginTestConfig[plugin.HelloServiceClient]{
		StartupConfig:      startup,
		RouterPluginConfig: opts,
		RegisterServiceFunc: func(reg grpc.ServiceRegistrar) {
			plugin.RegisterHelloServiceServer(reg, &HellosService{})
		},
		CreateClientFunc: func(conn *grpc.ClientConn) plugin.HelloServiceClient {
			return plugin.NewHelloServiceClient(conn)
		},
	})
	defer svc.cleanup()

	req := &plugin.QueryHelloRequest{
		Name: "there",
	}

	resp, err := svc.client.QueryHello(context.Background(), req)

	sn := exporter.GetSpans().Snapshots()
	assert.Len(t, sn, 1)
	require.NoError(t, err)
	assert.NotNil(t, resp.Hello)
}
