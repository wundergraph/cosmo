package trace

import (
	"context"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// ExporterSamplingRate returns the sampling rate that applies to exp. Exporters
// without their own rate inherit the global one.
func ExporterSamplingRate(cfg *Config, exp *ExporterConfig) float64 {
	if exp.SamplingRate != nil {
		return *exp.SamplingRate
	}
	return cfg.Sampler
}

// HeadSamplingRate returns the rate used to decide whether a trace is recorded.
// It is the highest rate of the enabled exporters, which can be above or below
// the global rate, so that every exporter can receive its share of the traces
// and no trace is recorded only to be dropped by every exporter. Without
// enabled exporters it is the global rate.
func HeadSamplingRate(cfg *Config) float64 {
	highest := -1.0
	for _, exp := range cfg.Exporters {
		if exp == nil || exp.Disabled {
			continue
		}
		highest = max(highest, ExporterSamplingRate(cfg, exp))
	}
	if highest < 0 {
		return cfg.Sampler
	}
	return highest
}

// traceIDSamplingProcessor forwards to the wrapped processor only the spans of
// traces selected by a trace ID ratio. It uses the same decision as the head
// sampler, so the traces an exporter receives with a lower rate are always a
// subset of those received by an exporter with a higher rate, and every
// exporter receives complete traces.
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
