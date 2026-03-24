package grpccommon

import (
	"context"
	"testing"
	"time"

	"github.com/hashicorp/go-plugin"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"
	grpccodes "google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestInvoke(t *testing.T) {
	t.Parallel()

	t.Run("plugin exited and reconnect times out sets span error status", func(t *testing.T) {
		t.Parallel()

		tracer, exporter := newTestTracer(t)

		g := &GRPCPluginClient{
			pc:                 nil, // nil means IsPluginProcessExited() returns true
			tracer:             tracer,
			getTraceAttributes: stubTraceAttributes,
			config: GRPCPluginClientConfig{
				ReconnectTimeout: 10 * time.Millisecond,
				PingInterval:     1 * time.Millisecond,
			},
		}

		err := g.Invoke(t.Context(), "/test.Method", nil, nil)
		require.Error(t, err)
		require.Contains(t, err.Error(), "plugin was not active in time")

		spans := exporter.GetSpans()
		require.Len(t, spans, 1)

		span := spans[0]
		require.Equal(t, "test-span", span.Name)
		require.Equal(t, codes.Error, span.Status.Code)
		require.Contains(t, span.Status.Description, "plugin was not active in time")

		// Verify exception event was recorded
		require.NotEmpty(t, span.Events)
		hasException := false
		for _, event := range span.Events {
			if event.Name == "exception" {
				hasException = true
				break
			}
		}
		require.True(t, hasException, "span should have an exception event")
	})

	t.Run("client closed returns unavailable with span error status", func(t *testing.T) {
		t.Parallel()

		tracer, exporter := newTestTracer(t)

		g := &GRPCPluginClient{
			pc:                 &plugin.Client{}, // non-nil, Exited() returns false
			cc:                 nil,
			tracer:             tracer,
			getTraceAttributes: stubTraceAttributes,
			config:             defaultGRPCPluginClientConfig,
		}
		g.isClosed.Store(true)

		err := g.Invoke(t.Context(), "/test.Method", nil, nil)
		require.Error(t, err)

		st, ok := status.FromError(err)
		require.True(t, ok, "error should be a gRPC status")
		require.Equal(t, grpccodes.Unavailable, st.Code())
		require.Equal(t, errPluginNotActive.Error(), st.Message())

		spans := exporter.GetSpans()
		require.Len(t, spans, 1)

		span := spans[0]
		require.Equal(t, codes.Error, span.Status.Code)
		require.Equal(t, errPluginNotActive.Error(), span.Status.Description)

		hasException := false
		for _, event := range span.Events {
			if event.Name == "exception" {
				hasException = true
				break
			}
		}
		require.True(t, hasException, "span should have an exception event")
	})

	t.Run("healthy plugin delegates to underlying connection", func(t *testing.T) {
		t.Parallel()

		tracer, exporter := newTestTracer(t)

		fakeCC := &fakeClientConn{}

		g := &GRPCPluginClient{
			pc:                 &plugin.Client{}, // non-nil, Exited() returns false
			cc:                 fakeCC,
			tracer:             tracer,
			getTraceAttributes: stubTraceAttributes,
			config:             defaultGRPCPluginClientConfig,
		}

		err := g.Invoke(t.Context(), "/test.Method", nil, nil)
		require.NoError(t, err)
		require.True(t, fakeCC.invoked, "should delegate to underlying connection")

		spans := exporter.GetSpans()
		require.Len(t, spans, 1)
		require.NotEqual(t, codes.Error, spans[0].Status.Code,
			"span should not be in error state for successful invocations")
	})
}

// fakeClientConn implements grpc.ClientConnInterface for testing the happy path.
type fakeClientConn struct {
	invoked bool
}

func (f *fakeClientConn) Invoke(_ context.Context, _ string, _ any, _ any, _ ...grpc.CallOption) error {
	f.invoked = true
	return nil
}

func (f *fakeClientConn) NewStream(_ context.Context, _ *grpc.StreamDesc, _ string, _ ...grpc.CallOption) (grpc.ClientStream, error) {
	return nil, nil
}

func newTestTracer(t *testing.T) (trace.Tracer, *tracetest.InMemoryExporter) {
	t.Helper()
	exporter := tracetest.NewInMemoryExporter()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	t.Cleanup(func() { _ = tp.Shutdown(t.Context()) })
	return tp.Tracer("test"), exporter
}

func stubTraceAttributes(_ context.Context) (string, trace.SpanStartEventOption) {
	return "test-span", trace.WithAttributes()
}
