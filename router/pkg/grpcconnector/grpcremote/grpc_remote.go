package grpcremote

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"sync"

	"github.com/wundergraph/cosmo/router/pkg/grpcconnector"
	"github.com/wundergraph/cosmo/router/pkg/trace"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/propagation"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

// RemoteGRPCProviderConfig holds the configuration parameters for creating a new RemoteGRPCProvider.
type RemoteGRPCProviderConfig struct {
	// Logger is the zap logger instance to use for logging. If nil, a no-op logger will be used.
	Logger *zap.Logger
	// Endpoint is the URL of the gRPC server to connect to.
	Endpoint string
	// TLSConfig is the TLS configuration for the gRPC connection. When nil, an insecure connection is used.
	TLSConfig *tls.Config
	// Propagator injects OpenTelemetry trace context (W3C traceparent/tracestate)
	// into the metadata of outgoing gRPC calls so that remote gRPC subgraph
	// services can continue the trace. If nil, no trace context is propagated.
	Propagator propagation.TextMapPropagator
	// SubgraphName is the name of the subgraph this provider connects to. Used
	// as a metric attribute and in failure logs.
	SubgraphName string
	// MeterProviders record per-request metrics (count, duration, gRPC status
	// code) for calls to the remote subgraph. Every provider receives the same
	// measurements. If empty, no metrics are recorded and fetch failures are not
	// logged. The router adds the OTLP and Prometheus providers when
	// metrics.otlp.grpc_service and metrics.prometheus.grpc_service are enabled.
	MeterProviders []metric.MeterProvider
}

// RemoteGRPCProvider is a client provider that manages a gRPC client connection to a standalone gRPC server.
// It is used to connect to a standalone gRPC server that is not part of the cosmo cluster.
// The provider maintains a single client connection and provides thread-safe access to it.
type RemoteGRPCProvider struct {
	logger         *zap.Logger
	endpoint       string
	tlsConfig      *tls.Config
	propagator     propagation.TextMapPropagator
	subgraphName   string
	meterProviders []metric.MeterProvider

	cc grpc.ClientConnInterface
	mu sync.RWMutex
}

// Ensure GRPCStandaloneProvider implements the ClientProvider interface
var _ grpcconnector.ClientProvider = (*RemoteGRPCProvider)(nil)

// NewRemoteGRPCProvider creates a new RemoteGRPCProvider with the given configuration.
// It validates the configuration parameters and returns an error if any required parameters are missing.
func NewRemoteGRPCProvider(config RemoteGRPCProviderConfig) (*RemoteGRPCProvider, error) {
	if config.Logger == nil {
		config.Logger = zap.NewNop()
	}

	if config.Endpoint == "" {
		return nil, fmt.Errorf("endpoint is required")
	}

	return &RemoteGRPCProvider{
		logger:         config.Logger,
		endpoint:       config.Endpoint,
		tlsConfig:      config.TLSConfig,
		propagator:     config.Propagator,
		subgraphName:   config.SubgraphName,
		meterProviders: config.MeterProviders,
	}, nil
}

// GetClient returns the gRPC client connection interface.
// This method is thread-safe and can be called concurrently.
func (g *RemoteGRPCProvider) GetClient() grpc.ClientConnInterface {
	g.mu.RLock()
	defer g.mu.RUnlock()

	return g.cc
}

// Start initializes the gRPC client connection if it hasn't been created yet.
// It creates a new gRPC connection using TLS when a TLSConfig is provided,
// otherwise uses an insecure connection.
func (g *RemoteGRPCProvider) Start(ctx context.Context) error {
	if g.cc == nil {
		var transportCreds grpc.DialOption
		if g.tlsConfig != nil {
			transportCreds = grpc.WithTransportCredentials(credentials.NewTLS(g.tlsConfig))
		} else {
			transportCreds = grpc.WithTransportCredentials(insecure.NewCredentials())
		}
		opts := []grpc.DialOption{
			transportCreds,
		}

		// When a propagator is configured, inject the OpenTelemetry trace context
		// (W3C traceparent/tracestate) into the metadata of outgoing gRPC calls so
		// that remote gRPC subgraph services can continue the trace.
		if g.propagator != nil {
			opts = append(opts,
				grpc.WithChainUnaryInterceptor(traceUnaryClientInterceptor(g.propagator)),
				grpc.WithChainStreamInterceptor(traceStreamClientInterceptor(g.propagator)),
			)
		}

		// When a meter provider is configured, record per-request metrics (count,
		// duration, gRPC status code) and log failed requests, so that transport
		// failures between the router and the subgraph are observable.
		if len(g.meterProviders) > 0 {
			m, err := newGRPCClientMetrics(g.meterProviders, g.subgraphName, g.logger)
			if err != nil {
				return fmt.Errorf("failed to create gRPC client metrics: %w", err)
			}
			opts = append(opts,
				grpc.WithChainUnaryInterceptor(metricsUnaryClientInterceptor(m)),
				grpc.WithChainStreamInterceptor(metricsStreamClientInterceptor(m)),
			)
		}

		clientConn, err := grpc.NewClient(g.endpoint, opts...)
		if err != nil {
			return fmt.Errorf("failed to create client connection: %w", err)
		}

		g.cc = clientConn
	}

	return nil
}

// injectTraceContext injects the trace context from ctx into the outgoing gRPC
// metadata using the configured propagator and returns the updated context.
func injectTraceContext(ctx context.Context, propagator propagation.TextMapPropagator) context.Context {
	md, ok := metadata.FromOutgoingContext(ctx)
	if !ok {
		md = metadata.MD{}
	} else {
		md = md.Copy()
	}

	trace.Inject(ctx, propagator, &md)

	return metadata.NewOutgoingContext(ctx, md)
}

// traceUnaryClientInterceptor returns a unary client interceptor that injects the
// trace context into the metadata of outgoing unary gRPC calls.
func traceUnaryClientInterceptor(propagator propagation.TextMapPropagator) grpc.UnaryClientInterceptor {
	return func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		ctx = injectTraceContext(ctx, propagator)
		return invoker(ctx, method, req, reply, cc, opts...)
	}
}

// traceStreamClientInterceptor returns a stream client interceptor that injects the
// trace context into the metadata of outgoing streaming gRPC calls.
func traceStreamClientInterceptor(propagator propagation.TextMapPropagator) grpc.StreamClientInterceptor {
	return func(ctx context.Context, desc *grpc.StreamDesc, cc *grpc.ClientConn, method string, streamer grpc.Streamer, opts ...grpc.CallOption) (grpc.ClientStream, error) {
		ctx = injectTraceContext(ctx, propagator)
		return streamer(ctx, desc, cc, method, opts...)
	}
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
