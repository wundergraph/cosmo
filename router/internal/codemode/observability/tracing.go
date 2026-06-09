package observability

import (
	"context"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

const tracerName = "wundergraph.cosmo.router.mcp.code_mode"

func StartToolSpan(ctx context.Context, toolName string) (context.Context, trace.Span) {
	return StartToolSpanWithProvider(ctx, otel.GetTracerProvider(), toolName)
}

func StartToolSpanWithProvider(ctx context.Context, tracerProvider trace.TracerProvider, toolName string) (context.Context, trace.Span) {
	if tracerProvider == nil {
		tracerProvider = otel.GetTracerProvider()
	}
	return tracerProvider.Tracer(tracerName).Start(ctx, toolSpanName(toolName),
		trace.WithSpanKind(trace.SpanKindServer),
		trace.WithAttributes(attribute.String("mcp.tool", toolName)),
	)
}

func toolSpanName(toolName string) string {
	switch toolName {
	case "code_mode_search_tools":
		return "MCP Code Mode - Search"
	case "code_mode_run_js":
		return "MCP Code Mode - Execute"
	default:
		return "MCP Code Mode - " + toolName
	}
}
