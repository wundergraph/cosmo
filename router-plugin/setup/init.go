package setup

import (
	"fmt"
	"github.com/wundergraph/cosmo/router-plugin/config"
	"github.com/wundergraph/cosmo/router-plugin/tracing"
	"google.golang.org/grpc"
)

type GrpcServerInitFunc func(serverOpts []grpc.ServerOption) *grpc.Server

const (
	baseServiceName    = "cosmo-router-plugin"
	baseServiceVersion = "1.0.0"
)

type GrpcServerInitOpts struct {
	StartupConfig config.StartupConfig
	PluginConfig  config.RouterPluginConfig
}

func GrpcServer(opts GrpcServerInitOpts) (GrpcServerInitFunc, error) {
	grpcOpts := make([]grpc.ServerOption, 0)

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
		interceptor := grpc.UnaryInterceptor(tracingInterceptor)
		grpcOpts = append(grpcOpts, interceptor)
	}

	grpcServerFunc := func(serverOpts []grpc.ServerOption) *grpc.Server {
		allOpts := append([]grpc.ServerOption{}, serverOpts...)
		allOpts = append(allOpts, grpcOpts...)
		return grpc.NewServer(allOpts...)
	}
	return grpcServerFunc, nil
}
