package circuit

import (
	"context"
	"errors"

	"github.com/cep21/circuit/v4"
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
		return grpcRejectedError(err)
	}
}

// grpcCircuitError decides if a failed gRPC call counts against the circuit.
// Only Unavailable and DeadlineExceeded count, the codes that say the service
// could not be reached or did not answer in time. This matches the HTTP breaker,
// which only counts a failure to obtain a response.
//
// Every other code is treated as an answer from a working service. Internal and
// ResourceExhausted are left out on purpose. A service returns them for its own
// errors and for rate limits, like an HTTP 500 or 429. grpc-go also raises them in
// the router for a reply that it cannot decode or that exceeds the max receive
// message size. Those depend on the request, so a single query could otherwise
// open the circuit for every caller of the subgraph.
func grpcCircuitError(err error) error {
	if err == nil {
		return nil
	}

	switch status.Code(err) {
	case codes.Unavailable, codes.DeadlineExceeded:
		return err
	default:
		return nil
	}
}

// grpcRejectedError converts the error of a call that the circuit rejected into
// a gRPC status. Without a status the engine reports the error with the Internal
// code, which makes a deliberate fast-fail look like a bug in the subgraph.
func grpcRejectedError(err error) error {
	if err == nil {
		return nil
	}

	var circuitErr circuit.Error
	if errors.As(err, &circuitErr) {
		if circuitErr.CircuitOpen() {
			return status.Error(codes.Unavailable, "circuit breaker is open")
		}
		if circuitErr.ConcurrencyLimitReached() {
			return status.Error(codes.Unavailable, "circuit breaker max concurrent requests reached")
		}
	}

	return status.Error(codes.Unavailable, "circuit breaker rejected the call: "+err.Error())
}
