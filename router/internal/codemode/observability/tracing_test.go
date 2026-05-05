package observability

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

func TestStartToolSpanRecordsSearchServerSpan(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() { otel.SetTracerProvider(previous) })

	_, span := StartToolSpan(context.Background(), "code_mode_search_tools")
	span.End()

	ended := recorder.Ended()
	require.Len(t, ended, 1)
	stub := tracetest.SpanStubFromReadOnlySpan(ended[0])
	stub.SpanContext = trace.SpanContext{}
	stub.StartTime = time.Time{}
	stub.EndTime = time.Time{}
	stub.Resource = nil
	assert.Equal(t, tracetest.SpanStub{
		Name:     "MCP Code Mode - Search",
		SpanKind: trace.SpanKindServer,
		Attributes: []attribute.KeyValue{
			attribute.String("mcp.tool", "code_mode_search_tools"),
		},
		InstrumentationLibrary: stub.InstrumentationLibrary,
	}, stub)
}

func TestStartToolSpanRecordsExecuteServerSpan(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))

	ctx, span := StartToolSpanWithProvider(context.Background(), provider, "code_mode_run_js")
	require.True(t, trace.SpanFromContext(ctx).SpanContext().IsValid())
	span.End()

	ended := recorder.Ended()
	require.Len(t, ended, 1)
	stub := tracetest.SpanStubFromReadOnlySpan(ended[0])
	stub.SpanContext = trace.SpanContext{}
	stub.StartTime = time.Time{}
	stub.EndTime = time.Time{}
	stub.Resource = nil
	assert.Equal(t, tracetest.SpanStub{
		Name:     "MCP Code Mode - Execute",
		SpanKind: trace.SpanKindServer,
		Attributes: []attribute.KeyValue{
			attribute.String("mcp.tool", "code_mode_run_js"),
		},
		InstrumentationLibrary: stub.InstrumentationLibrary,
	}, stub)
}
