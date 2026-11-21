package circuit

import (
	"context"
	"errors"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func newGRPCTestManager(t *testing.T, subgraph string) *Manager {
	t.Helper()

	manager, err := NewManager(CircuitBreakerConfig{
		Enabled:                    true,
		ErrorThresholdPercentage:   50,
		RequestThreshold:           2,
		SleepWindow:                time.Minute,
		HalfOpenAttempts:           1,
		RequiredSuccessfulAttempts: 1,
		RollingDuration:            10 * time.Second,
		NumBuckets:                 10,
		MaxConcurrentRequests:      -1,
	})
	require.NoError(t, err)

	err = manager.Initialize(ManagerOpts{
		AllGroupings: map[string]map[string]bool{
			"dns:///localhost:4011": {subgraph: true},
		},
	})
	require.NoError(t, err)

	return manager
}

func TestUnaryClientInterceptor(t *testing.T) {
	t.Parallel()

	const subgraph = "projects"

	invokerReturning := func(calls *int, err error) grpc.UnaryInvoker {
		return func(_ context.Context, _ string, _, _ any, _ *grpc.ClientConn, _ ...grpc.CallOption) error {
			*calls++
			return err
		}
	}

	t.Run("passes through when the subgraph has no circuit", func(t *testing.T) {
		t.Parallel()

		manager := newGRPCTestManager(t, subgraph)
		interceptor := NewUnaryClientInterceptor("other", manager, nil)

		unavailable := status.Error(codes.Unavailable, "down")

		var calls int
		for range 10 {
			err := interceptor(context.Background(), "/service/Method", nil, nil, nil, invokerReturning(&calls, unavailable))
			require.Equal(t, unavailable, err)
		}
		require.Equal(t, 10, calls)
	})

	t.Run("passes through when there is no manager", func(t *testing.T) {
		t.Parallel()

		interceptor := NewUnaryClientInterceptor(subgraph, nil, nil)

		var calls int
		err := interceptor(context.Background(), "/service/Method", nil, nil, nil, invokerReturning(&calls, nil))
		require.NoError(t, err)
		require.Equal(t, 1, calls)
	})

	t.Run("opens the circuit when the service is unavailable", func(t *testing.T) {
		t.Parallel()

		manager := newGRPCTestManager(t, subgraph)
		interceptor := NewUnaryClientInterceptor(subgraph, manager, nil)

		unavailable := status.Error(codes.Unavailable, "down")

		var calls int
		for range 2 {
			err := interceptor(context.Background(), "/service/Method", nil, nil, nil, invokerReturning(&calls, unavailable))
			// The caller still gets the gRPC status of the failed call
			require.Equal(t, unavailable, err)
		}
		require.Equal(t, 2, calls)
		require.True(t, manager.GetCircuitBreaker(subgraph).IsOpen())

		// The circuit is open, so the call is rejected without reaching the service
		err := interceptor(context.Background(), "/service/Method", nil, nil, nil, invokerReturning(&calls, nil))
		require.ErrorContains(t, err, "circuit is open")
		require.Equal(t, 2, calls)
	})

	t.Run("does not open the circuit on errors answered by the service", func(t *testing.T) {
		t.Parallel()

		manager := newGRPCTestManager(t, subgraph)
		interceptor := NewUnaryClientInterceptor(subgraph, manager, nil)

		callErrs := []error{
			status.Error(codes.NotFound, "not found"),
			status.Error(codes.InvalidArgument, "invalid"),
			status.Error(codes.Canceled, "canceled"),
			errors.New("handler error"),
		}

		var calls int
		for range 5 {
			for _, callErr := range callErrs {
				err := interceptor(context.Background(), "/service/Method", nil, nil, nil, invokerReturning(&calls, callErr))
				// The caller still sees the original application error.
				require.Equal(t, callErr, err)
			}
		}
		require.Equal(t, 5*len(callErrs), calls)
		require.False(t, manager.GetCircuitBreaker(subgraph).IsOpen())
	})

	t.Run("counts slow RPCs as timeouts and returns their result", func(t *testing.T) {
		synctest.Test(t, func(t *testing.T) {
			manager := newGRPCTestManager(t, subgraph)
			cb := manager.GetCircuitBreaker(subgraph)
			cfg := cb.Config()
			cfg.Execution.Timeout = time.Second
			cb.SetConfigThreadSafe(cfg)
			interceptor := NewUnaryClientInterceptor(subgraph, manager, nil)

			ctx, cancel := context.WithTimeout(t.Context(), time.Minute)
			defer cancel()
			slowRPC := func(ctx context.Context, _ string, _, _ any, _ *grpc.ClientConn, _ ...grpc.CallOption) error {
				select {
				case <-ctx.Done():
					return status.FromContextError(ctx.Err()).Err()
				case <-time.After(2 * time.Second):
					return nil
				}
			}
			for range 2 {
				require.NoError(t, interceptor(ctx, "/service/Method", nil, nil, nil, slowRPC))
			}
			require.True(t, cb.IsOpen())
		})
	})

	t.Run("counts application replies in the error rate and excludes caller cancellations", func(t *testing.T) {
		t.Parallel()
		manager := newGRPCTestManager(t, subgraph)
		cb := manager.GetCircuitBreaker(subgraph)
		interceptor := NewUnaryClientInterceptor(subgraph, manager, nil)
		var calls int
		invoke := func(ctx context.Context, err error) {
			t.Helper()
			require.Equal(t, err, interceptor(ctx, "/service/Method", nil, nil, nil, invokerReturning(&calls, err)))
		}

		canceled, cancel := context.WithCancel(t.Context())
		cancel()
		invoke(canceled, status.Error(codes.Canceled, "caller canceled"))
		for range 3 {
			invoke(t.Context(), status.Error(codes.NotFound, "missing"))
		}
		unavailable := status.Error(codes.Unavailable, "down")
		for range 2 {
			invoke(t.Context(), unavailable)
		}
		require.False(t, cb.IsOpen(), "two failures out of five completed calls")
		invoke(t.Context(), unavailable)
		require.True(t, cb.IsOpen(), "three failures out of six completed calls")
	})

	t.Run("logs only rejected calls as skipped and recovers on an application reply", func(t *testing.T) {
		synctest.Test(t, func(t *testing.T) {
			manager := newGRPCTestManager(t, subgraph)
			cb := manager.GetCircuitBreaker(subgraph)
			logsCore, logs := observer.New(zap.DebugLevel)
			interceptor := NewUnaryClientInterceptor(subgraph, manager, zap.New(logsCore))
			var calls int
			invoke := func(err error) error {
				return interceptor(t.Context(), "/service/Method", nil, nil, nil, invokerReturning(&calls, err))
			}

			cb.OpenCircuit(t.Context())
			require.ErrorContains(t, invoke(nil), "circuit is open")
			require.Zero(t, calls)

			time.Sleep(time.Minute + time.Second)
			unavailable := status.Error(codes.Unavailable, "down")
			require.Equal(t, unavailable, invoke(unavailable))
			require.True(t, cb.IsOpen())
			require.Equal(t, 1, calls)
			require.Equal(t, 1, logs.FilterMessage("Circuit breaker open, request callback did not execute").Len())

			time.Sleep(time.Minute + time.Second)
			notFound := status.Error(codes.NotFound, "missing")
			require.Equal(t, notFound, invoke(notFound))
			require.False(t, cb.IsOpen())
		})
	})
}
