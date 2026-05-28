package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	rotel "github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func TestResponseFinalizationSpanMiddleware(t *testing.T) {
	t.Parallel()

	exporter := tracetest.NewInMemoryExporter(t)
	tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	tracer := tp.Tracer("test")

	wrapper := func(next http.Handler) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r)
			time.Sleep(2 * time.Millisecond)
		}
	}

	handler := responseFinalizationSpanMiddleware(wrapper, tracer)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":{}}`))
	}))

	ctx, rootSpan := tracer.Start(context.Background(), "query Test")
	req := httptest.NewRequest(http.MethodPost, "/graphql", nil).WithContext(ctx)
	handler.ServeHTTP(httptest.NewRecorder(), req)
	rootSpan.End()

	spans := exporter.GetSpans().Snapshots()
	require.Len(t, spans, 2)

	var root, finalize sdktrace.ReadOnlySpan
	for _, span := range spans {
		switch span.Name() {
		case "query Test":
			root = span
		case "Router - Finalize Response":
			finalize = span
		}
	}

	require.NotNil(t, root)
	require.NotNil(t, finalize)
	require.Equal(t, root.SpanContext().SpanID(), finalize.Parent().SpanID())
	require.True(t, finalize.EndTime().After(finalize.StartTime()))
	require.Contains(t, finalize.Attributes(), rotel.RouterServerAttribute)
}

func TestEmitRouterPhaseSpanSkipsInvalidParent(t *testing.T) {
	t.Parallel()

	exporter := tracetest.NewInMemoryExporter(t)
	tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	tracer := tp.Tracer("test")

	emitRouterPhaseSpan(context.Background(), tracer, "Router - Finalize Response", time.Now().Add(-time.Millisecond), time.Millisecond, rotel.RouterServerAttribute)

	require.Empty(t, exporter.GetSpans().Snapshots())
}
