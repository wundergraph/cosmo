package routerplugin

import (
	"encoding/json"
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
	ExporterConfig string
	PluginConfig   RouterPluginConfig
}

func GrpcServer(opts GrpcServerInitOpts) (GrpcServerInitFunc, error) {
	var startupConfig config.StartupConfig
	if opts.ExporterConfig != "" {
		err := json.Unmarshal([]byte(opts.ExporterConfig), &startupConfig)
		if err != nil {
			return nil, err
		}
	}

	grpcOpts := make([]grpc.ServerOption, 0)

	if opts.PluginConfig.TracingEnabled && startupConfig.Telemetry != nil {
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
			TracingConfig:    startupConfig.Telemetry.Tracing,
			IPAnonymization:  startupConfig.IPAnonymization,
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
