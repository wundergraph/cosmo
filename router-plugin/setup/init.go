package setup

import (
	"fmt"

	"github.com/hashicorp/go-hclog"
	"github.com/wundergraph/cosmo/router-plugin/config"
	"github.com/wundergraph/cosmo/router-plugin/middleware"
	"github.com/wundergraph/cosmo/router-plugin/tracing"
	"google.golang.org/grpc"
)

type GrpcServerInitFunc func(serverOpts []grpc.ServerOption) *grpc.Server

const (
	baseServiceName    = "cosmo-router-plugin"
	baseServiceVersion = "1.0.0"
)

type GrpcServerInitOpts struct {
	Logger        hclog.Logger
	StartupConfig config.StartupConfig
	PluginConfig  config.RouterPluginConfig
}

func GrpcServer(opts GrpcServerInitOpts) (GrpcServerInitFunc, error) {
	grpcOpts := make([]grpc.ServerOption, 0)

	interceptors := make([]grpc.UnaryServerInterceptor, 0, 1)

	// We need to make sure the logger is available in the context for the recovery interceptor.
	// Otherwise the default logger would have to be used, which might cause that no output is logged.
	if opts.Logger != nil {
		interceptors = append(interceptors, middleware.Logging(opts.Logger))
	}

	interceptors = append(interceptors, middleware.Recovery)

	isTracingEnabled := opts.PluginConfig.TracingEnabled &&
		opts.StartupConfig.Telemetry != nil &&
		opts.StartupConfig.Telemetry.Tracing != nil

	if isTracingEnabled {
		serviceName := baseServiceName
		if opts.PluginConfig.ServiceName != "" {
			serviceName = opts.PluginConfig.ServiceName
		}
		serviceVersion := baseServiceVersion
		if opts.PluginConfig.ServiceVersion != "" {
			serviceVersion = opts.PluginConfig.ServiceVersion
		}

		tracingInterceptor, err := tracing.CreateTracingInterceptor(tracing.TracingOptions{
			ServiceName:      serviceName,
			ServiceVersion:   serviceVersion,
			ErrorHandlerFunc: opts.PluginConfig.TracingErrorHandler,
			TracingConfig:    opts.StartupConfig.Telemetry.Tracing,
			IPAnonymization:  opts.StartupConfig.IPAnonymization,
			MemoryExporter:   opts.PluginConfig.MemoryExporter,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create tracing interceptor: %w", err)
		}
		interceptors = append(interceptors, tracingInterceptor)
	}

	grpcOpts = append(grpcOpts, grpc.ChainUnaryInterceptor(interceptors...))

	grpcServerFunc := func(serverOpts []grpc.ServerOption) *grpc.Server {
		allOpts := append([]grpc.ServerOption{}, serverOpts...)
		allOpts = append(allOpts, grpcOpts...)
		return grpc.NewServer(allOpts...)
	}
	return grpcServerFunc, nil
}
