package grpcremote

import (
	"context"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	meterScopeName = "github.com/wundergraph/cosmo/router/pkg/grpcconnector/grpcremote"

	requestCounterName  = "router.grpc.service.requests"
	requestDurationName = "router.grpc.service.request.duration_milliseconds"
	attrSubgraphName    = "wg.subgraph.name"
	attrGRPCStatusCode  = "rpc.grpc.status_code"
	attrRPCMethod       = "rpc.method"
)

// grpcClientMetrics records per-request telemetry for remote gRPC subgraph
// calls: a request counter and a duration histogram, both attributed with the
// subgraph name and the gRPC status code so that transport-level failures
// (Unavailable, DeadlineExceeded, ...) are distinguishable downstream.
// Measurements are recorded on every configured meter provider (e.g. OTLP and
// Prometheus), while failures are logged only once.
type grpcClientMetrics struct {
	subgraphName string
	logger       *zap.Logger
	instruments  []grpcClientInstruments
}

// grpcClientInstruments holds the instruments created from a single meter provider.
type grpcClientInstruments struct {
	requests metric.Int64Counter
	duration metric.Float64Histogram
}

func newGRPCClientMetrics(mps []metric.MeterProvider, subgraphName string, logger *zap.Logger) (*grpcClientMetrics, error) {
	instruments := make([]grpcClientInstruments, 0, len(mps))

	for _, mp := range mps {
		meter := mp.Meter(meterScopeName)

		requests, err := meter.Int64Counter(
			requestCounterName,
			metric.WithDescription("Total number of gRPC requests to remote subgraph services, by subgraph and gRPC status code."),
		)
		if err != nil {
			return nil, err
		}

		duration, err := meter.Float64Histogram(
			requestDurationName,
			metric.WithUnit("ms"),
			metric.WithDescription("Duration of gRPC requests to remote subgraph services, by subgraph and gRPC status code."),
		)
		if err != nil {
			return nil, err
		}

		instruments = append(instruments, grpcClientInstruments{
			requests: requests,
			duration: duration,
		})
	}

	return &grpcClientMetrics{
		subgraphName: subgraphName,
		logger:       logger,
		instruments:  instruments,
	}, nil
}

// record registers the outcome of a single RPC and logs failures at error
// level. Fetch failures are otherwise invisible in router logs at production
// log levels, so this log line is load-bearing for incident response.
func (m *grpcClientMetrics) record(ctx context.Context, method string, elapsed time.Duration, err error) {
	code := status.Code(err)

	attrs := metric.WithAttributes(
		attribute.String(attrSubgraphName, m.subgraphName),
		attribute.String(attrGRPCStatusCode, code.String()),
		attribute.String(attrRPCMethod, method),
	)
	elapsedMs := float64(elapsed) / float64(time.Millisecond)
	for _, inst := range m.instruments {
		inst.requests.Add(ctx, 1, attrs)
		inst.duration.Record(ctx, elapsedMs, attrs)
	}

	if err != nil && code != codes.OK {
		m.logger.Error("remote gRPC subgraph request failed",
			zap.String("subgraph_name", m.subgraphName),
			zap.String("rpc_method", method),
			zap.String("grpc_status_code", code.String()),
			zap.Error(err),
		)
	}
}

// metricsUnaryClientInterceptor returns a unary client interceptor that records
// request count, duration and status code for every RPC to the remote subgraph.
func metricsUnaryClientInterceptor(m *grpcClientMetrics) grpc.UnaryClientInterceptor {
	return func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		start := time.Now()
		err := invoker(ctx, method, req, reply, cc, opts...)
		m.record(ctx, method, time.Since(start), err)
		return err
	}
}

// metricsStreamClientInterceptor returns a stream client interceptor that
// records stream establishment. Only stream creation is instrumented; errors
// surfaced later through the ClientStream are not captured here. Remote gRPC
// subgraph resolvers are unary today, so this is a deliberate simplification.
func metricsStreamClientInterceptor(m *grpcClientMetrics) grpc.StreamClientInterceptor {
	return func(ctx context.Context, desc *grpc.StreamDesc, cc *grpc.ClientConn, method string, streamer grpc.Streamer, opts ...grpc.CallOption) (grpc.ClientStream, error) {
		start := time.Now()
		cs, err := streamer(ctx, desc, cc, method, opts...)
		m.record(ctx, method, time.Since(start), err)
		return cs, err
	}
}
