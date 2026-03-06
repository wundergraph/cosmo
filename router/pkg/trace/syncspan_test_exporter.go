package trace

import (
	"context"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// syncSpanProcessor exports spans synchronously and routes errors through a
// local handler instead of the global otel.Handle. This is equivalent to
// sdktrace.WithSyncer but avoids global error handler races in parallel tests.
type syncSpanProcessor struct {
	exporter sdktrace.SpanExporter
	handler  func(error)
}

func (p *syncSpanProcessor) OnStart(_ context.Context, _ sdktrace.ReadWriteSpan) {}

func (p *syncSpanProcessor) OnEnd(s sdktrace.ReadOnlySpan) {
	if !s.SpanContext().IsSampled() {
		return
	}
	if err := p.exporter.ExportSpans(context.Background(), []sdktrace.ReadOnlySpan{s}); err != nil {
		p.handler(err)
	}
}

func (p *syncSpanProcessor) Shutdown(ctx context.Context) error {
	return p.exporter.Shutdown(ctx)
}

func (p *syncSpanProcessor) ForceFlush(ctx context.Context) error {
	return nil
}
