package tracing

import (
	"context"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// traceIDSamplingProcessor forwards to the wrapped processor only the spans of
// traces selected by a trace ID ratio. It makes the same decision as the
// router's per-exporter sampling, so plugin spans reach an exporter exactly
// when the router's spans of the same trace do.
type traceIDSamplingProcessor struct {
	sdktrace.SpanProcessor
	sampler sdktrace.Sampler
}

func newTraceIDSamplingProcessor(next sdktrace.SpanProcessor, rate float64) *traceIDSamplingProcessor {
	return &traceIDSamplingProcessor{
		SpanProcessor: next,
		sampler:       sdktrace.TraceIDRatioBased(rate),
	}
}

func (p *traceIDSamplingProcessor) sampled(span sdktrace.ReadOnlySpan) bool {
	result := p.sampler.ShouldSample(sdktrace.SamplingParameters{
		ParentContext: context.Background(),
		TraceID:       span.SpanContext().TraceID(),
	})
	return result.Decision == sdktrace.RecordAndSample
}

func (p *traceIDSamplingProcessor) OnStart(parent context.Context, s sdktrace.ReadWriteSpan) {
	if p.sampled(s) {
		p.SpanProcessor.OnStart(parent, s)
	}
}

func (p *traceIDSamplingProcessor) OnEnd(s sdktrace.ReadOnlySpan) {
	if p.sampled(s) {
		p.SpanProcessor.OnEnd(s)
	}
}
