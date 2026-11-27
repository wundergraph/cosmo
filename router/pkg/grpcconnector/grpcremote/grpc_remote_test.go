package grpcremote

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

const (
	testTraceIDHex = "4bf92f3577b34da6a3ce929d0e0e4736"
	testSpanIDHex  = "00f067aa0ba902b7"
)

// ctxWithRemoteSpan returns a context carrying a valid, sampled remote span so
// that a W3C propagator emits a traceparent header.
func ctxWithRemoteSpan(t *testing.T) context.Context {
	t.Helper()

	traceID, err := sdktrace.TraceIDFromHex(testTraceIDHex)
	require.NoError(t, err)
	spanID, err := sdktrace.SpanIDFromHex(testSpanIDHex)
	require.NoError(t, err)

	sc := sdktrace.NewSpanContext(sdktrace.SpanContextConfig{
		TraceID:    traceID,
		SpanID:     spanID,
		TraceFlags: sdktrace.FlagsSampled,
		Remote:     true,
	})

	return sdktrace.ContextWithRemoteSpanContext(context.Background(), sc)
}

func TestTraceUnaryClientInterceptorInjectsTraceContext(t *testing.T) {
	propagator := propagation.TraceContext{}
	interceptor := traceUnaryClientInterceptor(propagator)

	ctx := ctxWithRemoteSpan(t)

	var capturedMD metadata.MD
	invoker := func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, opts ...grpc.CallOption) error {
		capturedMD, _ = metadata.FromOutgoingContext(ctx)
		return nil
	}

	err := interceptor(ctx, "/service/Method", nil, nil, nil, invoker)
	require.NoError(t, err)

	require.NotNil(t, capturedMD)
	traceparent := capturedMD.Get("traceparent")
	require.Len(t, traceparent, 1)
	assert.Contains(t, traceparent[0], testTraceIDHex)
}

func TestTraceStreamClientInterceptorInjectsTraceContext(t *testing.T) {
	propagator := propagation.TraceContext{}
	interceptor := traceStreamClientInterceptor(propagator)

	ctx := ctxWithRemoteSpan(t)

	var capturedMD metadata.MD
	streamer := func(ctx context.Context, desc *grpc.StreamDesc, cc *grpc.ClientConn, method string, opts ...grpc.CallOption) (grpc.ClientStream, error) {
		capturedMD, _ = metadata.FromOutgoingContext(ctx)
		return nil, nil
	}

	_, err := interceptor(ctx, &grpc.StreamDesc{}, nil, "/service/Method", streamer)
	require.NoError(t, err)

	require.NotNil(t, capturedMD)
	traceparent := capturedMD.Get("traceparent")
	require.Len(t, traceparent, 1)
	assert.Contains(t, traceparent[0], testTraceIDHex)
}

// TestInjectTraceContextPreservesExistingMetadata ensures that injecting trace
// context does not drop metadata already present on the outgoing context.
func TestInjectTraceContextPreservesExistingMetadata(t *testing.T) {
	propagator := propagation.TraceContext{}

	ctx := ctxWithRemoteSpan(t)
	ctx = metadata.AppendToOutgoingContext(ctx, "x-existing", "value")

	ctx = injectTraceContext(ctx, propagator)

	md, ok := metadata.FromOutgoingContext(ctx)
	require.True(t, ok)
	assert.Equal(t, []string{"value"}, md.Get("x-existing"))
	require.Len(t, md.Get("traceparent"), 1)
	assert.Contains(t, md.Get("traceparent")[0], testTraceIDHex)
}
