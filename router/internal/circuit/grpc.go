package circuit

import (
	"context"

	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// NewUnaryClientInterceptor returns a gRPC unary client interceptor that guards
// calls to the given subgraph with its circuit breaker. It is the gRPC
// counterpart of the HTTP Breaker round tripper.
func NewUnaryClientInterceptor(subgraph string, breaker *Manager, logger *zap.Logger) grpc.UnaryClientInterceptor {
	if logger == nil {
		logger = zap.NewNop()
	}

	return func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		cb := breaker.GetCircuitBreaker(subgraph)
		if cb == nil {
			return invoker(ctx, method, req, reply, cc, opts...)
		}

		preRunStatus := cb.IsOpen()

		var (
			invoked bool
			callErr error
		)
		err := cb.Run(ctx, func(_ context.Context) error {
			// The execution timeout measures RPC latency. Only the caller sets the RPC deadline.
			invoked = true
			callErr = invoker(ctx, method, req, reply, cc, opts...)
			if ctx.Err() != nil {
				// Let the breaker classify an interrupted call separately from a service reply.
				return callErr
			}
			return grpcCircuitError(callErr)
		})

		postRunStatus := cb.IsOpen()

		if preRunStatus != postRunStatus {
			logger.Debug("Circuit breaker status changed", zap.String("subgraph_name", subgraph), zap.Bool("is_open", postRunStatus))
		} else if preRunStatus && !invoked {
			logger.Debug("Circuit breaker open, request callback did not execute", zap.String("subgraph_name", subgraph))
		}

		if invoked {
			// Return the error of the call itself, so that callers still see the gRPC status
			return callErr
		}
		return err
	}
}

// grpcCircuitError decides if a failed gRPC call counts against the circuit.
// Only status codes that say the service is unhealthy or unreachable count. Every
// other code is an answer from a working service (e.g. NotFound, InvalidArgument,
// or Unknown for an error returned by a handler), which matches the HTTP breaker,
// where a response with an error status code does not count either.
func grpcCircuitError(err error) error {
	if err == nil {
		return nil
	}

	switch status.Code(err) {
	case codes.Unavailable, codes.DeadlineExceeded, codes.ResourceExhausted, codes.Internal, codes.DataLoss:
		return err
	default:
		return nil
	}
}
